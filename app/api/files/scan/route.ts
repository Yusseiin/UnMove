import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { validatePath, getBasePath } from "@/lib/path-validator";
import {
  parseFileName,
  ParseOptions,
  isGenericMediaName,
  pickNameFromFolders,
  pickSeasonFromFolders,
} from "@/lib/filename-parser";
import { getMediaInfo, buildQualityInfoFromMedia } from "@/lib/media-info";
import { isExcludedName } from "@/lib/exclude-patterns";
import { readAppConfig } from "@/lib/server-config";
import type { ParsedFileName } from "@/types/tvdb";
import {
  defaultQualityValues,
  defaultCodecValues,
  defaultExtraTagValues,
  defaultExcludePatterns,
} from "@/types/config";

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

/**
 * List the folders containing a file, from its own folder outwards,
 * stopping before the pane base path (downloads/media root)
 */
function getFolderChain(filePath: string, basePath: string): string[] {
  const base = path.resolve(basePath);
  const chain: string[] = [];
  let dir = path.resolve(path.dirname(filePath));

  while (dir !== base && dir.startsWith(base + path.sep)) {
    chain.push(path.basename(dir));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return chain;
}

/**
 * Fill in what the filename alone cannot say, using the folders above the file.
 *
 * Filenames like "Episodio 01.mkv" name the episode, not the show, so searching
 * TVDB/TMDB with them never matches. In that case the containing folder
 * (skipping Season/Extras folders) is used as the show name instead.
 * A "Season 02" folder is also preferred over the parser's assumed season 1.
 */
function applyFolderFallbacks(
  parsed: ParsedFileName,
  fullPath: string,
  basePath: string,
  parseOptions?: ParseOptions
): void {
  const folderChain = getFolderChain(fullPath, basePath);

  if (parsed.season === undefined || parsed.seasonAssumed) {
    const folderSeason = pickSeasonFromFolders(folderChain);
    if (folderSeason !== undefined) {
      parsed.season = folderSeason;
      parsed.seasonAssumed = false;
      parsed.isLikelyMovie = false;
    }
  }

  if (!isGenericMediaName(parsed.cleanName)) return;

  const fromFolder = pickNameFromFolders(folderChain, parseOptions, parsed.cleanName);
  if (!fromFolder) return;

  parsed.cleanName = fromFolder.name;
  // Only take the folder's year if the filename didn't provide one
  if (parsed.year === undefined && fromFolder.year !== undefined) {
    parsed.year = fromFolder.year;
  }
}

async function scanDirectory(
  dirPath: string,
  scanBasePath: string,
  downloadBasePath: string,
  files: ScannedFile[],
  parseOptions?: ParseOptions,
  excludePatterns?: string[]
): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    // Ignored names (sample folders, sample files...) never reach the identify
    // list. Only what the scan finds on its own is filtered - a path the user
    // picked explicitly is always honoured.
    if (isExcludedName(entry.name, excludePatterns)) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(scanBasePath, fullPath);
    // Path relative to downloads base for use in batch-rename API
    const pathFromDownloads = "/" + path.relative(downloadBasePath, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      // Recursively scan subdirectories
      await scanDirectory(
        fullPath,
        scanBasePath,
        downloadBasePath,
        files,
        parseOptions,
        excludePatterns
      );
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (VIDEO_EXTENSIONS.includes(ext)) {
        // Parse the filename to extract show info
        const parsed = parseFileName(entry.name, parseOptions);

        // Also try to extract season from folder path.
        // A season folder is better evidence than the parser's assumed season 1
        // (filenames like "Episodio 05" only carry the episode number)
        if (parsed.season === undefined || parsed.seasonAssumed) {
          const seasonMatch = relativePath.match(
            /[/\\]?(?:Season|Stagione|Temporada|Saison|Staffel)[\s._-]*(\d{1,2})[/\\]/i
          );
          if (seasonMatch) {
            parsed.season = parseInt(seasonMatch[1], 10);
            parsed.seasonAssumed = false;
            parsed.isLikelyMovie = false;
          }
        }

        // Use the containing folders for anything the filename doesn't say
        applyFolderFallbacks(parsed, fullPath, downloadBasePath, parseOptions);

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
    const { sourcePath, sourcePaths, pane = "downloads" } = body;

    // Support both single path and multiple paths
    const pathsToScan: string[] = sourcePaths || (sourcePath ? [sourcePath] : []);

    if (pathsToScan.length === 0) {
      return NextResponse.json<ScanResponse>(
        { success: false, error: "sourcePath or sourcePaths is required" },
        { status: 400 }
      );
    }

    // Read config for custom quality/codec/extraTag values
    const config = await readAppConfig();
    const parseOptions: ParseOptions = {
      qualityValues: config.qualityValues ?? defaultQualityValues,
      codecValues: config.codecValues ?? defaultCodecValues,
      extraTagValues: config.extraTagValues ?? defaultExtraTagValues,
    };
    const excludePatterns = config.excludePatterns ?? defaultExcludePatterns;

    // Use the appropriate base path based on pane
    const basePath = getBasePath(pane === "media" ? "media" : "downloads");
    const files: ScannedFile[] = [];

    // Process each path
    for (const sPath of pathsToScan) {
      // Validate path is within the appropriate base
      const validation = await validatePath(basePath, sPath);

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
          await scanDirectory(
            fullPath,
            fullPath,
            basePath,
            files,
            parseOptions,
            excludePatterns
          );
        } else if (stats.isFile()) {
          // Single file
          const ext = path.extname(fullPath).toLowerCase();
          if (VIDEO_EXTENSIONS.includes(ext)) {
            const parsed = parseFileName(path.basename(fullPath), parseOptions);
            // Use the containing folders for anything the filename doesn't say
            applyFolderFallbacks(parsed, fullPath, basePath, parseOptions);
            // Path relative to base for use in batch-rename API
            const pathFromBase = "/" + path.relative(basePath, fullPath).replace(/\\/g, "/");
            files.push({
              path: pathFromBase,
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

    // Probe each file with ffprobe for quality/codec info
    // The frontend decides whether to use ffprobe result or filename parsing
    // based on user settings (alwaysUseFFprobe option)
    for (const file of files) {
      try {
        const validation = await validatePath(basePath, file.path);
        if (validation.valid) {
          const mediaInfo = await getMediaInfo(validation.absolutePath);
          if (mediaInfo) {
            const qualityFromMedia = buildQualityInfoFromMedia(mediaInfo);
            if (qualityFromMedia) {
              file.mediaInfoQuality = qualityFromMedia;
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
