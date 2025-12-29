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

interface BatchRenameRequest {
  files?: FileRename[]; // Explicit source->dest mappings
  sourcePaths?: string[]; // Alternative: source paths only
  destinationFolder?: string; // Used with sourcePaths - destination folder (filename preserved)
  operation: "copy" | "move";
  overwrite?: boolean; // If true, overwrite existing files
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
  const { files, sourcePaths, destinationFolder, operation, overwrite = false } = body;

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

  if (operation !== "copy" && operation !== "move") {
    return new Response(
      JSON.stringify({ type: "error", message: "operation must be 'copy' or 'move'" }),
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
            // Validate source is in downloads
            const sourceValidation = await validatePath(downloadBase, file.sourcePath);
            if (!sourceValidation.valid) {
              errors.push(`Invalid source: ${file.sourcePath}`);
              failed++;
              continue;
            }
            const sourceFull = sourceValidation.absolutePath;

            // Get file size for progress (optional, could be used for byte-level progress)
            const sourceStats = await fs.stat(sourceFull);
            const fileSize = sourceStats.size;

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

            const destFull = path.join(mediaBase, sanitizedDest);

            // Security check
            const normalizedDest = path.resolve(destFull);
            const normalizedBase = path.resolve(mediaBase);
            if (!normalizedDest.startsWith(normalizedBase + path.sep) && normalizedDest !== normalizedBase) {
              errors.push(`Invalid path: ${file.destinationPath}`);
              failed++;
              continue;
            }

            // Create destination directory if needed with proper permissions on ALL levels
            const destDir = path.dirname(destFull);
            if (!createdDirs.has(destDir)) {
              await mkdirWithPermissions(destDir, mediaBase);
              createdDirs.add(destDir);
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

            // For move operations, try fs.rename first (instant on same filesystem)
            // Only fall back to copy+delete if rename fails (cross-device move)
            let usedRename = false;
            if (operation === "move") {
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
                // If EXDEV (cross-device link), fall back to copy+delete
                // Otherwise rethrow the error
                if ((renameErr as NodeJS.ErrnoException).code !== "EXDEV") {
                  throw renameErr;
                }
                // Continue to copy+delete below
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

        // Send completion
        sendProgress({
          type: "complete",
          current: total,
          total,
          completed,
          failed,
          errors,
          message: failed === 0 ? "All files processed successfully" : `Completed with ${failed} error(s)`,
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
