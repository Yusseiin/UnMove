// Application configuration types

export type Language = "en" | "it";

// Movie folder structure options
export type MovieFolderStructure = "year" | "name" | "none";
// "year" = BasePath/2025/Movie Name (2025).mkv
// "name" = BasePath/Movie Name (2025)/Movie Name (2025).mkv
// "none" = BasePath/Movie Name (2025).mkv

// Naming template for series episodes
// Available tokens:
// {seriesName} - Series name (e.g., "Breaking Bad")
// {seriesYear} - Series year (e.g., "2008")
// {season} - Season number with padding (e.g., "01")
// {episode} - Episode number with padding (e.g., "05")
// {episodeTitle} - Episode title (e.g., "Pilot")
// {quality} - Resolution (e.g., "1080p", "4K", "720p")
// {codec} - Video codec (e.g., "H264", "H265", "HEVC")
// {ext} - File extension (e.g., "mkv")
export interface SeriesNamingTemplate {
  // Folder path template (relative to base folder)
  // Default: "{seriesName} ({seriesYear})/{seasonFolder}"
  folderTemplate: string;
  // Season folder template
  // Default: "Season {season}" or localized
  seasonFolderTemplate: string;
  // Specials folder template
  // Default: "Specials" or localized
  specialsFolderTemplate: string;
  // Filename template
  // Default: "{seriesName} - S{season}E{episode} - {episodeTitle}"
  fileTemplate: string;
  // Season number padding (1-4)
  seasonPadding: number;
  // Episode number padding (1-4)
  episodePadding: number;
}

// Naming template for movies
// Available tokens:
// {movieName} - Movie name (e.g., "Inception")
// {year} - Movie year (e.g., "2010")
// {quality} - Resolution (e.g., "1080p", "4K", "720p")
// {codec} - Video codec (e.g., "H264", "H265", "HEVC")
// {ext} - File extension (e.g., "mkv")
export interface MovieNamingTemplate {
  // Folder structure: how to organize movie files
  // "year" = BasePath/2025/Movie Name (2025).mkv
  // "name" = BasePath/Movie Name (2025)/Movie Name (2025).mkv
  // "none" = BasePath/Movie Name (2025).mkv
  folderStructure: MovieFolderStructure;
  // Folder path template (relative to base folder, used when folderStructure is "name")
  // Default: "{movieName} ({year})"
  folderTemplate: string;
  // Filename template
  // Default: "{movieName} ({year})"
  fileTemplate: string;
}

// Default naming templates
export const defaultSeriesNamingTemplate: SeriesNamingTemplate = {
  folderTemplate: "{seriesName} ({seriesYear})",
  seasonFolderTemplate: "Season {season}",
  specialsFolderTemplate: "Specials",
  fileTemplate: "{seriesName} - S{season}E{episode} - {episodeTitle}",
  seasonPadding: 2,
  episodePadding: 2,
};

export const defaultMovieNamingTemplate: MovieNamingTemplate = {
  folderStructure: "name",
  folderTemplate: "{movieName} ({year})",
  fileTemplate: "{movieName} ({year})",
};

// Base folder with per-folder settings
export interface BaseFolder {
  name: string;
  alwaysUseFFprobe?: boolean; // Always use ffprobe for quality/codec info, ignoring filename parsing
  // Per-folder naming template overrides (if not set, uses global defaults)
  seriesNamingTemplate?: SeriesNamingTemplate;
  movieNamingTemplate?: MovieNamingTemplate;
}

export interface AppConfig {
  language: Language;
  seriesBaseFolders: BaseFolder[]; // Base folders for TV series (e.g., [{name: "TV Series", preserveQualityInfo: true}])
  moviesBaseFolders: BaseFolder[]; // Base folders for movies (e.g., [{name: "Movies", preserveQualityInfo: false}])
  // Global naming templates (folders inherit these unless overridden)
  seriesNamingTemplate?: SeriesNamingTemplate;
  movieNamingTemplate?: MovieNamingTemplate;
}

export const defaultConfig: AppConfig = {
  language: "en",
  seriesBaseFolders: [],
  moviesBaseFolders: [],
  seriesNamingTemplate: defaultSeriesNamingTemplate,
  movieNamingTemplate: defaultMovieNamingTemplate,
};

// Localized strings
export const localization = {
  en: {
    season: "Season",
    specials: "Specials",
    episode: "Episode",
  },
  it: {
    season: "Stagione",
    specials: "Speciali",
    episode: "Episodio",
  },
} as const;

export function getLocalizedStrings(language: Language) {
  return localization[language];
}
