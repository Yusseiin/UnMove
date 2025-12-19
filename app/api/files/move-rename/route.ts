import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { validatePath, getBasePath } from "@/lib/path-validator";
import { verifyFileCopy } from "@/lib/file-utils";
import type { OperationResponse } from "@/types/files";

interface MoveRenameRequest {
  sourcePath: string; // Relative path in downloads
  newPath: string; // New relative path structure in media (e.g., "Show Name/Season 01/filename.mkv")
  overwrite?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body: MoveRenameRequest = await request.json();
    const { sourcePath, newPath, overwrite = false } = body;

    if (!sourcePath || typeof sourcePath !== "string") {
      return NextResponse.json<OperationResponse>(
        { success: false, error: "Source path is required" },
        { status: 400 }
      );
    }

    if (!newPath || typeof newPath !== "string") {
      return NextResponse.json<OperationResponse>(
        { success: false, error: "New path is required" },
        { status: 400 }
      );
    }

    // Validate source path (must be in downloads)
    const downloadBase = getBasePath("downloads");
    const sourceValidation = await validatePath(downloadBase, sourcePath);
    if (!sourceValidation.valid) {
      return NextResponse.json<OperationResponse>(
        { success: false, error: `Invalid source path: ${sourceValidation.error}` },
        { status: 400 }
      );
    }

    // Validate destination path (must be in media)
    const mediaBase = getBasePath("media");
    const destValidation = await validatePath(mediaBase, newPath);
    if (!destValidation.valid) {
      return NextResponse.json<OperationResponse>(
        { success: false, error: `Invalid destination path: ${destValidation.error}` },
        { status: 400 }
      );
    }

    const fullSourcePath = sourceValidation.absolutePath;
    const fullDestPath = destValidation.absolutePath;

    // Check if source exists
    try {
      await fs.access(fullSourcePath);
    } catch {
      return NextResponse.json<OperationResponse>(
        { success: false, error: "Source file does not exist" },
        { status: 400 }
      );
    }

    // Check if destination already exists
    let destExists = false;
    try {
      await fs.access(fullDestPath);
      destExists = true;
    } catch {
      // Destination doesn't exist, good
    }

    if (destExists && !overwrite) {
      return NextResponse.json<OperationResponse>(
        { success: false, error: "Destination already exists" },
        { status: 409 }
      );
    }

    // Get source file stats to preserve permissions
    const sourceStats = await fs.stat(fullSourcePath);

    // Create parent directories if they don't exist
    const destDir = path.dirname(fullDestPath);
    await fs.mkdir(destDir, { recursive: true, mode: 0o775 });

    // If overwriting, remove existing destination
    if (destExists && overwrite) {
      await fs.rm(fullDestPath, { recursive: true, force: true });
    }

    // Try rename first (atomic operation on same filesystem)
    try {
      await fs.rename(fullSourcePath, fullDestPath);
      return NextResponse.json<OperationResponse>({
        success: true,
        message: "File moved and renamed successfully",
      });
    } catch {
      // Rename failed (likely cross-filesystem), use copy + verify + delete
    }

    // Step 1: Copy the file/directory
    await fs.cp(fullSourcePath, fullDestPath, {
      recursive: true,
      errorOnExist: true,
      preserveTimestamps: true,
    });

    // Step 1b: Preserve original file permissions
    try {
      await fs.chmod(fullDestPath, sourceStats.mode);
    } catch {
      // Ignore permission errors (might not be supported on all systems)
    }

    // Step 2: Verify the copy with hash comparison
    const verification = await verifyFileCopy(fullSourcePath, fullDestPath);

    if (!verification.valid) {
      // Hash mismatch - delete the failed copy and report error
      try {
        await fs.rm(fullDestPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      return NextResponse.json<OperationResponse>(
        {
          success: false,
          error: `Copy verification failed: ${verification.error}. Source file preserved.`,
        },
        { status: 500 }
      );
    }

    // Step 3: Hash verified - safe to delete source
    await fs.rm(fullSourcePath, { recursive: true, force: true });

    return NextResponse.json<OperationResponse>({
      success: true,
      message: "File moved and renamed successfully",
    });
  } catch (error) {
    console.error("Error moving and renaming file:", error);
    return NextResponse.json<OperationResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to move and rename file",
      },
      { status: 500 }
    );
  }
}
