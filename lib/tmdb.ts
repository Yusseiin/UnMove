import type {
  TVDBSearchResult,
  TVDBEpisode,
} from "@/types/tvdb";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w185";

/**
 * Get API key from environment
 */
function getApiKey(): string {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY_MISSING:TMDB_API_KEY");
  }
  return apiKey;
}

/**
 * Make a request to TMDB API
 * TMDB uses simple API key auth (no token exchange like TVDB)
 */
async function tmdbFetch<T>(endpoint: string): Promise<T> {
  const apiKey = getApiKey();
  const separator = endpoint.includes("?") ? "&" : "?";
  const url = `${TMDB_BASE_URL}${endpoint}${separator}api_key=${apiKey}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TMDB API error: ${response.status} ${errorText}`);
  }

  return response.json();
}

// TMDB API response types
interface TMDBSearchResult {
  id: number;
  name?: string; // TV shows
  title?: string; // Movies
  first_air_date?: string;
  release_date?: string;
  poster_path?: string | null;
  overview?: string;
  media_type?: "tv" | "movie" | "person";
  original_language?: string;
  origin_country?: string[];
}

interface TMDBSearchResponse {
  page: number;
  results: TMDBSearchResult[];
  total_results: number;
  total_pages: number;
}

interface TMDBEpisode {
  id: number;
  name: string;
  episode_number: number;
  season_number: number;
  air_date?: string;
  runtime?: number;
  still_path?: string | null;
  overview?: string;
}

interface TMDBSeasonResponse {
  id: number;
  episodes: TMDBEpisode[];
  name: string;
  season_number: number;
}

interface TMDBShowDetails {
  id: number;
  name: string;
  seasons: {
    id: number;
    name: string;
    season_number: number;
    episode_count: number;
  }[];
}

/**
 * Extract year from date string (YYYY-MM-DD format)
 */
function extractYear(dateStr?: string): string | undefined {
  if (!dateStr) return undefined;
  return dateStr.split("-")[0];
}

/**
 * Check if a string contains non-Latin characters
 */
function containsNonLatinCharacters(str: string): boolean {
  const nonLatinRegex = /[^\u0000-\u024F\u1E00-\u1EFF]/;
  return nonLatinRegex.test(str);
}

/**
 * Search for TV series or movies on TMDB
 * Returns results mapped to TVDBSearchResult format for UI compatibility
 */
export async function searchTMDB(
  query: string,
  type?: "series" | "movie",
  lang?: string,
  year?: string
): Promise<TVDBSearchResult[]> {
  const langParam = lang === "it" ? "it-IT" : "en-US";

  const results: TMDBSearchResult[] = [];

  // Search TV shows if type is not specified or is "series"
  if (!type || type === "series") {
    try {
      let tvUrl = `/search/tv?query=${encodeURIComponent(query)}&language=${langParam}`;
      if (year) {
        tvUrl += `&first_air_date_year=${year}`;
      }
      const tvResponse = await tmdbFetch<TMDBSearchResponse>(tvUrl);
      results.push(
        ...tvResponse.results.map((r) => ({ ...r, media_type: "tv" as const }))
      );
    } catch (error) {
      // Re-throw API key missing errors, ignore other errors for partial searches
      if (error instanceof Error && error.message.startsWith("API_KEY_MISSING:")) {
        throw error;
      }
    }
  }

  // Search movies if type is not specified or is "movie"
  if (!type || type === "movie") {
    try {
      let movieUrl = `/search/movie?query=${encodeURIComponent(query)}&language=${langParam}`;
      if (year) {
        movieUrl += `&primary_release_year=${year}`;
      }
      const movieResponse = await tmdbFetch<TMDBSearchResponse>(movieUrl);
      results.push(
        ...movieResponse.results.map((r) => ({
          ...r,
          media_type: "movie" as const,
        }))
      );
    } catch (error) {
      // Re-throw API key missing errors, ignore other errors for partial searches
      if (error instanceof Error && error.message.startsWith("API_KEY_MISSING:")) {
        throw error;
      }
    }
  }

  // Map TMDB results to TVDBSearchResult format
  const mappedResults: TVDBSearchResult[] = results
    .filter((r) => r.media_type === "tv" || r.media_type === "movie")
    .map((r) => {
      const name = r.name || r.title || "";
      const year = extractYear(r.first_air_date || r.release_date);

      return {
        id: `tmdb-${r.id}`, // Prefix to distinguish from TVDB IDs
        name,
        type: r.media_type === "tv" ? ("series" as const) : ("movie" as const),
        year,
        image_url: r.poster_path
          ? `${TMDB_IMAGE_BASE}${r.poster_path}`
          : undefined,
        overview: r.overview,
        primary_language: r.original_language,
        country: r.origin_country?.[0],
        // TMDB returns localized names based on language param
        // If searching in Italian and name has non-Latin chars, the name is already translated
        name_translated: undefined,
        name_english: lang !== "en" ? undefined : name,
      };
    });

  return mappedResults;
}

