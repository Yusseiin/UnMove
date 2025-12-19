import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { validatePath, getBasePath } from "@/lib/path-validator";
import { parseFileName } from "@/lib/filename-parser";
import { getMediaInfo, buildQualityInfoFromMedia } from "@/lib/media-info";
import type { ParsedFileName } from "@/types/tvdb";

// Common video extensions
const VIDEO_EXTENSIONS = [
  ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm",
  ".m4v", ".mpg", ".mpeg", ".ts", ".m2ts", ".vob"
];

interface ScannedFile {
  path: string;
  name: string;
  relativePath: string;
  parsed: ParsedFileName;
  mediaInfoQuality?: string; // Quality info from ffprobe (fallback when not in filename)
}

interface ScanResponse {
  success: boolean;
  data?: {
    files: ScannedFile[];
    suggestedShowName: string;
    hasMultipleSeasons: boolean;
    seasons: number[];
  };
  error?: string;
}

async function scanDirectory(
  dirPath: string,
  scanBasePath: string,
  downloadBasePath: string,
  files: ScannedFile[]
): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(scanBasePath, fullPath);
    // Path relative to downloads base for use in batch-rename API
    const pathFromDownloads = "/" + path.relative(downloadBasePath, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      // Recursively scan subdirectories
      await scanDirectory(fullPath, scanBasePath, downloadBasePath, files);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (VIDEO_EXTENSIONS.includes(ext)) {
        // Parse the filename to extract show info
        const parsed = parseFileName(entry.name);

        // Also try to extract season from folder path
        if (parsed.season === undefined) {
          const seasonMatch = relativePath.match(/[/\\]?Season\s*(\d{1,2})[/\\]/i);
          if (seasonMatch) {
            parsed.season = parseInt(seasonMatch[1], 10);
            parsed.isLikelyMovie = false;
          }
        }

        files.push({
          path: pathFromDownloads,
          name: entry.name,
          relativePath,
          parsed,
        });
      }
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sourcePath, sourcePaths } = body;

    // Support both single path and multiple paths
    const pathsToScan: string[] = sourcePaths || (sourcePath ? [sourcePath] : []);

    if (pathsToScan.length === 0) {
      return NextResponse.json<ScanResponse>(
        { success: false, error: "sourcePath or sourcePaths is required" },
        { status: 400 }
      );
    }

    const downloadBase = getBasePath("downloads");
    const files: ScannedFile[] = [];

    // Process each path
    for (const sPath of pathsToScan) {
      // Validate path is within downloads
      const validation = await validatePath(downloadBase, sPath);

      if (!validation.valid) {
        // Skip invalid paths but continue with others
        continue;
      }

      const fullPath = validation.absolutePath;

      // Check if path exists
      try {
        const stats = await fs.stat(fullPath);

        if (stats.isDirectory()) {
          // Scan directory recursively
          await scanDirectory(fullPath, fullPath, downloadBase, files);
        } else if (stats.isFile()) {
          // Single file
          const ext = path.extname(fullPath).toLowerCase();
          if (VIDEO_EXTENSIONS.includes(ext)) {
            const parsed = parseFileName(path.basename(fullPath));
            // Path relative to downloads base for use in batch-rename API
            const pathFromDownloads = "/" + path.relative(downloadBase, fullPath).replace(/\\/g, "/");
            files.push({
              path: pathFromDownloads,
              name: path.basename(fullPath),
              relativePath: path.basename(fullPath),
              parsed,
            });
          }
        }
      } catch {
        // Skip paths that don't exist
        continue;
      }
    }

    if (files.length === 0) {
      return NextResponse.json<ScanResponse>(
        { success: false, error: "No video files found" },
        { status: 404 }
      );
    }

    // Sort files by season and episode
    files.sort((a, b) => {
      const seasonA = a.parsed.season ?? 999;
      const seasonB = b.parsed.season ?? 999;
      if (seasonA !== seasonB) return seasonA - seasonB;

      const epA = a.parsed.episode ?? 999;
      const epB = b.parsed.episode ?? 999;
      return epA - epB;
    });

    // Always probe ffprobe for quality/codec info
    // The frontend decides whether to use ffprobe result or filename parsing
    // based on user settings (alwaysUseFFprobe option)
    if (files.length > 0) {
      try {
        // Probe the first file (all files in a batch typically have the same quality)
        const firstFile = files[0];
        const validation = await validatePath(downloadBase, firstFile.path);
        if (validation.valid) {
          const mediaInfo = await getMediaInfo(validation.absolutePath);
          if (mediaInfo) {
            const qualityFromMedia = buildQualityInfoFromMedia(mediaInfo);
            if (qualityFromMedia) {
              // Set mediaInfoQuality for all files (frontend decides which to use)
              for (const file of files) {
                file.mediaInfoQuality = qualityFromMedia;
              }
            }
          }
        }
      } catch {
        // Ignore ffprobe errors - quality info is optional
      }
    }

    // Get unique seasons
    const seasons = [...new Set(
      files
        .filter(f => f.parsed.season !== undefined)
        .map(f => f.parsed.season!)
    )].sort((a, b) => a - b);

    // Use the first file's clean name as suggested show name
    const suggestedShowName = files[0].parsed.cleanName;

    return NextResponse.json<ScanResponse>({
      success: true,
      data: {
        files,
        suggestedShowName,
        hasMultipleSeasons: seasons.length > 1,
        seasons,
      },
    });
  } catch (error) {
    console.error("Scan error:", error);
    return NextResponse.json<ScanResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to scan files",
      },
      { status: 500 }
    );
  }
}
