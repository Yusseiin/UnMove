import fs from "fs/promises";
import path from "path";
import type { AppConfig } from "@/types/config";

// Config file path - must match the logic in /api/config/route.ts
export function getConfigPath(): string {
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

/**
 * Read the saved config from disk for use inside API routes.
 * Returns an empty object when there is no config file yet, so callers should
 * fall back to the defaults exported from @/types/config.
 */
export async function readAppConfig(): Promise<Partial<AppConfig>> {
  try {
    const content = await fs.readFile(getConfigPath(), "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}
