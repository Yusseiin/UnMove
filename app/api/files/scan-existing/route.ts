import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getBasePath, validatePath } from "@/lib/path-validator";
import { parseFileName } from "@/lib/filename-parser";

const VIDEO_EXTENSIONS = [
  ".mkv", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm",
  ".m4v", ".mpg", ".mpeg", ".ts", ".m2ts", ".vob"
];

interface ExistingEpisode {
  season: number;
  episode: number;
  fileName: string;
}

interface ScanExistingResponse {
  success: boolean;
  episodes?: ExistingEpisode[];
  error?: string;
}

async function scanForEpisodes(dirPath: string, episodes: ExistingEpisode[]): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await scanForEpisodes(fullPath, episodes);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (VIDEO_EXTENSIONS.includes(ext)) {
          const parsed = parseFileName(entry.name);

          // Try to get season from folder name if not in filename
          let season = parsed.season;
          if (season === undefined) {
            const parentDir = path.basename(dirPath);
            const seasonMatch = parentDir.match(/[Ss](?:eason\s*)?(\d+)/);
            if (seasonMatch) {
              season = parseInt(seasonMatch[1], 10);
            }
          }

          if (season !== undefined && parsed.episode !== undefined) {
            episodes.push({
              season,
              episode: parsed.episode,
              fileName: entry.name,
            });
          }
        }
      }
    }
  } catch {
    // Directory might not exist yet, that's fine
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { folderPath } = body;

    if (!folderPath || typeof folderPath !== "string") {
      return NextResponse.json<ScanExistingResponse>(
        { success: false, episodes: [], error: "folderPath is required" },
        { status: 400 }
      );
    }

    const mediaBase = getBasePath("media");
    if (!mediaBase) {
      return NextResponse.json<ScanExistingResponse>(
        { success: false, episodes: [], error: "MEDIA_PATH not configured" },
        { status: 500 }
      );
    }

    const validation = await validatePath(mediaBase, folderPath);
    if (!validation.valid) {
      // Folder might not exist yet - return empty episodes
      return NextResponse.json<ScanExistingResponse>({
        success: true,
        episodes: [],
      });
    }

    const episodes: ExistingEpisode[] = [];
    await scanForEpisodes(validation.absolutePath, episodes);

    return NextResponse.json<ScanExistingResponse>({
      success: true,
      episodes,
    });
  } catch (error) {
    console.error("Error scanning existing episodes:", error);
    return NextResponse.json<ScanExistingResponse>(
      {
        success: false,
        episodes: [],
        error: error instanceof Error ? error.message : "Failed to scan",
      },
      { status: 500 }
    );
  }
}