/**
 * Get episodes for a TV series from TMDB
 * Returns episodes mapped to TVDBEpisode format for UI compatibility
 */
export async function getTMDBSeriesEpisodes(
  seriesId: string | number,
  season?: number,
  lang?: string
): Promise<TVDBEpisode[]> {
  // Extract numeric ID from "tmdb-12345" format
  const numericId =
    typeof seriesId === "string"
      ? seriesId.replace(/^tmdb-/, "")
      : seriesId.toString();

  const langParam = lang === "it" ? "it-IT" : "en-US";
  const allEpisodes: TVDBEpisode[] = [];

  if (season !== undefined) {
    // Fetch specific season
    try {
      const seasonData = await tmdbFetch<TMDBSeasonResponse>(
        `/tv/${numericId}/season/${season}?language=${langParam}`
      );
      allEpisodes.push(...mapTMDBEpisodes(seasonData.episodes, numericId, lang));
    } catch {
      // Season might not exist
    }
  } else {
    // Fetch all seasons - first get show details for season count
    try {
      const showDetails = await tmdbFetch<TMDBShowDetails>(
        `/tv/${numericId}?language=${langParam}`
      );

      for (const s of showDetails.seasons) {
        if (s.season_number >= 0 && s.episode_count > 0) {
          // Include specials (season 0)
          try {
            const seasonData = await tmdbFetch<TMDBSeasonResponse>(
              `/tv/${numericId}/season/${s.season_number}?language=${langParam}`
            );
            allEpisodes.push(
              ...mapTMDBEpisodes(seasonData.episodes, numericId, lang)
            );
          } catch {
            // Season might not exist, skip
          }
        }
      }
    } catch {
      // Show not found
    }
  }

  // Sort by season, then episode number
  allEpisodes.sort((a, b) => {
    if (a.seasonNumber !== b.seasonNumber) {
      return a.seasonNumber - b.seasonNumber;
    }
    return a.number - b.number;
  });

  return allEpisodes;
}

/**
 * Map TMDB episodes to TVDBEpisode format
 */
function mapTMDBEpisodes(
  episodes: TMDBEpisode[],
  seriesId: string,
  lang?: string
): TVDBEpisode[] {
  return episodes.map((ep) => ({
    id: ep.id,
    seriesId: parseInt(seriesId, 10),
    name: ep.name,
    seasonNumber: ep.season_number,
    number: ep.episode_number,
    aired: ep.air_date,
    runtime: ep.runtime,
    image: ep.still_path ? `${TMDB_IMAGE_BASE}${ep.still_path}` : undefined,
    overview: ep.overview,
    // TMDB returns localized names based on language param
    // Set nameItalian if we requested Italian
    nameItalian: lang === "it" ? ep.name : undefined,
    nameEnglish: lang !== "it" ? ep.name : undefined,
  }));
}

/**
 * Get unique seasons from episodes
 */
export function getUniqueSeasons(episodes: TVDBEpisode[]): number[] {
  const seasons = new Set<number>();
  for (const ep of episodes) {
    if (ep.seasonNumber !== undefined && ep.seasonNumber >= 0) {
      seasons.add(ep.seasonNumber);
    }
  }
  return Array.from(seasons).sort((a, b) => a - b);
}

/**
 * Filter episodes by season
 */
export function filterEpisodesBySeason(
  episodes: TVDBEpisode[],
  season: number
): TVDBEpisode[] {
  return episodes
    .filter((ep) => ep.seasonNumber === season)
    .sort((a, b) => a.number - b.number);
}
