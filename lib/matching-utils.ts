import type { TVDBSearchResult, ParsedFileName } from "@/types/tvdb";

/**
 * Normalize strings for comparison (lowercase, remove extra spaces/punctuation)
 */
export function normalizeForComparison(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // Remove punctuation
    .replace(/\s+/g, " ") // Normalize spaces
    .trim();
}

/**
 * Calculate similarity between two strings (0-1 score)
 * Uses word-based matching to handle partial matches
 */
export function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;

  const words1 = str1.split(" ").filter((w) => w.length >= 2);
  const words2 = str2.split(" ").filter((w) => w.length >= 2);

  if (words1.length === 0 || words2.length === 0) return 0;

  // Check if one string fully contains the other (all significant words match)
  // This handles cases like "Anna Dei Miracoli The Miracle Worker" containing "The Miracle Worker"
  const shorterWords = words1.length <= words2.length ? words1 : words2;
  const longerWords = words1.length > words2.length ? words1 : words2;

  let containedMatches = 0;
  for (const shortWord of shorterWords) {
    for (const longWord of longerWords) {
      if (
        shortWord === longWord ||
        shortWord.includes(longWord) ||
        longWord.includes(shortWord)
      ) {
        containedMatches++;
        break;
      }
    }
  }

  // If ALL words from shorter string are found in longer string, high score
  if (containedMatches === shorterWords.length) {
    return 0.95;
  }

  // Fallback: proportion of matching words from shorter string
  return containedMatches / shorterWords.length;
}

/**
 * Find the best auto-matching TVDB result for a parsed filename
 * Returns null if no good match is found
 */
export function findAutoMatch(
  results: TVDBSearchResult[],
  parsedFile: ParsedFileName
): TVDBSearchResult | null {
  const normalizedQuery = normalizeForComparison(parsedFile.cleanName);
  const fileYear = parsedFile.year?.toString();

  let bestMatch: TVDBSearchResult | null = null;
  let bestScore = 0;

  for (const result of results) {
    const resultName = normalizeForComparison(result.name);
    const resultNameTranslated = result.name_translated
      ? normalizeForComparison(result.name_translated)
      : null;
    const resultNameEnglish = result.name_english
      ? normalizeForComparison(result.name_english)
      : null;

    // Calculate similarity scores against all available names
    const originalScore = calculateSimilarity(normalizedQuery, resultName);
    const translatedScore = resultNameTranslated
      ? calculateSimilarity(normalizedQuery, resultNameTranslated)
      : 0;
    const englishScore = resultNameEnglish
      ? calculateSimilarity(normalizedQuery, resultNameEnglish)
      : 0;

    const nameScore = Math.max(originalScore, translatedScore, englishScore);

    // If year matches, boost the score
    const yearMatches = fileYear && result.year && result.year === fileYear;
    const finalScore = yearMatches ? nameScore + 0.3 : nameScore;

    // Require at least 60% word match (or 90% if no year)
    const threshold = yearMatches ? 0.6 : 0.9;

    if (finalScore > bestScore && nameScore >= threshold) {
      bestScore = finalScore;
      bestMatch = result;
    }
  }

  return bestMatch;
}

/**
 * Get the display name for a TVDB result
 * @param result - The TVDB search result
 * @param language - Optional language preference. If "it", prefers Italian name.
 *                   If "en" or undefined, prefers English name.
 * @returns The appropriate name based on language preference
 */
export function getDisplayName(result: TVDBSearchResult | null, language?: string): string {
  if (!result) return "";

  if (language === "it") {
    // For Italian: prefer translated name (which is Italian when lang=it)
    return result.name_translated || result.name;
  }

  // For English or default: prefer English name, then original
  return result.name_english || result.name;
}
