import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getBasePath, validatePath } from "@/lib/path-validator";
import { getFileExtension, sortEntries } from "@/lib/file-utils";
import { isExcludedName } from "@/lib/exclude-patterns";
import { readAppConfig } from "@/lib/server-config";
import { defaultExcludePatterns } from "@/types/config";
import type { FileEntry, ListFilesResponse, PaneType } from "@/types/files";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const pane = searchParams.get("pane") as PaneType | null;
    const requestedPath = searchParams.get("path") || "/";

    if (!pane || (pane !== "downloads" && pane !== "media")) {
      return NextResponse.json<ListFilesResponse>(
        { success: false, error: "Invalid pane parameter" },
        { status: 400 }
      );
    }

    const basePath = getBasePath(pane);
    const validation = await validatePath(basePath, requestedPath);

    if (!validation.valid) {
      return NextResponse.json<ListFilesResponse>(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    const absolutePath = validation.absolutePath;

    // Check if path exists and is a directory
    const stat = await fs.stat(absolutePath);
    if (!stat.isDirectory()) {
      return NextResponse.json<ListFilesResponse>(
        { success: false, error: "Path is not a directory" },
        { status: 400 }
      );
    }

    // Ignored names are only hidden here when the user asked for it - by
    // default they stay visible so they can still be inspected and deleted
    const config = await readAppConfig();
    const excludePatterns = config.hideExcludedInBrowser
      ? config.excludePatterns ?? defaultExcludePatterns
      : undefined;

    // Read directory contents
    const items = await fs.readdir(absolutePath, { withFileTypes: true });
    const entries: FileEntry[] = [];

    for (const item of items) {
      if (isExcludedName(item.name, excludePatterns)) continue;

      try {
        const itemPath = path.join(absolutePath, item.name);
        const itemStat = await fs.stat(itemPath);

        // Calculate relative path from base
        const relativePath = path
          .relative(basePath, itemPath)
          .replace(/\\/g, "/");

        const entry: FileEntry = {
          name: item.name,
          path: "/" + relativePath,
          type: item.isDirectory() ? "directory" : "file",
          size: item.isDirectory() ? 0 : itemStat.size,
          modifiedAt: itemStat.mtime.toISOString(),
        };

        if (!item.isDirectory()) {
          entry.extension = getFileExtension(item.name);
        }

        entries.push(entry);
      } catch {
        // Skip items that can't be accessed
        continue;
      }
    }

    const sortedEntries = sortEntries(entries);

    // Normalize the requested path for response
    const normalizedPath =
      "/" + path.relative(basePath, absolutePath).replace(/\\/g, "/");

    return NextResponse.json<ListFilesResponse>({
      success: true,
      data: {
        path: normalizedPath === "/" ? "/" : normalizedPath,
        entries: sortedEntries,
      },
    });
  } catch (error) {
    console.error("Error listing files:", error);
    return NextResponse.json<ListFilesResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list files",
      },
      { status: 500 }
    );
  }
}
