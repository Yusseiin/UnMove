import type {
  TVDBLoginResponse,
  TVDBSearchResponse,
  TVDBSearchResult,
  TVDBSeriesEpisodesResponse,
  TVDBEpisode,
  TVDBTranslationResponse,
} from "@/types/tvdb";

const TVDB_BASE_URL = "https://api4.thetvdb.com/v4";

// Token cache - valid for ~1 month, but we'll refresh more frequently
let cachedToken: string | null = null;
let tokenExpiry: number | null = null;

/**
 * Get API key from environment
 */
function getApiKey(): string {
  const apiKey = process.env.TVDB_API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY_MISSING:TVDB_API_KEY");
  }
  return apiKey;
}

/**
 * Login to TVDB API and get bearer token
 */
async function login(): Promise<string> {
  const apiKey = getApiKey();

  const response = await fetch(`${TVDB_BASE_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ apikey: apiKey }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TVDB login failed: ${response.status} ${errorText}`);
  }

  const data: TVDBLoginResponse = await response.json();

  if (!data.data?.token) {
    throw new Error("TVDB login response missing token");
  }

  return data.data.token;
}

/**
 * Get a valid token, refreshing if necessary
 */
async function getToken(): Promise<string> {
  const now = Date.now();

  // If we have a valid cached token, use it
  // Refresh if less than 1 day until expiry (token valid for ~1 month)
  if (cachedToken && tokenExpiry && now < tokenExpiry - 24 * 60 * 60 * 1000) {
    return cachedToken;
  }

  // Get a new token
  cachedToken = await login();
  // Set expiry to 25 days from now (conservative, actual is ~30 days)
  tokenExpiry = now + 25 * 24 * 60 * 60 * 1000;

  return cachedToken;
}

/**
 * Make an authenticated request to TVDB API
 */
