import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getBasePath, validatePath } from "@/lib/path-validator";
import type { CreateFolderRequest, OperationResponse } from "@/types/files";

export async function POST(request: NextRequest) {
  try {
    const body: CreateFolderRequest = await request.json();
    const { path: parentPath, name } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json<OperationResponse>(
        { success: false, error: "Folder name is required" },
        { status: 400 }
      );
    }

    // Validate folder name
    const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
    if (invalidChars.test(name)) {
      return NextResponse.json<OperationResponse>(
        { success: false, error: "Folder name contains invalid characters" },
        { status: 400 }
      );
    }

    // Only allow creating folders in media
    const mediaBase = getBasePath("media");

    // Validate parent path
    const parentValidation = await validatePath(mediaBase, parentPath || "/");
    if (!parentValidation.valid) {
      return NextResponse.json<OperationResponse>(
        { success: false, error: parentValidation.error },
        { status: 400 }
      );
    }

    // Check parent is a directory
    const parentStat = await fs.stat(parentValidation.absolutePath);
    if (!parentStat.isDirectory()) {
      return NextResponse.json<OperationResponse>(
        { success: false, error: "Parent path is not a directory" },
        { status: 400 }
      );
    }

    // Create the new folder path
    const newFolderPath = path.join(parentValidation.absolutePath, name);

    // Check if folder already exists
    try {
      await fs.access(newFolderPath);
      return NextResponse.json<OperationResponse>(
        { success: false, error: "A folder with this name already exists" },
        { status: 409 }
      );
    } catch {
      // Folder doesn't exist, which is what we want
    }

    // Create the folder with proper permissions (rwxrwxr-x)
    await fs.mkdir(newFolderPath, { mode: 0o775 });

    return NextResponse.json<OperationResponse>({
      success: true,
      message: `Folder '${name}' created successfully`,
    });
  } catch (error) {
    console.error("Error creating folder:", error);
    return NextResponse.json<OperationResponse>(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to create folder",
      },
      { status: 500 }
    );
  }
}
