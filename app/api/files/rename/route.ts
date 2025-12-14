import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { validatePath, getBasePath } from "@/lib/path-validator";
import type { OperationResponse, PaneType } from "@/types/files";

interface RenameRequest {
  pane: PaneType;
  oldPath: string; // Relative path to the file/folder
  newName: string; // New name (just the name, not full path)
}

// Characters that are illegal in file/folder names across different operating systems
const ILLEGAL_CHARS_WINDOWS = /[<>:"/\\|?*\x00-\x1f]/;
const ILLEGAL_CHARS_UNIX = /[/\x00]/;
const RESERVED_NAMES_WINDOWS = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

export function validateFileName(name: string): { valid: boolean; error?: string } {
  if (!name || typeof name !== "string") {
    return { valid: false, error: "Name is required" };
  }

  // Trim and check if empty
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return { valid: false, error: "Name cannot be empty or whitespace only" };
  }

  // Check for illegal characters (combine Windows and Unix)
  if (ILLEGAL_CHARS_WINDOWS.test(trimmedName)) {
    return {
      valid: false,
      error: "Name contains illegal characters: < > : \" / \\ | ? *",
    };
  }

  if (ILLEGAL_CHARS_UNIX.test(trimmedName)) {
    return {
      valid: false,
      error: "Name contains illegal characters",
    };
  }

  // Check for reserved names on Windows
  if (RESERVED_NAMES_WINDOWS.test(trimmedName)) {
    return {
      valid: false,
      error: "Name is a reserved system name (CON, PRN, AUX, NUL, COM1-9, LPT1-9)",
    };
  }

  // Check if name starts or ends with a dot or space (problematic on Windows)
  if (trimmedName.startsWith(".") && trimmedName.length === 1) {
    return { valid: false, error: "Name cannot be just a dot" };
  }

  if (trimmedName.endsWith(" ") || trimmedName.endsWith(".")) {
    return { valid: false, error: "Name cannot end with a space or dot" };
  }

  // Check length (Windows has a 255 char limit for file names)
  if (trimmedName.length > 255) {
    return { valid: false, error: "Name is too long (max 255 characters)" };
  }

  return { valid: true };
}

export async function POST(request: NextRequest) {
  try {
    const body: RenameRequest = await request.json();
    const { pane, oldPath, newName } = body;

    // Validate pane
    if (!pane || (pane !== "downloads" && pane !== "media")) {
      return NextResponse.json<OperationResponse>(
        { success: false, error: "Invalid pane specified" },
        { status: 400 }
      );
    }

    // Validate old path
    if (!oldPath || typeof oldPath !== "string") {
      return NextResponse.json<OperationResponse>(
        { success: false, error: "Old path is required" },
        { status: 400 }
      );
    }

    // Validate new name
    const nameValidation = validateFileName(newName);
    if (!nameValidation.valid) {
      return NextResponse.json<OperationResponse>(
        { success: false, error: nameValidation.error },
        { status: 400 }
      );
    }

    // Get base path and validate the old path
    const basePath = getBasePath(pane);
    const oldPathValidation = await validatePath(basePath, oldPath);
    if (!oldPathValidation.valid) {
      return NextResponse.json<OperationResponse>(
        { success: false, error: `Invalid path: ${oldPathValidation.error}` },
        { status: 400 }
      );
    }

    const fullOldPath = oldPathValidation.absolutePath;

    // Check if source exists
    try {
      await fs.access(fullOldPath);
    } catch {
      return NextResponse.json<OperationResponse>(
        { success: false, error: "File or folder does not exist" },
        { status: 404 }
      );
    }

    // Construct new path (same directory, new name)
    const parentDir = path.dirname(fullOldPath);
    const fullNewPath = path.join(parentDir, newName.trim());

    // Validate new path is still within base directory
    const newRelativePath = path.join(path.dirname(oldPath), newName.trim());
    const newPathValidation = await validatePath(basePath, newRelativePath);
    if (!newPathValidation.valid) {
      return NextResponse.json<OperationResponse>(
        { success: false, error: `Invalid new path: ${newPathValidation.error}` },
        { status: 400 }
      );
    }

    // Check if same name (case-insensitive check for same file)
    if (fullOldPath.toLowerCase() === fullNewPath.toLowerCase() && fullOldPath === fullNewPath) {
      return NextResponse.json<OperationResponse>(
        { success: false, error: "New name is the same as the current name" },
        { status: 400 }
      );
    }

    // Check if destination already exists (unless it's a case change on same file)
    if (fullOldPath.toLowerCase() !== fullNewPath.toLowerCase()) {
      try {
        await fs.access(fullNewPath);
        return NextResponse.json<OperationResponse>(
          { success: false, error: "A file or folder with this name already exists" },
          { status: 409 }
        );
      } catch {
        // Destination doesn't exist, good
      }
    }

    // Perform the rename
    await fs.rename(fullOldPath, fullNewPath);

    return NextResponse.json<OperationResponse>({
      success: true,
      message: "Renamed successfully",
    });
  } catch (error) {
    console.error("Error renaming file:", error);
    return NextResponse.json<OperationResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to rename",
      },
      { status: 500 }
    );
  }
}
