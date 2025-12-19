// Application configuration types

export type Language = "en" | "it";

// Movie folder structure options
export type MovieFolderStructure = "year" | "name" | "none";
// "year" = BasePath/2025/Movie Name (2025).mkv
// "name" = BasePath/Movie Name (2025)/Movie Name (2025).mkv
// "none" = BasePath/Movie Name (2025).mkv

// Base folder with per-folder settings
export interface BaseFolder {
  name: string;
  preserveQualityInfo: boolean; // Keep quality/encoding info in renamed files (e.g., "[1080p.H264]")
  alwaysUseFFprobe?: boolean; // Always use ffprobe for quality/codec info, ignoring filename parsing
}

export interface AppConfig {
  language: Language;
  seriesBaseFolders: BaseFolder[]; // Base folders for TV series (e.g., [{name: "TV Series", preserveQualityInfo: true}])
  moviesBaseFolders: BaseFolder[]; // Base folders for movies (e.g., [{name: "Movies", preserveQualityInfo: false}])
  movieFolderStructure: MovieFolderStructure; // How to organize movie files
}

export const defaultConfig: AppConfig = {
  language: "en",
  seriesBaseFolders: [],
  moviesBaseFolders: [],
  movieFolderStructure: "name", // Default: Movie Name folder
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
