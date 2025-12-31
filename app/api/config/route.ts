import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import type { AppConfig, BaseFolder, MovieFolderStructure } from "@/types/config";
import { defaultConfig, defaultMovieNamingTemplate } from "@/types/config";

// Config file path - can be set via CONFIG_PATH env variable, defaults to project root
function getConfigPath(): string {
  const envPath = process.env.CONFIG_PATH;
  if (envPath) {
    // If it's a directory, append the filename
    if (!envPath.endsWith(".json")) {
      return path.join(envPath, "unmove-config.json");
    }
    return envPath;
  }
  return path.join(process.cwd(), "unmove-config.json");
}

// Migrate old string[] format to BaseFolder[] format and remove deprecated fields
function migrateBaseFolders(folders: unknown): BaseFolder[] {
  if (!Array.isArray(folders)) return [];
  return folders.map((folder) => {
    // Already in new format
    if (typeof folder === "object" && folder !== null && "name" in folder) {
      const folderObj = folder as Record<string, unknown>;
      // Build new BaseFolder object, excluding deprecated preserveQualityInfo
      const baseFolder: BaseFolder = {
        name: folderObj.name as string,
      };
      // Copy over valid optional properties
      if (folderObj.alwaysUseFFprobe !== undefined) {
        baseFolder.alwaysUseFFprobe = folderObj.alwaysUseFFprobe as boolean;
      }
      if (folderObj.seriesNamingTemplate !== undefined) {
        baseFolder.seriesNamingTemplate = folderObj.seriesNamingTemplate as BaseFolder["seriesNamingTemplate"];
      }
      if (folderObj.movieNamingTemplate !== undefined) {
        baseFolder.movieNamingTemplate = folderObj.movieNamingTemplate as BaseFolder["movieNamingTemplate"];
      }
      return baseFolder;
    }
    // Old string format - migrate to new format
    if (typeof folder === "string") {
      return { name: folder };
    }
    return { name: String(folder) };
  });
}

async function readConfig(): Promise<AppConfig> {
  try {
    const configPath = getConfigPath();
    const content = await fs.readFile(configPath, "utf-8");
    const rawConfig = JSON.parse(content);

    // Migrate old format to new format
    const config: AppConfig = {
      ...defaultConfig,
      ...rawConfig,
      seriesBaseFolders: migrateBaseFolders(rawConfig.seriesBaseFolders),
      moviesBaseFolders: migrateBaseFolders(rawConfig.moviesBaseFolders),
    };

    // Remove deprecated preserveQualityInfo if it exists at root level
    if ("preserveQualityInfo" in rawConfig) {
      delete (config as unknown as Record<string, unknown>).preserveQualityInfo;
    }

    // Migrate movieFolderStructure from root level to movieNamingTemplate
    if ("movieFolderStructure" in rawConfig) {
      const oldFolderStructure = rawConfig.movieFolderStructure as MovieFolderStructure;
      // Ensure movieNamingTemplate exists and has the folderStructure
      config.movieNamingTemplate = {
        ...defaultMovieNamingTemplate,
        ...config.movieNamingTemplate,
        folderStructure: config.movieNamingTemplate?.folderStructure || oldFolderStructure,
      };
      // Remove deprecated field
      delete (config as unknown as Record<string, unknown>).movieFolderStructure;
    }

    // Ensure movieNamingTemplate has folderStructure (for configs without it)
    if (config.movieNamingTemplate && !config.movieNamingTemplate.folderStructure) {
      config.movieNamingTemplate.folderStructure = defaultMovieNamingTemplate.folderStructure;
    }

    return config;
  } catch {
    // File doesn't exist or invalid, return defaults
    return defaultConfig;
  }
}

async function writeConfig(config: AppConfig): Promise<void> {
  const configPath = getConfigPath();
  // Ensure directory exists
  const dir = path.dirname(configPath);
  await fs.mkdir(dir, { recursive: true });

  // Write to temp file first, then rename (atomic write to prevent corruption)
  const tempPath = configPath + ".tmp";
  const content = JSON.stringify(config, null, 2);
  await fs.writeFile(tempPath, content, "utf-8");

  // Rename temp file to actual file (atomic on most filesystems)
  await fs.rename(tempPath, configPath);
}

// GET - Read current config
export async function GET() {
  try {
    const config = await readConfig();
    return NextResponse.json({ success: true, data: config });
  } catch (error) {
    console.error("Failed to read config:", error);
    return NextResponse.json(
      { success: false, error: "Failed to read configuration" },
      { status: 500 }
    );
  }
}

// POST - Update config
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const currentConfig = await readConfig();

    // Merge new values with existing config
    const newConfig: AppConfig = {
      ...currentConfig,
      ...body,
    };

    // Validate language
    if (newConfig.language !== "en" && newConfig.language !== "it") {
      return NextResponse.json(
        { success: false, error: "Invalid language. Must be 'en' or 'it'" },
        { status: 400 }
      );
    }

    await writeConfig(newConfig);

    return NextResponse.json({ success: true, data: newConfig });
  } catch (error) {
    console.error("Failed to save config:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save configuration" },
      { status: 500 }
    );
  }
}
