import { NextRequest } from "next/server";
import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import path from "path";
import {
  validatePath,
  getBasePath,
  DIR_MODE,
  FILE_MODE,
  setDirectoryPermissions,
  setFilePermissions,
} from "@/lib/path-validator";

const SUBTITLE_EXTENSIONS = [".srt", ".ass", ".ssa", ".sub", ".idx", ".vtt", ".sup"];
const VIDEO_EXTENSIONS = [
  ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm",
  ".m4v", ".mpg", ".mpeg", ".ts", ".m2ts", ".vob"
];

interface FileRename {
  sourcePath: string;
  destinationPath: string;
}

interface FolderRename {
  oldPath: string; // Relative path to the folder (from the scanned base)
  newName: string; // New folder name (just the name, not path)
}

interface FolderCreate {
  filePath: string; // Original file path (before renaming)
  newFileName: string; // New filename after renaming
  folderName: string; // Folder name to create (e.g., "Percy Jackson (2023)")
  subfolderName?: string; // Optional subfolder name (e.g., "Season 01")
}

interface SeasonFolderCreate {
  filePath: string; // Original file path (before renaming)
  newFileName: string; // New filename after renaming
  seasonFolder: string; // Season folder name to create (e.g., "Season 01")
}

interface BatchRenameRequest {
  files?: FileRename[]; // Explicit source->dest mappings
  sourcePaths?: string[]; // Alternative: source paths only
  destinationFolder?: string; // Used with sourcePaths - destination folder (filename preserved)
  operation: "copy" | "move" | "rename"; // "rename" = rename in place (same folder)
  overwrite?: boolean; // If true, overwrite existing files
  pane?: "downloads" | "media"; // For rename operation: which pane the files are from
  folderRenames?: FolderRename[]; // Folders to rename after file operations (sorted deepest first)
  folderCreates?: FolderCreate[]; // Folders to create and move files into (for main folder creation)
  seasonFolderCreates?: SeasonFolderCreate[]; // Season folders to create and move files into
}

interface ProgressUpdate {
  type: "progress" | "file_progress" | "complete" | "error";
  current: number;
  total: number;
  currentFile?: string;
  completed: number;
  failed: number;
  errors: string[];
  message?: string;
  // Byte-level progress for current file
  bytesCopied?: number;
  bytesTotal?: number;
  // Transfer speed in bytes per second
  bytesPerSecond?: number;
}

// Helper function to copy file with progress reporting
async function copyFileWithProgress(
  sourcePath: string,
  destPath: string,
  onProgress: (bytesCopied: number, bytesTotal: number) => void
): Promise<void> {
  const stats = await fs.stat(sourcePath);
  const totalBytes = stats.size;
  let copiedBytes = 0;

  return new Promise((resolve, reject) => {
    const readStream = createReadStream(sourcePath);
    const writeStream = createWriteStream(destPath);

    readStream.on("data", (chunk: Buffer | string) => {
      const chunkLength = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      copiedBytes += chunkLength;
      onProgress(copiedBytes, totalBytes);
    });

    readStream.on("error", (err) => {
      writeStream.destroy();
      reject(err);
    });

    writeStream.on("error", (err) => {
      readStream.destroy();
      reject(err);
    });

    writeStream.on("finish", () => {
      resolve();
    });

    readStream.pipe(writeStream);
  });
}

// Helper function to get all files in a directory recursively with their sizes
interface FileInfo {
  relativePath: string;
  absolutePath: string;
  size: number;
}

async function getDirectoryFiles(dirPath: string, basePath: string = ""): Promise<FileInfo[]> {
  const files: FileInfo[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = basePath ? path.join(basePath, entry.name) : entry.name;

    if (entry.isDirectory()) {
      const subFiles = await getDirectoryFiles(fullPath, relativePath);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      const stats = await fs.stat(fullPath);
      files.push({
        relativePath,
        absolutePath: fullPath,
        size: stats.size,
      });
    }
  }

  return files;
}

// Helper function to create directory with proper permissions and ownership on ALL created directories
// fs.mkdir with recursive:true doesn't reliably set mode on intermediate directories
async function mkdirWithPermissions(dirPath: string, baseDir: string): Promise<void> {
  const normalizedDir = path.resolve(dirPath);
  const normalizedBase = path.resolve(baseDir);

  // Get the relative path from base to target
  const relativePath = path.relative(normalizedBase, normalizedDir);
  if (!relativePath || relativePath.startsWith('..')) {
    // Target is at or above base, just create it
    await fs.mkdir(dirPath, { recursive: true, mode: DIR_MODE });
    await setDirectoryPermissions(dirPath);
    return;
  }

  // Split into parts and create each directory with proper permissions and ownership
  const parts = relativePath.split(path.sep);
  let currentPath = normalizedBase;

  for (const part of parts) {
    currentPath = path.join(currentPath, part);
    try {
      await fs.mkdir(currentPath, { mode: DIR_MODE });
      await setDirectoryPermissions(currentPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        // Directory exists, ensure permissions and ownership are correct
        await setDirectoryPermissions(currentPath);
      } else {
        throw err;
      }
    }
  }
}

// Helper function to copy a directory with progress reporting
async function copyDirectoryWithProgress(
  sourceDir: string,
  destDir: string,
  mediaBase: string,
  onProgress: (bytesCopied: number, bytesTotal: number) => void
): Promise<void> {
  // Get all files and calculate total size
  const files = await getDirectoryFiles(sourceDir);
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  let totalBytesCopied = 0;

  // Create destination directory with proper permissions on ALL levels
  await mkdirWithPermissions(destDir, mediaBase);

  // Copy each file
  for (const file of files) {
    const destPath = path.join(destDir, file.relativePath);
    const destFileDir = path.dirname(destPath);

    // Create subdirectory if needed with proper permissions on ALL levels
    await mkdirWithPermissions(destFileDir, mediaBase);

    // Copy file with progress
    await copyFileWithProgress(file.absolutePath, destPath, (bytesCopied, bytesTotal) => {
      // Calculate overall progress
      const overallCopied = totalBytesCopied + bytesCopied;
      onProgress(overallCopied, totalBytes);
    });

    // Set file permissions and ownership after copy
    await setFilePermissions(destPath);

    totalBytesCopied += file.size;
  }

  // Final progress update (in case of empty directory)
  if (files.length === 0) {
    onProgress(0, 0);
  }
}