async function tvdbFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();

  const response = await fetch(`${TVDB_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (response.status === 401) {
    // Token expired, clear cache and retry once
    cachedToken = null;
    tokenExpiry = null;
    const newToken = await getToken();

    const retryResponse = await fetch(`${TVDB_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${newToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!retryResponse.ok) {
      const errorText = await retryResponse.text();
      throw new Error(`TVDB API error: ${retryResponse.status} ${errorText}`);
    }

    return retryResponse.json();
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TVDB API error: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Get English translation for a series or movie
 */
async function getSeriesTranslation(
  seriesId: string | number,
  entityType: "series" | "movie" = "series"
): Promise<string | null> {
  try {
    // Extract numeric ID if format is "series-12345" or "movie-12345"
    const numericId = typeof seriesId === "string"
      ? seriesId.replace(/^(series|movie)-/, "")
      : seriesId;

    const endpoint = entityType === "movie" ? "movies" : "series";
    const response = await tvdbFetch<TVDBTranslationResponse>(
      `/${endpoint}/${numericId}/translations/eng`
    );
    return response.data?.name || null;
  } catch {
    // Translation not available
    return null;
  }
}

/**
 * Check if a string contains non-Latin characters (e.g., Japanese, Chinese, Korean, Arabic, etc.)
 */
function containsNonLatinCharacters(str: string): boolean {
  // Match characters outside of Basic Latin, Latin Extended, and common punctuation
  // This catches Japanese (Hiragana, Katakana, CJK), Korean (Hangul), Arabic, Hebrew, etc.
  const nonLatinRegex = /[^\u0000-\u024F\u1E00-\u1EFF]/;
  return nonLatinRegex.test(str);
}

/**
 * Search for TV series or movies
 * Automatically fetches translations based on preferred language
 * @param query - Search query
 * @param type - Filter by series or movie
 * @param lang - Preferred language: "it" for Italian, defaults to English
 * @param year - Filter by release year
 */
export async function searchTVDB(
  query: string,
  type?: "series" | "movie",
  lang?: string,
  year?: string
): Promise<TVDBSearchResult[]> {
  const params = new URLSearchParams({ query });
  if (type) {
    params.set("type", type);
  }
  if (year) {
    params.set("year", year);
  }

  const response = await tvdbFetch<TVDBSearchResponse>(
    `/search?${params.toString()}`
  );

  const results = response.data || [];

  // Determine preferred translation language
  const preferItalian = lang === "it";

  // For results, get translations based on language setting
  // Always include English name for matching (filenames are often in English)
  const enhancedResults = await Promise.all(
    results.map(async (result) => {
      const italianName = result.translations?.ita;
      let englishName = result.translations?.eng;

      // If the name contains non-Latin characters, try to get English translation
      if (!englishName && containsNonLatinCharacters(result.name)) {
        // Check aliases for an English name (common for anime/foreign films)
        if (result.aliases && result.aliases.length > 0) {
          const englishAlias = result.aliases.find(alias => !containsNonLatinCharacters(alias));
          if (englishAlias) {
            englishName = englishAlias;
          }
        }

        // Otherwise, try to fetch the English translation from the API
        if (!englishName) {
          const entityType = result.type === "movie" ? "movie" : "series";
          const engName = await getSeriesTranslation(result.id, entityType);
          if (engName && !containsNonLatinCharacters(engName)) {
            englishName = engName;
          }
        }
      }

      // Set name_translated based on preferred language (for display)
      // Set name_english always (for matching against filenames)
      if (preferItalian && italianName && italianName !== result.name) {
        return {
          ...result,
          name_translated: italianName,
          name_english: englishName || undefined,
        };
      } else if (englishName && englishName !== result.name) {
        return {
          ...result,
          name_translated: englishName,
          name_english: englishName,
        };
      }

      return {
        ...result,
        name_english: englishName || undefined,
      };
    })
  );

  return enhancedResults;
}

/**
 * Get episodes for a series
 */
export async function getSeriesEpisodes(
  seriesId: string | number,
  season?: number
): Promise<TVDBEpisode[]> {
  // Extract numeric ID if format is "series-12345" or "movie-12345"
  const numericId = typeof seriesId === "string"
    ? seriesId.replace(/^(series|movie)-/, "")
    : seriesId;

  const allEpisodes: TVDBEpisode[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const params = new URLSearchParams({ page: page.toString() });
    if (season !== undefined) {
      params.set("season", season.toString());
    }

    const response = await tvdbFetch<TVDBSeriesEpisodesResponse>(
      `/series/${numericId}/episodes/default?${params.toString()}`
    );

    if (response.data?.episodes) {
      allEpisodes.push(...response.data.episodes);
    }

    // Check if there are more pages
    hasMore = !!response.links?.next;
    page++;

    // Safety limit to prevent infinite loops
    if (page > 50) {
      break;
    }
  }

  return allEpisodes;
}

/**
 * Get Italian translation for an episode
 */
async function getEpisodeTranslation(
  episodeId: number,
  language: string = "ita"
): Promise<string | null> {
  try {
    const response = await tvdbFetch<TVDBTranslationResponse>(
      `/episodes/${episodeId}/translations/${language}`
    );
    return response.data?.name || null;
  } catch {
    // Translation not available
    return null;
  }
}

/**
 * Fetch Italian translations for a batch of episodes
 * Uses parallel requests with a concurrency limit to avoid overwhelming the API
 */
export async function fetchItalianTranslations(
  episodes: TVDBEpisode[]
): Promise<TVDBEpisode[]> {
  const BATCH_SIZE = 5; // Process 5 episodes at a time
  const result: TVDBEpisode[] = [...episodes];

  for (let i = 0; i < episodes.length; i += BATCH_SIZE) {
    const batch = episodes.slice(i, i + BATCH_SIZE);
    const translations = await Promise.all(
      batch.map(ep => getEpisodeTranslation(ep.id, "ita"))
    );

    for (let j = 0; j < batch.length; j++) {
      const idx = i + j;
      if (translations[j]) {
        result[idx] = { ...result[idx], nameItalian: translations[j]! };
      }
    }
  }

  return result;
}

/**
 * Fetch English translations for episodes that have non-Latin names
 * Uses parallel requests with a concurrency limit to avoid overwhelming the API
 */
export async function fetchEnglishTranslations(
  episodes: TVDBEpisode[]
): Promise<TVDBEpisode[]> {
  const BATCH_SIZE = 5; // Process 5 episodes at a time
  const result: TVDBEpisode[] = [...episodes];

  // Only fetch translations for episodes with non-Latin names
  const episodesNeedingTranslation = episodes
    .map((ep, idx) => ({ ep, idx }))
    .filter(({ ep }) => containsNonLatinCharacters(ep.name));

  for (let i = 0; i < episodesNeedingTranslation.length; i += BATCH_SIZE) {
    const batch = episodesNeedingTranslation.slice(i, i + BATCH_SIZE);
    const translations = await Promise.all(
      batch.map(({ ep }) => getEpisodeTranslation(ep.id, "eng"))
    );

    for (let j = 0; j < batch.length; j++) {
      const { idx } = batch[j];
      const translation = translations[j];
      if (translation && !containsNonLatinCharacters(translation)) {
        result[idx] = { ...result[idx], nameEnglish: translation };
      }
    }
  }

  return result;
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
