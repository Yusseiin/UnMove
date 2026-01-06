// TVDB API Response Types

export interface TVDBLoginResponse {
  status: string;
  data: {
    token: string;
  };
}

export interface TVDBSearchResult {
  id: string;
  name: string;
  type: "series" | "movie" | "person" | "company";
  year?: string;
  slug?: string;
  image_url?: string;
  overview?: string;
  primary_language?: string;
  country?: string;
  tvdb_id?: string;
  // Translated name based on user's language preference (for display)
  name_translated?: string;
  // English name (for matching against filenames, which are often in English)
  name_english?: string;
  // Original translations array from TVDB
  translations?: {
    eng?: string;
    [key: string]: string | undefined;
  };
  // Alternative names/aliases
  aliases?: string[];
}

export interface TVDBSearchResponse {
  status: string;
  data: TVDBSearchResult[];
}

export interface TVDBEpisode {
  id: number;
  seriesId: number;
  name: string;
  seasonNumber: number;
  number: number; // Episode number within season
  aired?: string;
  runtime?: number;
  image?: string;
  overview?: string;
  productionCode?: string;
  // Italian translation (added after fetch)
  nameItalian?: string;
  // English translation (added after fetch for non-Latin episode names)
  nameEnglish?: string;
}

export interface TVDBTranslation {
  name?: string;
  overview?: string;
  language: string;
}

export interface TVDBTranslationResponse {
  status: string;
  data: TVDBTranslation;
}

export interface TVDBSeriesEpisodesResponse {
  status: string;
  data: {
    series: {
      id: number;
      name: string;
      slug: string;
      image?: string;
      year?: string;
    };
    episodes: TVDBEpisode[];
  };
  links?: {
    prev?: string;
    self: string;
    next?: string;
    total_items: number;
    page_size: number;
  };
}

// Parsed filename types

export interface ParsedFileName {
  originalName: string;
  cleanName: string; // Show/movie name extracted
  season?: number;
  episode?: number;
  year?: number;
  quality?: string;
  qualityInfo?: string; // Full quality/codec string to preserve (e.g., "1080p.H264")
  extension: string;
  isLikelyMovie: boolean;
}

// Rename preview types

export interface RenamePreview {
  originalPath: string;
  originalName: string;
  newPath: string;
  newName: string;
  tvdbMatch?: TVDBSearchResult;
  episode?: TVDBEpisode;
}

// API Request/Response types for our endpoints

export interface TVDBSearchRequest {
  query: string;
  type?: "series" | "movie";
  lang?: string; // "it" for Italian, defaults to English
  year?: string; // Release year filter (TMDB only)
}

export interface TVDBEpisodesRequest {
  seriesId: string;
  season?: number;
}

export interface TVDBApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Identify and move request

export interface IdentifyMoveRequest {
  sourcePath: string;
  destinationBasePath: string;
  tvdbId: string;
  tvdbType: "series" | "movie";
  tvdbName: string;
  season?: number;
  episode?: number;
  episodeName?: string;
  year?: string;
}