// Find companion subtitle files for a video file (same base name, subtitle extension)
async function findCompanionSubtitles(videoAbsolutePath: string): Promise<string[]> {
  const videoDir = path.dirname(videoAbsolutePath);
  const videoExt = path.extname(videoAbsolutePath);
  const videoBaseName = path.basename(videoAbsolutePath, videoExt);
  const companions: string[] = [];

  try {
    const entries = await fs.readdir(videoDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const entryExt = path.extname(entry.name).toLowerCase();
      if (!SUBTITLE_EXTENSIONS.includes(entryExt)) continue;
      // Match: "Movie.srt" or "Movie.en.srt" / "Movie.forced.it.srt"
      const nameWithoutSubExt = entry.name.slice(0, entry.name.length - entryExt.length);
      if (nameWithoutSubExt === videoBaseName || nameWithoutSubExt.startsWith(videoBaseName + ".")) {
        companions.push(path.join(videoDir, entry.name));
      }
    }
  } catch {
    // Directory unreadable, return empty
  }

  return companions;
}

// Compute the new path for a companion subtitle based on old/new video paths
function computeNewSubtitlePath(
  subtitleAbsPath: string,
  oldVideoAbsPath: string,
  newVideoAbsPath: string
): string {
  const oldVideoExt = path.extname(oldVideoAbsPath);
  const oldVideoBase = path.basename(oldVideoAbsPath, oldVideoExt);
  const newVideoExt = path.extname(newVideoAbsPath);
  const newVideoBase = path.basename(newVideoAbsPath, newVideoExt);
  const newVideoDir = path.dirname(newVideoAbsPath);

  const subtitleName = path.basename(subtitleAbsPath);
  const subtitleExt = path.extname(subtitleName);
  const subtitleWithoutExt = subtitleName.slice(0, subtitleName.length - subtitleExt.length);

  // Extract suffix (language tags like ".en", ".forced.it", etc.)
  let suffix = "";
  if (subtitleWithoutExt.length > oldVideoBase.length) {
    suffix = subtitleWithoutExt.slice(oldVideoBase.length);
  }

  return path.join(newVideoDir, newVideoBase + suffix + subtitleExt);
}

// Process companion subtitle files after a video file was successfully operated on
async function processCompanionSubtitles(
  companionPaths: string[],
  oldVideoAbsPath: string,
  newVideoAbsPath: string,
  operation: "copy" | "move" | "rename",
  overwrite: boolean,
  destBase: string,
  createdDirs: Set<string>
): Promise<string[]> {
  const subtitleErrors: string[] = [];

  for (const subPath of companionPaths) {
    try {
      const newSubPath = computeNewSubtitlePath(subPath, oldVideoAbsPath, newVideoAbsPath);
      if (path.resolve(subPath) === path.resolve(newSubPath)) continue;

      // Create destination directory if needed (for copy/move)
      if (operation !== "rename") {
        const destDir = path.dirname(newSubPath);
        if (!createdDirs.has(destDir)) {
          await mkdirWithPermissions(destDir, destBase);
          createdDirs.add(destDir);
        }
      }

      // Check if destination exists
      try {
        await fs.access(newSubPath);
        if (!overwrite) continue; // Silently skip
        await fs.rm(newSubPath, { force: true });
      } catch {
        // Doesn't exist, proceed
      }

      if (operation === "rename") {
        await fs.rename(subPath, newSubPath);
      } else if (operation === "move") {
        try {
          await fs.rename(subPath, newSubPath);
        } catch {
          await fs.copyFile(subPath, newSubPath);
          await fs.unlink(subPath);
        }
      } else {
        await fs.copyFile(subPath, newSubPath);
      }

      await setFilePermissions(newSubPath);
    } catch (err) {
      subtitleErrors.push(`Subtitle failed: ${path.basename(subPath)} - ${(err as Error).message}`);
    }
  }

  return subtitleErrors;
}

