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

interface FileRename {
  sourcePath: string;
  destinationPath: string;
}

interface FolderRename {
  oldPath: string; // Relative path to the folder (from the scanned base)
  newName: string; // New folder name (just the name, not path)
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

export async function POST(request: NextRequest) {
  const body: BatchRenameRequest = await request.json();
  const { files, sourcePaths, destinationFolder, operation, overwrite = false, pane = "downloads", folderRenames, seasonFolderCreates } = body;

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
                console.log(`[SKIP] File already correctly named: ${currentFileName}`);
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
                console.log(`[SKIP] File already in correct location: ${currentFileName}`);
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
              } catch (renameErr: unknown) {
                const errCode = (renameErr as NodeJS.ErrnoException).code;
                // Log the error for debugging
                console.log(`fs.rename failed: ${errCode} - falling back to copy+delete`);
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

            completed++;
          } catch (err) {
            failed++;
            errors.push(
              `Failed: ${file.sourcePath.split("/").pop() || "file"}`
            );
          }
        }

        // Clean up empty source directories for move operations
        if (operation === "move" && completed > 0) {
          const sourceDirs = new Set<string>();

          for (const file of files_to_process) {
            try {
              const sourceValidation = await validatePath(downloadBase, file.sourcePath);
              if (sourceValidation.valid) {
                sourceDirs.add(path.dirname(sourceValidation.absolutePath));
              }
            } catch {
              // Skip
            }
          }

          const sortedDirs = [...sourceDirs].sort(
            (a, b) => b.split(path.sep).length - a.split(path.sep).length
          );

          for (const dir of sortedDirs) {
            try {
              const entries = await fs.readdir(dir);
              if (entries.length === 0) {
                await fs.rmdir(dir);
              }
            } catch {
              // Skip
            }
          }
        }

        // Create season folders and move files into them (for rename operation only)
        console.log(`[SEASON CREATE] Checking: operation=${operation}, seasonFolderCreates=${seasonFolderCreates ? JSON.stringify(seasonFolderCreates) : 'undefined'}`);
        if (operation === "rename" && seasonFolderCreates && seasonFolderCreates.length > 0) {
          console.log(`[SEASON CREATE] Received: ${seasonFolderCreates.length} items`);

          // Group by season folder to avoid creating the same folder multiple times
          // Each entry contains: { filePath (original), newFileName (after rename), seasonFolder }
          const folderGroups = new Map<string, SeasonFolderCreate[]>();

          for (const create of seasonFolderCreates) {
            const group = folderGroups.get(create.seasonFolder) || [];
            group.push(create);
            folderGroups.set(create.seasonFolder, group);
          }

          console.log(`Grouped into ${folderGroups.size} season folders`);

          for (const [seasonFolder, creates] of folderGroups) {
            try {
              console.log(`Processing season folder: ${seasonFolder} with ${creates.length} files`);

              // Build the parent directory path manually from the original file path
              // We can't use validatePath because the original file no longer exists (it was renamed)
              const firstCreate = creates[0];
              const normalizedFilePath = firstCreate.filePath.replace(/\\/g, "/").replace(/^\/+/, "");
              const filePathParts = normalizedFilePath.split("/");
              filePathParts.pop(); // Remove filename to get directory path
              let dirRelativePath = filePathParts.join("/");

              console.log(`File path: ${firstCreate.filePath}, normalized: ${normalizedFilePath}, dirRelativePath: ${dirRelativePath}`);

              // Check if file is currently inside a season folder - if so, go up one level
              // Season folder should be created at the series level, not inside another season folder
              const lastDirPart = filePathParts[filePathParts.length - 1];
              const isInsideSeasonFolder = lastDirPart && /Season\s*\d{1,2}/i.test(lastDirPart);
              if (isInsideSeasonFolder && filePathParts.length > 1) {
                filePathParts.pop(); // Remove the current season folder
                dirRelativePath = filePathParts.join("/");
                console.log(`File is inside a season folder, going up one level: ${dirRelativePath}`);
              }

              // Build absolute path for the series directory (where season folders should be)
              const seriesDir = dirRelativePath
                ? path.join(sourceBase, dirRelativePath)
                : sourceBase;

              console.log(`Series dir: ${seriesDir}, sourceBase: ${sourceBase}`);

              // Security check - ensure we're still within sourceBase
              const normalizedSeriesDir = path.resolve(seriesDir);
              const normalizedBase = path.resolve(sourceBase);
              if (!normalizedSeriesDir.startsWith(normalizedBase)) {
                console.log(`Season folder create skipped - path escape detected: ${seriesDir}`);
                continue;
              }

              // Verify series directory exists
              try {
                const seriesDirStats = await fs.stat(seriesDir);
                if (!seriesDirStats.isDirectory()) {
                  console.log(`Season folder create skipped - series dir is not a directory: ${seriesDir}`);
                  continue;
                }
              } catch (statErr) {
                console.log(`Season folder create skipped - series directory not found: ${seriesDir}`, statErr);
                continue;
              }

              const seasonFolderFull = path.join(seriesDir, seasonFolder);
              console.log(`Season folder full path: ${seasonFolderFull}`);

              // Create the season folder if it doesn't exist
              try {
                await fs.access(seasonFolderFull);
                console.log(`Season folder already exists: ${seasonFolderFull}`);
              } catch {
                // Create the folder
                await fs.mkdir(seasonFolderFull, { mode: DIR_MODE });
                await setDirectoryPermissions(seasonFolderFull);
                console.log(`Created season folder: ${seasonFolderFull}`);
              }

              // Move each file into the season folder
              // Files have already been renamed, so we need to use the new filename
              for (const create of creates) {
                try {
                  // Build the file's current location path manually
                  const createNormalized = create.filePath.replace(/\\/g, "/").replace(/^\/+/, "");
                  const createParts = createNormalized.split("/");
                  const originalFileName = createParts.pop(); // Remove and store original filename
                  const createDirPath = createParts.join("/");
                  const fileParentDir = createDirPath
                    ? path.join(sourceBase, createDirPath)
                    : sourceBase;

                  // The file might have the new name (if renamed) or original name (if skipped/same)
                  const newFilePath = path.join(fileParentDir, create.newFileName);
                  const originalFilePath = path.join(fileParentDir, originalFileName || "");

                  console.log(`Looking for file - newFileName: ${create.newFileName}, originalFileName: ${originalFileName}`);
                  console.log(`Checking paths: new=${newFilePath}, original=${originalFilePath}`);

                  // First try the new filename, then fallback to original
                  let currentFilePath: string;
                  try {
                    await fs.access(newFilePath);
                    currentFilePath = newFilePath;
                    console.log(`Found file with new name: ${newFilePath}`);
                  } catch {
                    // Try original filename
                    try {
                      await fs.access(originalFilePath);
                      currentFilePath = originalFilePath;
                      console.log(`Found file with original name: ${originalFilePath}`);
                    } catch {
                      // List files in directory to debug
                      try {
                        const dirFiles = await fs.readdir(fileParentDir);
                        console.log(`Files in ${fileParentDir}:`, dirFiles);
                      } catch (e) {
                        console.log(`Could not list directory ${fileParentDir}:`, e);
                      }
                      console.log(`Season folder move skipped - file not found at either path`);
                      continue;
                    }
                  }

                  const destFilePath = path.join(seasonFolderFull, path.basename(currentFilePath));

                  // Check if file is already in the season folder
                  if (path.resolve(fileParentDir) === path.resolve(seasonFolderFull)) {
                    console.log(`File already in season folder, skipping`);
                    continue;
                  }

                  // Move the file
                  await fs.rename(currentFilePath, destFilePath);
                  await setFilePermissions(destFilePath);
                  console.log(`Moved file to season folder: ${currentFilePath} -> ${destFilePath}`);
                } catch (err) {
                  console.error(`Failed to move file to season folder: ${create.newFileName}`, err);
                }
              }
            } catch (err) {
              console.error(`Failed to create season folder: ${seasonFolder}`, err);
            }
          }
        } else {
          console.log(`[SEASON CREATE] Skipped: seasonFolderCreates=${seasonFolderCreates ? seasonFolderCreates.length : 'undefined'}, operation=${operation}`);
        }

        // Rename folders if requested (for rename operation only)
        // folderRenames should be sorted deepest first to avoid conflicts
        console.log(`[FOLDER RENAME] Checking: operation=${operation}, folderRenames=${folderRenames ? JSON.stringify(folderRenames) : 'undefined'}`);
        const folderRenameErrors: string[] = [];
        if (operation === "rename" && folderRenames && folderRenames.length > 0) {
          console.log(`[FOLDER RENAME] Received: ${folderRenames.length} items`);

          // Track renamed folders to update paths for subsequent renames
          const renamedPaths = new Map<string, string>(); // oldPath -> newPath

          for (const folderRename of folderRenames) {
            try {
              console.log(`[FOLDER RENAME] Processing: ${folderRename.oldPath} -> ${folderRename.newName}`);

              // Apply any previous renames to the path
              let currentOldPath = folderRename.oldPath;
              for (const [oldP, newP] of renamedPaths) {
                if (currentOldPath.startsWith(oldP + "/")) {
                  currentOldPath = newP + currentOldPath.slice(oldP.length);
                } else if (currentOldPath === oldP) {
                  currentOldPath = newP;
                }
              }

              console.log(`[FOLDER RENAME] After applying previous renames: ${currentOldPath}`);

              // Build the full path manually (don't use validatePath as it requires the folder to exist for realpath)
              const sanitizedPath = currentOldPath
                .replace(/\\/g, "/")
                .replace(/^\/+/, "")
                .split("/")
                .filter(part => part !== ".." && part !== "." && part.length > 0)
                .join("/");

              const folderFull = path.join(sourceBase, sanitizedPath);

              // Security check
              const normalizedFolder = path.resolve(folderFull);
              const normalizedBase = path.resolve(sourceBase);
              if (!normalizedFolder.startsWith(normalizedBase + path.sep) && normalizedFolder !== normalizedBase) {
                console.log(`[FOLDER RENAME] Skipped - path escape: ${currentOldPath}`);
                continue;
              }

              console.log(`[FOLDER RENAME] Full path: ${folderFull}, sourceBase: ${sourceBase}`);

              // Check if it's actually a directory
              try {
                const stats = await fs.stat(folderFull);
                if (!stats.isDirectory()) {
                  console.log(`[FOLDER RENAME] Skipped - not a directory: ${currentOldPath}`);
                  continue;
                }
              } catch (statErr) {
                console.log(`[FOLDER RENAME] Skipped - does not exist: ${currentOldPath}`, statErr);
                continue;
              }

              // Build new folder path (same parent, new name)
              const parentDir = path.dirname(folderFull);
              const newFolderFull = path.join(parentDir, folderRename.newName);

              console.log(`[FOLDER RENAME] New path: ${newFolderFull}`);

              // Skip if already has the correct name
              if (path.basename(folderFull) === folderRename.newName) {
                console.log(`[FOLDER RENAME] Skipped - already correct name`);
                continue;
              }

              // Check if destination already exists
              try {
                await fs.access(newFolderFull);
                // Destination exists - skip this rename to avoid data loss
                console.log(`[FOLDER RENAME] Skipped - destination exists: ${newFolderFull}`);
                continue;
              } catch {
                // Good - destination doesn't exist
              }

              // Rename the folder with retry logic for Windows EPERM errors
              // Windows can temporarily lock folders that were recently accessed
              let renameSuccess = false;
              let lastError: unknown = null;
              const maxRetries = 3;
              const retryDelay = 500; // ms

              for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                  await fs.rename(folderFull, newFolderFull);
                  await setDirectoryPermissions(newFolderFull);
                  renameSuccess = true;
                  break;
                } catch (renameErr: unknown) {
                  lastError = renameErr;
                  const errCode = (renameErr as NodeJS.ErrnoException).code;

                  // EPERM on Windows often means the folder is temporarily locked
                  if (errCode === "EPERM" && attempt < maxRetries) {
                    console.log(`[FOLDER RENAME] EPERM error, retrying in ${retryDelay}ms (attempt ${attempt}/${maxRetries})`);
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
                console.log(`[FOLDER RENAME] Success: ${folderFull} -> ${newFolderFull}`);
              }
            } catch (err) {
              console.error(`[FOLDER RENAME] Failed: ${folderRename.oldPath}`, err);
              // Check for Windows EPERM specifically
              if ((err as NodeJS.ErrnoException).code === "EPERM") {
                folderRenameErrors.push(`Folder "${folderRename.oldPath}" is locked (close any programs using it)`);
              } else {
                folderRenameErrors.push(`Folder rename failed: ${folderRename.oldPath} → ${folderRename.newName}`);
              }
            }
          }
        } else {
          console.log(`[FOLDER RENAME] Skipped: folderRenames=${folderRenames ? folderRenames.length : 'undefined'}, operation=${operation}`);
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
