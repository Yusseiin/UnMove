// Application configuration types

export type Language = "en" | "it" | "de";

// Metadata provider options
export type MetadataProvider = "tvdb" | "tmdb";

// TVDB Episode ordering options
// default = Aired Order (when episodes first aired on TV)
// official = DVD Order (order used on DVD releases)
// absolute = Absolute Order (continuous numbering, common for anime)
export type EpisodeOrder = "default" | "official" | "absolute";

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

// Plex library section (returned from Plex API)
export interface PlexSection {
  key: string; // Section ID
  title: string; // Section name (e.g., "Movies", "TV Shows")
  type: string; // Type (e.g., "movie", "show")
}

export interface AppConfig {
  language: Language;
  seriesBaseFolders: BaseFolder[]; // Base folders for TV series (e.g., [{name: "TV Series", preserveQualityInfo: true}])
  moviesBaseFolders: BaseFolder[]; // Base folders for movies (e.g., [{name: "Movies", preserveQualityInfo: false}])
  // Global naming templates (folders inherit these unless overridden)
  seriesNamingTemplate?: SeriesNamingTemplate;
  movieNamingTemplate?: MovieNamingTemplate;
  // Custom quality values to detect in filenames (e.g., ["1080p", "720p", "4K", "2160p"])
  qualityValues?: string[];
  // Custom codec values to detect in filenames (e.g., ["x264", "x265", "H264", "H265", "HEVC"])
  codecValues?: string[];
  // Custom extra tag values to detect in filenames (e.g., ["10bit", "HDR", "ITA", "ENG"])
  extraTagValues?: string[];
  // Metadata provider for TV series: "tvdb" (TheTVDB) or "tmdb" (TheMovieDB)
  seriesMetadataProvider?: MetadataProvider;
  // Metadata provider for movies: "tvdb" (TheTVDB) or "tmdb" (TheMovieDB)
  moviesMetadataProvider?: MetadataProvider;
  // Legacy: single metadata provider (deprecated, use seriesMetadataProvider and moviesMetadataProvider)
  metadataProvider?: MetadataProvider;
}

// Default quality values to detect in filenames
export const defaultQualityValues = [
  "2160p", "4K", "UHD",
  "1080p", "1080i", "FHD",
  "720p", "HD",
  "480p", "SD",
  "576p", "576i",
];

// Default codec values to detect in filenames
export const defaultCodecValues = [
  "x264", "x265",
  "H264", "H.264", "AVC",
  "H265", "H.265", "HEVC",
  "AV1", "VP9",
];

// Default extra tag values - empty by default, user must configure in their config file
export const defaultExtraTagValues: string[] = [];

export const defaultConfig: AppConfig = {
  language: "en",
  seriesBaseFolders: [],
  moviesBaseFolders: [],
  seriesNamingTemplate: defaultSeriesNamingTemplate,
  movieNamingTemplate: defaultMovieNamingTemplate,
  qualityValues: defaultQualityValues,
  codecValues: defaultCodecValues,
  extraTagValues: defaultExtraTagValues,
  seriesMetadataProvider: "tvdb",
  moviesMetadataProvider: "tmdb",
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
  de: {
    season: "Staffel",
    specials: "Specials",
    episode: "Episode",
  },
} as const;

export function getLocalizedStrings(language: Language) {
  return localization[language];
}
