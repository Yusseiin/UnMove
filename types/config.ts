// Application configuration types

export type Language = "en" | "it";

// Movie folder structure options
export type MovieFolderStructure = "year" | "name";
// "year" = BasePath/2025/Movie Name (2025).mkv
// "name" = BasePath/Movie Name (2025)/Movie Name (2025).mkv

export interface AppConfig {
  language: Language;
  seriesBaseFolders: string[]; // Base folders for TV series (e.g., ["TV Series", "Anime"])
  moviesBaseFolders: string[]; // Base folders for movies (e.g., ["Movies", "Documentaries"])
  movieFolderStructure: MovieFolderStructure; // How to organize movie files
  preserveQualityInfo: boolean; // Keep quality/encoding info in renamed files (e.g., "1080p.H264")
}

export const defaultConfig: AppConfig = {
  language: "en",
  seriesBaseFolders: [],
  moviesBaseFolders: [],
  movieFolderStructure: "name", // Default: Movie Name folder
  preserveQualityInfo: false, // Default: don't preserve quality info
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