export async function POST(request: NextRequest) {
  const body: BatchRenameRequest = await request.json();
  const { files, sourcePaths, destinationFolder, operation, overwrite = false, pane = "downloads", folderRenames, folderCreates, seasonFolderCreates } = body;

  // Validate request - support two modes:
  // 1. files array with explicit source->dest mappings (for identify/rename)
  // 2. sourcePaths + destinationFolder (for normal copy/move - filename preserved)
  let fileList: FileRename[] = [];

  if (files && Array.isArray(files) && files.length > 0) {
    // Mode 1: Explicit file mappings
    fileList = files;
  } else if (sourcePaths && Array.isArray(sourcePaths) && sourcePaths.length > 0 && destinationFolder !== undefined) {
    // Mode 2: Source paths with destination folder (filename preserved)
    fileList = sourcePaths.map(sourcePath => {
      const fileName = sourcePath.split("/").pop() || sourcePath.split("\\").pop() || sourcePath;
      return {
        sourcePath,
        destinationPath: destinationFolder ? `${destinationFolder}/${fileName}` : fileName,
      };
    });
  } else {
    return new Response(
      JSON.stringify({ type: "error", message: "Either 'files' array or 'sourcePaths' with 'destinationFolder' is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (operation !== "copy" && operation !== "move" && operation !== "rename") {
    return new Response(
      JSON.stringify({ type: "error", message: "operation must be 'copy', 'move', or 'rename'" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Use fileList instead of files from here on
  const files_to_process = fileList;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendProgress = (update: ProgressUpdate) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(update)}\n\n`));
      };

      try {
        const downloadBase = getBasePath("downloads");
        const mediaBase = getBasePath("media");
        // For rename operation, use the appropriate base based on pane
        // For copy/move, source is always from downloads
        const sourceBase = operation === "rename" ? getBasePath(pane) : downloadBase;

        let completed = 0;
        let failed = 0;
        const errors: string[] = [];
        const total = files_to_process.length;

        // Track created directories to avoid duplicate mkdir calls
        const createdDirs = new Set<string>();

        for (let i = 0; i < files_to_process.length; i++) {
          const file = files_to_process[i];

          // Send progress update
          sendProgress({
            type: "progress",
            current: i + 1,
            total,
            currentFile: file.destinationPath.split("/").pop() || file.sourcePath,
            completed,
            failed,
            errors,
          });

          try {
            // Validate source is in the appropriate base (downloads for copy/move, pane-specific for rename)
            const sourceValidation = await validatePath(sourceBase, file.sourcePath);
            if (!sourceValidation.valid) {
              errors.push(`Invalid source: ${file.sourcePath}`);
              failed++;
              continue;
            }
            const sourceFull = sourceValidation.absolutePath;

            // Get file size for progress (optional, could be used for byte-level progress)
            const sourceStats = await fs.stat(sourceFull);
            const fileSize = sourceStats.size;

            // Discover companion subtitle files before any operation
            const isVideoFile = !sourceStats.isDirectory() &&
              VIDEO_EXTENSIONS.includes(path.extname(sourceFull).toLowerCase());
            const companionSubtitles = isVideoFile ? await findCompanionSubtitles(sourceFull) : [];

            let destFull: string;
            let destBase: string;

            if (operation === "rename") {
              // For rename operation, destination is in the same folder as source
              // destinationPath should be just the new filename
              const newFileName = file.destinationPath
                .replace(/\\/g, "/")
                .split("/")
                .pop() || file.destinationPath;

              if (!newFileName || newFileName.includes("..")) {
                errors.push(`Invalid filename: ${file.destinationPath}`);
                failed++;
                continue;
              }

              const sourceDir = path.dirname(sourceFull);
              destFull = path.join(sourceDir, newFileName);
              destBase = sourceBase; // Use the same base as source (could be downloads or media)

              // Security check for rename
              const normalizedDest = path.resolve(destFull);
              const normalizedBase = path.resolve(sourceBase);
              if (!normalizedDest.startsWith(normalizedBase + path.sep) && normalizedDest !== normalizedBase) {
                errors.push(`Invalid path: ${file.destinationPath}`);
                failed++;
                continue;
              }
            } else {
              // For copy/move, destination is in media folder
              // Build destination path manually
              const sanitizedDest = file.destinationPath
                .replace(/\\/g, "/")
                .replace(/^\/+/, "")
                .split("/")
                .filter(part => part !== ".." && part !== "." && part.length > 0)
                .join("/");

              if (!sanitizedDest) {
                errors.push(`Invalid destination: ${file.destinationPath}`);
                failed++;
                continue;
              }

              destFull = path.join(mediaBase, sanitizedDest);
              destBase = mediaBase;

              // Security check
              const normalizedDest = path.resolve(destFull);
              const normalizedBase = path.resolve(mediaBase);
              if (!normalizedDest.startsWith(normalizedBase + path.sep) && normalizedDest !== normalizedBase) {
                errors.push(`Invalid path: ${file.destinationPath}`);
                failed++;
                continue;
              }
            }

            // Create destination directory if needed with proper permissions on ALL levels
            // (not needed for rename operation since we stay in the same folder)
            if (operation !== "rename") {
              const destDir = path.dirname(destFull);
              if (!createdDirs.has(destDir)) {
                await mkdirWithPermissions(destDir, destBase);
                createdDirs.add(destDir);
              }
            }

            // Check if destination already exists
            try {
              await fs.access(destFull);
              if (!overwrite) {
                errors.push(`Already exists: ${file.destinationPath.split("/").pop()}`);
                failed++;
                continue;
              }
              // If overwrite is true, we'll overwrite the file
            } catch {
              // File doesn't exist, proceed
            }

            const currentFileName = file.destinationPath.split("/").pop() || file.sourcePath;
            const isDirectory = sourceStats.isDirectory();

            // For rename operation, just use fs.rename (always same filesystem)
            if (operation === "rename") {
              // Skip if source and destination are the same (file already correctly named)
              if (sourceFull === destFull) {
                sendProgress({
                  type: "file_progress",
                  current: i + 1,
                  total,
                  currentFile: currentFileName,
                  completed,
                  failed,
                  errors,
                  bytesCopied: fileSize,
                  bytesTotal: fileSize,
                  bytesPerSecond: 0,
                });
                completed++;
                continue;
              }

              // If overwriting, remove existing destination first
              if (overwrite) {
                try {
                  await fs.rm(destFull, { recursive: true, force: true });
                } catch {
                  // Ignore if doesn't exist
                }
              }

              await fs.rename(sourceFull, destFull);
              // Send instant completion for this file
              sendProgress({
                type: "file_progress",
                current: i + 1,
                total,
                currentFile: currentFileName,
                completed,
                failed,
                errors,
                bytesCopied: fileSize,
                bytesTotal: fileSize,
                bytesPerSecond: 0, // Instant, no meaningful speed
              });
              completed++;
              continue;
            }

            // For move operations, try fs.rename first (instant on same filesystem)
            // Only fall back to copy+delete if rename fails (cross-device move)
            let usedRename = false;
            if (operation === "move") {
              // Skip if source and destination are the same (file already in correct location)
              if (sourceFull === destFull) {
                sendProgress({
                  type: "file_progress",
                  current: i + 1,
                  total,
                  currentFile: currentFileName,
                  completed,
                  failed,
                  errors,
                  bytesCopied: fileSize,
                  bytesTotal: fileSize,
                  bytesPerSecond: 0,
                });
                completed++;
                continue;
              }

              // If overwriting, remove existing destination first
              if (overwrite) {
                try {
                  await fs.rm(destFull, { recursive: true, force: true });
                } catch {
                  // Ignore if doesn't exist
                }
              }

              try {
                await fs.rename(sourceFull, destFull);
                usedRename = true;
                // Set permissions on renamed file/directory
                if (isDirectory) {
                  await setDirectoryPermissions(destFull);
                } else {
                  await setFilePermissions(destFull);
                }
                // Send instant completion for this file
                sendProgress({
                  type: "file_progress",
                  current: i + 1,
                  total,
                  currentFile: currentFileName,
                  completed,
                  failed,
                  errors,
                  bytesCopied: fileSize,
                  bytesTotal: fileSize,
                  bytesPerSecond: 0, // Instant, no meaningful speed
                });
              } catch {
                // For any rename error (EXDEV, EPERM, etc.), fall back to copy+delete
                // This handles cross-device moves and permission issues in Docker
              }
            }

            // If we didn't use rename (either copy operation or cross-device move)
            if (!usedRename) {
              if (isDirectory) {
                // For directories, copy with progress tracking
                // Track last progress update time to throttle updates
                let lastProgressUpdate = 0;
                const progressThrottle = 100; // ms between updates

                // Track timing for speed calculation using exponential moving average
                const copyStartTime = Date.now();
                let smoothedSpeed = 0;
                let lastBytesCopied = 0;
                let lastSpeedUpdate = copyStartTime;
                const smoothingFactor = 0.3; // Lower = smoother but slower to respond

                // If overwriting (and not already handled by move), remove existing destination first
                if (overwrite && operation !== "move") {
                  try {
                    await fs.rm(destFull, { recursive: true, force: true });
                  } catch {
                    // Ignore if doesn't exist
                  }
                }

                // Copy directory with progress reporting
                await copyDirectoryWithProgress(sourceFull, destFull, mediaBase, (bytesCopied, bytesTotal) => {
                  const now = Date.now();
                  // Only send update if enough time has passed or we're at 100%
                  if (now - lastProgressUpdate >= progressThrottle || bytesCopied === bytesTotal) {
                    // Calculate instantaneous speed
                    const timeDelta = (now - lastSpeedUpdate) / 1000; // Convert to seconds
                    const bytesDelta = bytesCopied - lastBytesCopied;
                    const instantSpeed = timeDelta > 0 ? bytesDelta / timeDelta : 0;

                    // Apply exponential moving average for smooth speed display
                    if (smoothedSpeed === 0) {
                      smoothedSpeed = instantSpeed;
                    } else {
                      smoothedSpeed = smoothingFactor * instantSpeed + (1 - smoothingFactor) * smoothedSpeed;
                    }

                    lastProgressUpdate = now;
                    lastSpeedUpdate = now;
                    lastBytesCopied = bytesCopied;

                    sendProgress({
                      type: "file_progress",
                      current: i + 1,
                      total,
                      currentFile: currentFileName,
                      completed,
                      failed,
                      errors,
                      bytesCopied,
                      bytesTotal,
                      bytesPerSecond: Math.round(smoothedSpeed),
                    });
                  }
                });

                // For move operation (cross-device), delete source directory after successful copy
                if (operation === "move") {
                  await fs.rm(sourceFull, { recursive: true, force: true });
                }
              } else {
                // For files, use streaming copy with progress reporting
                // Track last progress update time to throttle updates
                let lastProgressUpdate = 0;
                const progressThrottle = 100; // ms between updates

                // Track timing for speed calculation using exponential moving average
                const copyStartTime = Date.now();
                let smoothedSpeed = 0;
                let lastBytesCopied = 0;
                let lastSpeedUpdate = copyStartTime;
                const smoothingFactor = 0.3; // Lower = smoother but slower to respond

                // If overwriting (and not already handled by move), remove existing destination first
                if (overwrite && operation !== "move") {
                  try {
                    await fs.rm(destFull, { recursive: true, force: true });
                  } catch {
                    // Ignore if doesn't exist
                  }
                }

                // Copy file with progress reporting
                await copyFileWithProgress(sourceFull, destFull, (bytesCopied, bytesTotal) => {
                  const now = Date.now();
                  // Only send update if enough time has passed or we're at 100%
                  if (now - lastProgressUpdate >= progressThrottle || bytesCopied === bytesTotal) {
                    // Calculate instantaneous speed
                    const timeDelta = (now - lastSpeedUpdate) / 1000; // Convert to seconds
                    const bytesDelta = bytesCopied - lastBytesCopied;
                    const instantSpeed = timeDelta > 0 ? bytesDelta / timeDelta : 0;

                    // Apply exponential moving average for smooth speed display
                    if (smoothedSpeed === 0) {
                      smoothedSpeed = instantSpeed;
                    } else {
                      smoothedSpeed = smoothingFactor * instantSpeed + (1 - smoothingFactor) * smoothedSpeed;
                    }

                    lastProgressUpdate = now;
                    lastSpeedUpdate = now;
                    lastBytesCopied = bytesCopied;

                    sendProgress({
                      type: "file_progress",
                      current: i + 1,
                      total,
                      currentFile: currentFileName,
                      completed,
                      failed,
                      errors,
                      bytesCopied,
                      bytesTotal,
                      bytesPerSecond: Math.round(smoothedSpeed),
                    });
                  }
                });

                // For move operation (cross-device), delete source after successful copy
                if (operation === "move") {
                  await fs.unlink(sourceFull);
                }
              }
            }

            // Set proper file permissions and ownership (for Unraid/Docker compatibility)
            // Use setFilePermissions for files, directories already handled by mkdirWithPermissions
            if (!isDirectory) {
              await setFilePermissions(destFull);
            }

            // Process companion subtitle files (rename/copy/move alongside the video)
            if (companionSubtitles.length > 0) {
              const subErrors = await processCompanionSubtitles(
                companionSubtitles,
                sourceFull,
                destFull,
                operation,
                overwrite,
                destBase,
                createdDirs
              );
              if (subErrors.length > 0) {
                errors.push(...subErrors);
              }
            }

            completed++;
          } catch (err) {
            failed++;
            errors.push(
              `Failed: ${file.sourcePath.split("/").pop() || "file"}`
            );
          }
        }

        // Note: empty source directories are intentionally NOT cleaned up after move operations.
        // Users may want to keep their folder structure intact.

        // Create main folders (and optional subfolders) and move files into them (for rename operation only)
        if (operation === "rename" && folderCreates && folderCreates.length > 0) {
          console.log("\n[FOLDER-CREATE] Starting folder creation process");
          console.log("[FOLDER-CREATE] Total folder creates:", folderCreates.length);
          console.log("[FOLDER-CREATE] Folder creates list:", JSON.stringify(folderCreates, null, 2));

          // Group by folder structure to avoid duplicate creation
          const folderGroups = new Map<string, FolderCreate[]>();

          for (const create of folderCreates) {
            // Key is the full folder path (folderName/subfolderName or just folderName)
            const key = create.subfolderName
              ? `${create.folderName}/${create.subfolderName}`
              : create.folderName;
            const group = folderGroups.get(key) || [];
            group.push(create);
            folderGroups.set(key, group);
          }

          console.log("[FOLDER-CREATE] Grouped by folder structure:", Array.from(folderGroups.keys()));

          for (const [folderPath, creates] of folderGroups) {
            console.log("\n[FOLDER-CREATE] Processing folder structure:", folderPath);
            console.log("[FOLDER-CREATE] Number of files for this folder:", creates.length);
            try {
              const firstCreate = creates[0];
              console.log("[FOLDER-CREATE] First file path:", firstCreate.filePath);

              // Build the directory path from the original file location
              const normalizedFilePath = firstCreate.filePath.replace(/\\/g, "/").replace(/^\/+/, "");
              console.log("[FOLDER-CREATE] Normalized file path:", normalizedFilePath);
              const filePathParts = normalizedFilePath.split("/");
              console.log("[FOLDER-CREATE] File path parts:", filePathParts);
              filePathParts.pop(); // Remove filename

              // Get the parent directory where files currently are
              const currentDirPath = filePathParts.join("/");
              console.log("[FOLDER-CREATE] Current directory path:", currentDirPath);
              const currentDir = currentDirPath
                ? path.join(sourceBase, currentDirPath)
                : sourceBase;
              console.log("[FOLDER-CREATE] Current directory absolute:", currentDir);

              // Build the target folder structure
              const targetFolderPath = firstCreate.subfolderName
                ? path.join(currentDir, firstCreate.folderName, firstCreate.subfolderName)
                : path.join(currentDir, firstCreate.folderName);
              console.log("[FOLDER-CREATE] Target folder path:", targetFolderPath);

              // Security check
              const normalizedTarget = path.resolve(targetFolderPath);
              const normalizedBase = path.resolve(sourceBase);
              console.log("[FOLDER-CREATE] Normalized target:", normalizedTarget);
              console.log("[FOLDER-CREATE] Normalized base:", normalizedBase);
              if (!normalizedTarget.startsWith(normalizedBase)) {
                console.log("[FOLDER-CREATE] ❌ SKIPPED: Security check failed - path is outside base");
                continue;
              }

              // Create the folder structure
              try {
                await fs.access(targetFolderPath);
                console.log("[FOLDER-CREATE] Target folder already exists");
              } catch {
                console.log("[FOLDER-CREATE] Creating folder structure with permissions...");
                await mkdirWithPermissions(targetFolderPath, sourceBase);
                console.log("[FOLDER-CREATE] ✅ Folder structure created successfully");
              }

              // Move each file into the target folder
              console.log("[FOLDER-CREATE] Moving files into folder...");
              for (const create of creates) {
                console.log("\n[FOLDER-CREATE] Processing file:", create.filePath);
                console.log("[FOLDER-CREATE] New filename:", create.newFileName);
                try {
                  // Build the file's current location
                  const createNormalized = create.filePath.replace(/\\/g, "/").replace(/^\/+/, "");
                  const createParts = createNormalized.split("/");
                  const originalFileName = createParts.pop();
                  console.log("[FOLDER-CREATE] Original filename:", originalFileName);
                  const createDirPath = createParts.join("/");
                  console.log("[FOLDER-CREATE] File directory path:", createDirPath);
                  const fileParentDir = createDirPath
                    ? path.join(sourceBase, createDirPath)
                    : sourceBase;
                  console.log("[FOLDER-CREATE] File parent directory:", fileParentDir);

                  // Check for renamed file first, then original
                  const newFilePath = path.join(fileParentDir, create.newFileName);
                  const originalFilePath = path.join(fileParentDir, originalFileName || "");
                  console.log("[FOLDER-CREATE] New file path to check:", newFilePath);
                  console.log("[FOLDER-CREATE] Original file path to check:", originalFilePath);

                  let currentFilePath: string;
                  try {
                    await fs.access(newFilePath);
                    currentFilePath = newFilePath;
                    console.log("[FOLDER-CREATE] ✓ Found file at new path");
                  } catch {
                    try {
                      await fs.access(originalFilePath);
                      currentFilePath = originalFilePath;
                      console.log("[FOLDER-CREATE] ✓ Found file at original path");
                    } catch {
                      console.log("[FOLDER-CREATE] ❌ SKIPPED: File not found at either path");
                      continue;
                    }
                  }

                  const destFilePath = path.join(targetFolderPath, path.basename(currentFilePath));
                  console.log("[FOLDER-CREATE] Destination file path:", destFilePath);

                  // Check if file is already in the target folder
                  if (path.resolve(fileParentDir) === path.resolve(targetFolderPath)) {
                    console.log("[FOLDER-CREATE] ⏭️  SKIPPED: File already in target folder");
                    continue;
                  }

                  // Move the file
                  console.log("[FOLDER-CREATE] Moving file...");
                  await fs.rename(currentFilePath, destFilePath);
                  await setFilePermissions(destFilePath);
                  console.log("[FOLDER-CREATE] ✅ File moved successfully");

                  // Move companion subtitle files
                  if (VIDEO_EXTENSIONS.includes(path.extname(currentFilePath).toLowerCase())) {
                    const companions = await findCompanionSubtitles(currentFilePath);
                    for (const subPath of companions) {
                      try {
                        const subDest = path.join(targetFolderPath, path.basename(subPath));
                        await fs.rename(subPath, subDest);
                        await setFilePermissions(subDest);
                        console.log("[FOLDER-CREATE] ✅ Companion subtitle moved:", path.basename(subPath));
                      } catch {
                        // Ignore subtitle move errors in folder creation
                      }
                    }
                  }
                } catch (err) {
                  console.log("[FOLDER-CREATE] ❌ ERROR moving file:", (err as Error).message);
                }
              }
            } catch (err) {
              console.log("[FOLDER-CREATE] ❌ ERROR processing folder creation:", (err as Error).message);
            }
          }
          console.log("\n[FOLDER-CREATE] Folder creation process complete");
        }

        // Create season folders and move files into them (for rename operation only)
        if (operation === "rename" && seasonFolderCreates && seasonFolderCreates.length > 0) {
          console.log("\n[SEASON-FOLDER] Starting season folder creation process");
          console.log("[SEASON-FOLDER] Total season folder creates:", seasonFolderCreates.length);
          console.log("[SEASON-FOLDER] Season folder creates list:", JSON.stringify(seasonFolderCreates, null, 2));

          // Group by season folder to avoid creating the same folder multiple times
          // Each entry contains: { filePath (original), newFileName (after rename), seasonFolder }
          const folderGroups = new Map<string, SeasonFolderCreate[]>();

          for (const create of seasonFolderCreates) {
            const group = folderGroups.get(create.seasonFolder) || [];
            group.push(create);
            folderGroups.set(create.seasonFolder, group);
          }

          console.log("[SEASON-FOLDER] Grouped by season folder:", Array.from(folderGroups.keys()));

          for (const [seasonFolder, creates] of folderGroups) {
            console.log("\n[SEASON-FOLDER] Processing season folder:", seasonFolder);
            console.log("[SEASON-FOLDER] Number of files for this season:", creates.length);
            try {
              // Build the parent directory path manually from the original file path
              // We can't use validatePath because the original file no longer exists (it was renamed)
              const firstCreate = creates[0];
              console.log("[SEASON-FOLDER] First file path:", firstCreate.filePath);
              const normalizedFilePath = firstCreate.filePath.replace(/\\/g, "/").replace(/^\/+/, "");
              console.log("[SEASON-FOLDER] Normalized file path:", normalizedFilePath);
              const filePathParts = normalizedFilePath.split("/");
              console.log("[SEASON-FOLDER] File path parts:", filePathParts);
              filePathParts.pop(); // Remove filename to get directory path
              let dirRelativePath = filePathParts.join("/");
              console.log("[SEASON-FOLDER] Directory relative path (before season check):", dirRelativePath);

              // Check if file is currently inside a season folder - if so, go up one level
              // Season folder should be created at the series level, not inside another season folder
              const lastDirPart = filePathParts[filePathParts.length - 1];
              console.log("[SEASON-FOLDER] Last directory part:", lastDirPart);
              const isInsideSeasonFolder = lastDirPart && /Season\s*\d{1,2}/i.test(lastDirPart);
              console.log("[SEASON-FOLDER] Is inside season folder?", isInsideSeasonFolder);
              if (isInsideSeasonFolder && filePathParts.length > 1) {
                filePathParts.pop(); // Remove the current season folder
                dirRelativePath = filePathParts.join("/");
                console.log("[SEASON-FOLDER] Adjusted directory relative path (went up one level):", dirRelativePath);
              }

              // Build absolute path for the series directory (where season folders should be)
              const seriesDir = dirRelativePath
                ? path.join(sourceBase, dirRelativePath)
                : sourceBase;
              console.log("[SEASON-FOLDER] Series directory path:", seriesDir);
              console.log("[SEASON-FOLDER] Source base:", sourceBase);

              // Security check - ensure we're still within sourceBase
              const normalizedSeriesDir = path.resolve(seriesDir);
              const normalizedBase = path.resolve(sourceBase);
              console.log("[SEASON-FOLDER] Normalized series dir:", normalizedSeriesDir);
              console.log("[SEASON-FOLDER] Normalized base:", normalizedBase);
              if (!normalizedSeriesDir.startsWith(normalizedBase)) {
                console.log("[SEASON-FOLDER] ❌ SKIPPED: Security check failed - path is outside base");
                continue;
              }

              // Verify series directory exists
              try {
                const seriesDirStats = await fs.stat(seriesDir);
                if (!seriesDirStats.isDirectory()) {
                  console.log("[SEASON-FOLDER] ❌ SKIPPED: Series path exists but is not a directory");
                  continue;
                }
                console.log("[SEASON-FOLDER] ✓ Series directory exists");
              } catch (err) {
                console.log("[SEASON-FOLDER] ❌ SKIPPED: Series directory does not exist:", (err as Error).message);
                continue;
              }

              const seasonFolderFull = path.join(seriesDir, seasonFolder);
              console.log("[SEASON-FOLDER] Season folder full path:", seasonFolderFull);

              // Create the season folder if it doesn't exist
              try {
                await fs.access(seasonFolderFull);
                console.log("[SEASON-FOLDER] Season folder already exists");
              } catch {
                // Create the folder with proper permissions on ALL intermediate directories
                // This handles nested paths like "Series (2023)/Season 01"
                console.log("[SEASON-FOLDER] Creating season folder with permissions...");
                await mkdirWithPermissions(seasonFolderFull, seriesDir);
                console.log("[SEASON-FOLDER] ✅ Season folder created successfully");
              }

              // Move each file into the season folder
              // Files have already been renamed, so we need to use the new filename
              console.log("[SEASON-FOLDER] Moving files into season folder...");
              for (const create of creates) {
                console.log("\n[SEASON-FOLDER] Processing file:", create.filePath);
                console.log("[SEASON-FOLDER] New filename:", create.newFileName);
                try {
                  // Build the file's current location path manually
                  const createNormalized = create.filePath.replace(/\\/g, "/").replace(/^\/+/, "");
                  const createParts = createNormalized.split("/");
                  const originalFileName = createParts.pop(); // Remove and store original filename
                  console.log("[SEASON-FOLDER] Original filename:", originalFileName);
                  const createDirPath = createParts.join("/");
                  console.log("[SEASON-FOLDER] File directory path:", createDirPath);
                  const fileParentDir = createDirPath
                    ? path.join(sourceBase, createDirPath)
                    : sourceBase;
                  console.log("[SEASON-FOLDER] File parent directory:", fileParentDir);

                  // The file might have the new name (if renamed) or original name (if skipped/same)
                  const newFilePath = path.join(fileParentDir, create.newFileName);
                  const originalFilePath = path.join(fileParentDir, originalFileName || "");
                  console.log("[SEASON-FOLDER] New file path to check:", newFilePath);
                  console.log("[SEASON-FOLDER] Original file path to check:", originalFilePath);

                  // First try the new filename, then fallback to original
                  let currentFilePath: string;
                  try {
                    await fs.access(newFilePath);
                    currentFilePath = newFilePath;
                    console.log("[SEASON-FOLDER] ✓ Found file at new path");
                  } catch {
                    // Try original filename
                    try {
                      await fs.access(originalFilePath);
                      currentFilePath = originalFilePath;
                      console.log("[SEASON-FOLDER] ✓ Found file at original path");
                    } catch {
                      console.log("[SEASON-FOLDER] ❌ SKIPPED: File not found at either path");
                      continue;
                    }
                  }

                  const destFilePath = path.join(seasonFolderFull, path.basename(currentFilePath));
                  console.log("[SEASON-FOLDER] Destination file path:", destFilePath);

                  // Check if file is already in the season folder
                  if (path.resolve(fileParentDir) === path.resolve(seasonFolderFull)) {
                    console.log("[SEASON-FOLDER] ⏭️  SKIPPED: File already in season folder");
                    continue;
                  }

                  // Move the file
                  console.log("[SEASON-FOLDER] Moving file...");
                  await fs.rename(currentFilePath, destFilePath);
                  await setFilePermissions(destFilePath);
                  console.log("[SEASON-FOLDER] ✅ File moved successfully");

                  // Move companion subtitle files
                  if (VIDEO_EXTENSIONS.includes(path.extname(currentFilePath).toLowerCase())) {
                    const companions = await findCompanionSubtitles(currentFilePath);
                    for (const subPath of companions) {
                      try {
                        const subDest = path.join(seasonFolderFull, path.basename(subPath));
                        await fs.rename(subPath, subDest);
                        await setFilePermissions(subDest);
                        console.log("[SEASON-FOLDER] ✅ Companion subtitle moved:", path.basename(subPath));
                      } catch {
                        // Ignore subtitle move errors
                      }
                    }
                  }
                } catch (err) {
                  console.log("[SEASON-FOLDER] ❌ ERROR moving file:", (err as Error).message);
                  // Ignore move errors
                }
              }
            } catch (err) {
              console.log("[SEASON-FOLDER] ❌ ERROR processing season folder:", (err as Error).message);
              // Ignore folder creation errors
            }
          }
          console.log("\n[SEASON-FOLDER] Season folder creation process complete");
        }

        // Rename folders if requested (for rename operation only)
        // folderRenames should be sorted deepest first to avoid conflicts
        const folderRenameErrors: string[] = [];
        if (operation === "rename" && folderRenames && folderRenames.length > 0) {
          console.log("[FOLDER-RENAME] Starting folder rename process");
          console.log("[FOLDER-RENAME] Total folders to rename:", folderRenames.length);
          console.log("[FOLDER-RENAME] Folder renames list:", JSON.stringify(folderRenames, null, 2));

          // Track renamed folders to update paths for subsequent renames
          const renamedPaths = new Map<string, string>(); // oldPath -> newPath

          for (const folderRename of folderRenames) {
            console.log("\n[FOLDER-RENAME] Processing folder:", folderRename.oldPath, "->", folderRename.newName);
            try {
              // Apply any previous renames to the path
              let currentOldPath = folderRename.oldPath;
              console.log("[FOLDER-RENAME] Original path:", currentOldPath);

              for (const [oldP, newP] of renamedPaths) {
                if (currentOldPath.startsWith(oldP + "/")) {
                  currentOldPath = newP + currentOldPath.slice(oldP.length);
                  console.log("[FOLDER-RENAME] Updated path after previous rename:", currentOldPath);
                } else if (currentOldPath === oldP) {
                  currentOldPath = newP;
                  console.log("[FOLDER-RENAME] Path matches previous rename:", currentOldPath);
                }
              }

              // Build the full path manually (don't use validatePath as it requires the folder to exist for realpath)
              const sanitizedPath = currentOldPath
                .replace(/\\/g, "/")
                .replace(/^\/+/, "")
                .split("/")
                .filter(part => part !== ".." && part !== "." && part.length > 0)
                .join("/");

              console.log("[FOLDER-RENAME] Sanitized path:", sanitizedPath);

              const folderFull = path.join(sourceBase, sanitizedPath);
              console.log("[FOLDER-RENAME] Full folder path:", folderFull);
              console.log("[FOLDER-RENAME] Source base:", sourceBase);

              // Security check
              const normalizedFolder = path.resolve(folderFull);
              const normalizedBase = path.resolve(sourceBase);
              console.log("[FOLDER-RENAME] Normalized folder:", normalizedFolder);
              console.log("[FOLDER-RENAME] Normalized base:", normalizedBase);

              if (!normalizedFolder.startsWith(normalizedBase + path.sep) && normalizedFolder !== normalizedBase) {
                console.log("[FOLDER-RENAME] ❌ SKIPPED: Security check failed - path is outside base");
                continue;
              }

              // Check if it's actually a directory
              try {
                const stats = await fs.stat(folderFull);
                if (!stats.isDirectory()) {
                  console.log("[FOLDER-RENAME] ❌ SKIPPED: Path exists but is not a directory");
                  continue;
                }
                console.log("[FOLDER-RENAME] ✓ Path exists and is a directory");
              } catch (err) {
                console.log("[FOLDER-RENAME] ❌ SKIPPED: Directory does not exist or cannot be accessed:", (err as Error).message);
                continue;
              }

              // Build new folder path (same parent, new name)
              const parentDir = path.dirname(folderFull);
              const newFolderFull = path.join(parentDir, folderRename.newName);
              console.log("[FOLDER-RENAME] Parent directory:", parentDir);
              console.log("[FOLDER-RENAME] New folder full path:", newFolderFull);

              // Skip if already has the correct name
              if (path.basename(folderFull) === folderRename.newName) {
                console.log("[FOLDER-RENAME] ⏭️  SKIPPED: Folder already has the correct name");
                continue;
              }

              // Check if destination already exists
              try {
                await fs.access(newFolderFull);
                // Destination exists - skip this rename to avoid data loss
                console.log("[FOLDER-RENAME] ⏭️  SKIPPED: Destination already exists");
                continue;
              } catch {
                // Good - destination doesn't exist
                console.log("[FOLDER-RENAME] ✓ Destination does not exist, proceeding with rename");
              }

              // Rename the folder with retry logic for Windows EPERM errors
              // Windows can temporarily lock folders that were recently accessed
              let renameSuccess = false;
              const maxRetries = 3;
              const retryDelay = 500; // ms

              for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                  console.log(`[FOLDER-RENAME] Attempting rename (attempt ${attempt}/${maxRetries})`);
                  await fs.rename(folderFull, newFolderFull);
                  await setDirectoryPermissions(newFolderFull);
                  renameSuccess = true;
                  console.log("[FOLDER-RENAME] ✅ SUCCESS: Folder renamed successfully");
                  break;
                } catch (renameErr: unknown) {
                  const errCode = (renameErr as NodeJS.ErrnoException).code;
                  console.log(`[FOLDER-RENAME] ⚠️  Rename attempt ${attempt} failed:`, errCode, (renameErr as Error).message);

                  // EPERM on Windows often means the folder is temporarily locked
                  if (errCode === "EPERM" && attempt < maxRetries) {
                    console.log(`[FOLDER-RENAME] Waiting ${retryDelay}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue;
                  }

                  throw renameErr;
                }
              }

              if (renameSuccess) {
                // Track the rename for updating subsequent paths
                const newPath = sanitizedPath.replace(/[^/]+$/, folderRename.newName);
                renamedPaths.set(sanitizedPath, newPath);
                console.log("[FOLDER-RENAME] Tracked rename mapping:", sanitizedPath, "->", newPath);
              }
            } catch (err) {
              console.log("[FOLDER-RENAME] ❌ ERROR:", (err as Error).message);
              // Check for Windows EPERM specifically
              if ((err as NodeJS.ErrnoException).code === "EPERM") {
                folderRenameErrors.push(`Folder "${folderRename.oldPath}" is locked (close any programs using it)`);
              } else {
                folderRenameErrors.push(`Folder rename failed: ${folderRename.oldPath} → ${folderRename.newName}`);
              }
            }
          }
          console.log("\n[FOLDER-RENAME] Folder rename process complete");
          console.log("[FOLDER-RENAME] Rename errors:", folderRenameErrors);
        }

        // Combine file errors with folder rename errors
        const allErrors = [...errors, ...folderRenameErrors];
        const totalFailed = failed + folderRenameErrors.length;

        // Build completion message
        let message = "All files processed successfully";
        if (totalFailed > 0) {
          if (failed > 0 && folderRenameErrors.length > 0) {
            message = `Completed with ${failed} file error(s) and ${folderRenameErrors.length} folder error(s)`;
          } else if (folderRenameErrors.length > 0) {
            message = `Files processed, but ${folderRenameErrors.length} folder rename(s) failed`;
          } else {
            message = `Completed with ${failed} error(s)`;
          }
        }

        // Send completion
        sendProgress({
          type: "complete",
          current: total,
          total,
          completed,
          failed: totalFailed,
          errors: allErrors,
          message,
        });
      } catch (error) {
        sendProgress({
          type: "error",
          current: 0,
          total: files_to_process.length,
          completed: 0,
          failed: files_to_process.length,
          errors: [error instanceof Error ? error.message : "Unknown error"],
          message: "Operation failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
