import type { ParsedFileName } from "@/types/tvdb";
import type { SeriesNamingTemplate, MovieNamingTemplate } from "@/types/config";
import { defaultSeriesNamingTemplate, defaultMovieNamingTemplate, defaultQualityValues, defaultCodecValues, defaultExtraTagValues } from "@/types/config";

// Options for parsing with custom quality/codec/extraTag patterns
export interface ParseOptions {
  qualityValues?: string[];
  codecValues?: string[];
  extraTagValues?: string[];
}

// Source/release indicators to remove from filenames during parsing
const RELEASE_PATTERNS = [
  // Source types
  "webrip",
  "web-rip",
  "web-dl",
  "webdl",
  "web",
  "bluray",
  "blu-ray",
  "bdrip",
  "brrip",
  "dvdrip",
  "dvd",
  "hdtv",
  "hdtvrip",
  "pdtv",
  "dsr",
  "dsrip",
  "satrip",
  "dthrip",
  "dvbr",
  "hdcam",
  "hdrip",
  "cam",
  "ts",
  "telesync",
  "tc",
  "telecine",
  "screener",
  "scr",
  "r5",
  "vod",
  // Codecs
  "x264",
  "x265",
  "h264",
  "h265",
  "hevc",
  "avc",
  "xvid",
  "divx",
  // Audio codecs
  "aac",
  "ac3",
  "dts",
  "dd5\\.1",
  "5\\.1",
  "7\\.1",
  "atmos",
  "truehd",
  "flac",
  "mp3",
  "eac3",
  "ddp",
  "ddp5\\.1",
  // Release types
  "proper",
  "repack",
  "rerip",
  "extended",
  "unrated",
  "directors cut",
  "dc",
  "theatrical",
  "imax",
  "remux",
  // Video quality
  "hdr",
  "hdr10",
  "hdr10\\+",
  "dolby vision",
  "dv",
  "sdr",
  "10bit",
  "8bit",
  // Language codes (common)
  "jap",
  "jpn",
  "japanese",
  "eng",
  "english",
  "ita",
  "italian",
  "ger",
  "german",
  "fre",
  "french",
  "spa",
  "spanish",
  "kor",
  "korean",
  "chi",
  "chinese",
  "rus",
  "russian",
  "por",
  "portuguese",
  "dub",
  "dubbed",
  "dual",
  "multi",
  // Subtitles
  "sub",
  "subs",
  "subbed",
  "subtitle",
  "subtitles",
  "hardsub",
  "softsub",
];

// Common scene group patterns (at end of filename)
const GROUP_PATTERN = /-[a-z0-9]+$/i;

/**
 * Build quality and codec patterns from config values only (no hardcoded fallbacks)
 */
function buildPatterns(options?: ParseOptions): {
  qualityPatterns: string[];
  codecPatterns: string[];
  preservePatterns: string[];
} {
  // Use config values only - if empty, nothing will be detected
  const customQuality = options?.qualityValues ?? defaultQualityValues;
  const customCodec = options?.codecValues ?? defaultCodecValues;
  const customExtraTags = options?.extraTagValues ?? defaultExtraTagValues;

  const qualityPatterns = customQuality.map(v => escapeRegex(v));
  const codecPatterns = customCodec.map(v => escapeRegex(v));

  // Preserve patterns include quality, codec, and extra tags for the qualityInfo string
  const preservePatterns = [
    ...customQuality.map(v => escapeRegex(v)),
    ...customCodec.map(v => escapeRegex(v)),
    ...customExtraTags.map(v => escapeRegex(v)),
  ];

  return { qualityPatterns, codecPatterns, preservePatterns };
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse a media filename to extract show/movie info
 */
export function parseFileName(filename: string, options?: ParseOptions): ParsedFileName {
  const { qualityPatterns, preservePatterns } = buildPatterns(options);
  // Get extension
  const lastDotIndex = filename.lastIndexOf(".");
  const extension =
    lastDotIndex !== -1 ? filename.slice(lastDotIndex + 1).toLowerCase() : "";
  const nameWithoutExt =
    lastDotIndex !== -1 ? filename.slice(0, lastDotIndex) : filename;

  // Work with a copy for parsing
  let workingName = nameWithoutExt;

  // Split CamelCase words (e.g., "KimetsuNoYaiba" -> "Kimetsu No Yaiba")
  // This handles anime titles that are written without separators
  // Only split where a lowercase letter is immediately followed by an uppercase letter
  workingName = workingName.replace(/([a-z])([A-Z])/g, "$1 $2");

  // Remove all bracketed content early (like [Erai-raws], [720p], [SubGroup], etc.)
  // This must happen before season/episode extraction to avoid parsing issues
  workingName = workingName.replace(/\[.*?\]/g, " ");

  // Remove "by user-id" or "by username" patterns at the end
  workingName = workingName.replace(/\s+by\s+[\w\-]+$/i, " ");

  // Extract quality - find the first one for the quality field
  // Patterns must be standalone (at start/end or surrounded by separators)
  let quality: string | undefined;
  for (const q of qualityPatterns) {
    // Match only if preceded by separator/start AND followed by separator/end
    const qRegex = new RegExp(`(?:^|[.\\s_\\-\\[\\(])(${q})(?:[.\\s_\\-\\]\\)]|$)`, "i");
    const match = workingName.match(qRegex);
    if (match && !quality) {
      quality = match[1].toLowerCase();
    }
  }

  // Extract quality info string to preserve (resolution + codec)
  // This captures patterns like "1080p.H264" or "FullHD 1080p H264"
  const qualityInfoParts: string[] = [];
  for (const q of preservePatterns) {
    const qRegex = new RegExp(`(?:^|[.\\s_\\-\\[\\(])(${q})(?:[.\\s_\\-\\]\\)]|$)`, "i");
    const match = workingName.match(qRegex);
    if (match) {
      // Normalize the match (keep original case but fix common variations)
      let normalized = match[1];
      // Normalize H.264/H.265 to H264/H265
      normalized = normalized.replace(/h\.(\d{3})/gi, "H$1");
      // Normalize FullHD to 1080p (but keep FullHD if also found)
      qualityInfoParts.push(normalized);
    }
  }
  // Build quality info string, joining with dots
  const qualityInfo = qualityInfoParts.length > 0 ? qualityInfoParts.join(".") : undefined;

  // Remove ALL quality patterns from name (only standalone occurrences)
  for (const q of qualityPatterns) {
    const qRegex = new RegExp(`(?:^|[.\\s_\\-\\[\\(])(${q})(?:[.\\s_\\-\\]\\)]|$)`, "gi");
    workingName = workingName.replace(qRegex, " ");
  }

  // Remove release group at end
  workingName = workingName.replace(GROUP_PATTERN, "");

  // Remove common release patterns (only standalone occurrences)
  for (const pattern of RELEASE_PATTERNS) {
    const regex = new RegExp(`(?:^|[.\\s_\\-\\[\\(])${pattern}(?:[.\\s_\\-\\]\\)]|$)`, "gi");
    workingName = workingName.replace(regex, " ");
  }

  // Try to extract season and episode info
  let season: number | undefined;
  let episode: number | undefined;
  let isLikelyMovie = true;

  // Pattern 1: S01E02 or S1E2 (can appear at start or after separator)
  // Also handles patterns like "Show - S01E02" or "S01E02 - Episode Name"
  const sXeY = workingName.match(/(?:^|[.\s_\-])[Ss](\d{1,2})[.\s_\-]?[Ee](\d{1,3})/);
  if (sXeY) {
    season = parseInt(sXeY[1], 10);
    episode = parseInt(sXeY[2], 10);
    workingName = workingName.slice(0, sXeY.index);
    isLikelyMovie = false;
  }

  // Pattern 2: 1x02 or 01x02
  if (season === undefined) {
    const nXn = workingName.match(/[.\s_\-](\d{1,2})[xX](\d{1,3})/);
    if (nXn) {
      season = parseInt(nXn[1], 10);
      episode = parseInt(nXn[2], 10);
      workingName = workingName.slice(0, nXn.index);
      isLikelyMovie = false;
    }
  }

  // Pattern 3: Season 1 Episode 2
  if (season === undefined) {
    const seasonEp = workingName.match(
      /[.\s_\-]?Season[.\s_\-]?(\d{1,2})[.\s_\-]?Episode[.\s_\-]?(\d{1,3})/i
    );
    if (seasonEp) {
      season = parseInt(seasonEp[1], 10);
      episode = parseInt(seasonEp[2], 10);
      workingName = workingName.slice(0, seasonEp.index);
      isLikelyMovie = false;
    }
  }

  // Pattern 4: E02 or Ep02 (assumes season 1 if just episode)
  if (season === undefined) {
    const epOnly = workingName.match(/[.\s_\-][Ee](?:p(?:isode)?)?[.\s_\-]?(\d{1,3})/i);
    if (epOnly) {
      season = 1;
      episode = parseInt(epOnly[1], 10);
      workingName = workingName.slice(0, epOnly.index);
      isLikelyMovie = false;
    }
  }

  // Pattern 5: Standalone episode number like "Show Name 0492" or "Show Name 123"
  // Common for anime where episode numbers are 3-4 digits without season prefix
  if (season === undefined) {
    const standaloneEp = workingName.match(/[.\s_\-](\d{2,4})(?:[.\s_\-]|$)/);
    if (standaloneEp) {
      const epNum = parseInt(standaloneEp[1], 10);
      // Only treat as episode if it's a reasonable episode number (1-9999)
      // and not likely a year (1900-2099)
      if (epNum > 0 && epNum < 10000 && (epNum < 1900 || epNum > 2099)) {
        season = 1;
        episode = epNum;
        workingName = workingName.slice(0, standaloneEp.index);
        isLikelyMovie = false;
      }
    }
  }

  // Try to extract year (4 digits, typically 1900-2099)
  let year: number | undefined;
  const yearMatch = workingName.match(/[.\s_\-\(\[]?((?:19|20)\d{2})[.\s_\-\)\]]?/);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
    // Only remove year from name if it looks like a movie (no season/episode)
    if (isLikelyMovie) {
      workingName = workingName.slice(0, yearMatch.index);
    }
  }

  // Clean up the name
  let cleanName = workingName
    // Replace common separators with spaces
    .replace(/[._]/g, " ")
    // Remove parenthetical content like (2023) - brackets already removed earlier
    .replace(/\(.*?\)/g, " ")
    // Remove extra whitespace
    .replace(/\s+/g, " ")
    .trim();

  // For TV shows, truncate at the first " - " separator which usually indicates episode title
  // e.g., "One Piece - Dr. Chopper's Adventure" -> "One Piece"
  if (!isLikelyMovie && cleanName.includes(" - ")) {
    const parts = cleanName.split(" - ");
    // Take only the first part (show name)
    cleanName = parts[0].trim();
  }

  // Also handle standalone dashes that weren't part of " - " pattern
  cleanName = cleanName.replace(/-+/g, " ").replace(/\s+/g, " ").trim();

  // Capitalize words
  cleanName = cleanName
    .split(" ")
    .map((word) => {
      if (word.length === 0) return word;
      // Keep acronyms uppercase if they're all caps
      if (word === word.toUpperCase() && word.length <= 4) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");

  return {
    originalName: filename,
    cleanName,
    season,
    episode,
    year,
    quality,
    qualityInfo,
    extension,
    isLikelyMovie,
  };
}

/**
 * Sanitize a string for use as a filename
 * Removes or replaces characters that are invalid in Windows/Unix filenames
 */
export function sanitizeFileName(name: string): string {
  return (
    name
      // Replace colon with dash (common in titles like "Movie: Subtitle")
      .replace(/:/g, " -")
      // Remove/replace characters that are invalid in filenames (Windows + Unix)
      // Includes: < > : " / \ | ? * and control characters
      .replace(/[<>"/\\|?*\x00-\x1f]/g, "")
      // Replace fullwidth characters that look like illegal chars (common in Japanese/CJK text)
      .replace(/[\uff1a]/g, " -") // Fullwidth colon ：
      .replace(/[\uff1c\uff1e\uff02\uff0f\uff3c\uff5c\uff1f\uff0a]/g, "") // Fullwidth < > " / \ | ? *
      // Replace en-dash, em-dash, and other dash-like characters with regular dash
      .replace(/[\u2013\u2014\u2015]/g, "-")
      // Remove other potentially problematic Unicode characters
      .replace(/[\u200b\u200c\u200d\ufeff]/g, "") // Zero-width chars
      // Replace multiple spaces/dashes with single space/dash
      .replace(/\s+/g, " ")
      .replace(/-+/g, "-")
      // Clean up " - - " patterns that might result from replacements
      .replace(/\s*-\s*-\s*/g, " - ")
      // Remove leading/trailing spaces, dots, and dashes
      .replace(/^[\s.\-]+|[\s.\-]+$/g, "")
      .trim()
  );
}

/**
 * Format season number with leading zero
 */
export function formatSeason(season: number): string {
  return season.toString().padStart(2, "0");
}

/**
 * Format episode number with leading zero
 */
export function formatEpisode(episode: number): string {
  return episode.toString().padStart(2, "0");
}

/**
 * Generate a new filename for a TV episode
 */
export function generateEpisodeFileName(
  showName: string,
  season: number,
  episode: number,
  episodeName: string | undefined,
  extension: string
): string {
  const sanitizedShow = sanitizeFileName(showName);
  const sanitizedEpName = episodeName ? sanitizeFileName(episodeName) : "";

  let fileName = `${sanitizedShow} - S${formatSeason(season)}E${formatEpisode(episode)}`;
  if (sanitizedEpName) {
    fileName += ` - ${sanitizedEpName}`;
  }
  fileName += `.${extension}`;

  return fileName;
}

/**
 * Generate a new filename for a movie
 */
export function generateMovieFileName(
  movieName: string,
  year: string | undefined,
  extension: string
): string {
  const sanitizedName = sanitizeFileName(movieName);
  let fileName = sanitizedName;
  if (year) {
    fileName += ` (${year})`;
  }
  fileName += `.${extension}`;
  return fileName;
}

/**
 * Generate the full path structure for a TV episode
 */
export function generateEpisodePath(
  showName: string,
  season: number,
  episode: number,
  episodeName: string | undefined,
  extension: string
): string {
  const sanitizedShow = sanitizeFileName(showName);
  const fileName = generateEpisodeFileName(
    showName,
    season,
    episode,
    episodeName,
    extension
  );
  const seasonFolder = season === 0 ? "Specials" : `Season ${formatSeason(season)}`;
  return `${sanitizedShow}/${seasonFolder}/${fileName}`;
}

/**
 * Generate the full path structure for a movie
 */
export function generateMoviePath(
  movieName: string,
  year: string | undefined,
  extension: string
): string {
  const sanitizedName = sanitizeFileName(movieName);
  let folderName = sanitizedName;
  if (year) {
    folderName += ` (${year})`;
  }
  const fileName = generateMovieFileName(movieName, year, extension);
  return `${folderName}/${fileName}`;
}

// ============================================================================
// TEMPLATE-BASED NAMING FUNCTIONS
// ============================================================================

/**
 * Split a qualityInfo string (e.g., "1080p.H264.10bit.ITA") into separate quality, codec, and extra tags
 * @param qualityInfo - The quality info string to split
 * @param options - Optional custom quality/codec/extraTags values from config
 */
export function splitQualityInfo(
  qualityInfo: string | undefined,
  options?: ParseOptions
): { quality: string; codec: string; extraTags: string } {
  if (!qualityInfo) {
    return { quality: "", codec: "", extraTags: "" };
  }

  // Use config values only - if empty, nothing will be detected
  const customQuality = options?.qualityValues ?? defaultQualityValues;
  const customCodec = options?.codecValues ?? defaultCodecValues;
  const customExtraTags = options?.extraTagValues ?? defaultExtraTagValues;

  // Split by common separators
  const parts = qualityInfo.split(/[.\s_-]+/);

  const allResolutions = customQuality.map(v => v.toLowerCase());

  let quality = "";
  let codec = "";
  const extraTagParts: string[] = [];

  for (const part of parts) {
    const lowerPart = part.toLowerCase();
    let matched = false;

    // Check if it's a resolution/quality (only take the first one)
    if (!quality && allResolutions.some(p => lowerPart === p || lowerPart === p.replace("-", ""))) {
      quality = part;
      matched = true;
    }

    // Check if it's a codec (only take the first one)
    // Also check for codec aliases (h264↔x264, h265↔x265, hevc↔h265, avc↔h264)
    if (!matched && !codec) {
      const normalizedPart = lowerPart.replace(".", "");
      // Build list of equivalent codec names to check
      const codecAliases: string[] = [normalizedPart];
      if (normalizedPart === "h264" || normalizedPart === "x264" || normalizedPart === "avc") {
        codecAliases.push("h264", "x264", "avc");
      } else if (normalizedPart === "h265" || normalizedPart === "x265" || normalizedPart === "hevc") {
        codecAliases.push("h265", "x265", "hevc");
      }

      // Find the matching codec from the user's config (to use their preferred format)
      const matchedCodec = customCodec.find(p =>
        codecAliases.includes(p.toLowerCase()) || codecAliases.includes(p.toLowerCase().replace(".", ""))
      );

      if (matchedCodec) {
        // Use the user's preferred format from config (e.g., if config has "H264", use "H264")
        codec = matchedCodec;
        matched = true;
      }
    }

    // Check if it's an extra tag (collect all matching)
    if (!matched) {
      // Find the matching tag from config to use the user's preferred case
      const matchedTag = customExtraTags.find(p =>
        lowerPart === p.toLowerCase() || lowerPart === p.toLowerCase().replace("-", "")
      );
      if (matchedTag) {
        // Avoid duplicates
        if (!extraTagParts.some(t => t.toLowerCase() === matchedTag.toLowerCase())) {
          extraTagParts.push(matchedTag);
        }
      }
    }
  }

  // Filter out tags that are substrings of other matched tags (priority system)
  // e.g., if we have both "HDR10" and "HDR", keep only "HDR10"
  // This handles cases like: HDR10+ > HDR10 > HDR, DTS-HD > DTS, etc.
  const filteredExtraTags = extraTagParts.filter(tag => {
    const tagLower = tag.toLowerCase().replace(/[^a-z0-9]/g, "");
    // Check if any other tag contains this tag as a substring (and is longer)
    const isSubstringOfOther = extraTagParts.some(otherTag => {
      if (otherTag === tag) return false;
      const otherLower = otherTag.toLowerCase().replace(/[^a-z0-9]/g, "");
      // Keep the tag only if no other tag contains it as a proper substring
      return otherLower.includes(tagLower) && otherLower.length > tagLower.length;
    });
    return !isSubstringOfOther;
  });

  return { quality, codec, extraTags: filteredExtraTags.join(".") };
}

/**
 * Data for series episode template
 */
export interface SeriesTemplateData {
  seriesName: string;
  seriesYear?: string;
  season: number;
  episode: number;
  episodeTitle?: string;
  quality?: string;    // Resolution (e.g., "1080p", "4K")
  codec?: string;      // Video codec (e.g., "H264", "HEVC")
  extraTags?: string;  // Extra tags (e.g., "10bit.HDR.ITA")
  extension: string;
}

/**
 * Data for movie template
 */
export interface MovieTemplateData {
  movieName: string;
  year?: string;
  quality?: string;    // Resolution (e.g., "1080p", "4K")
  codec?: string;      // Video codec (e.g., "H264", "HEVC")
  extraTags?: string;  // Extra tags (e.g., "10bit.HDR.ITA")
  extension: string;
}

/**
 * Apply a series naming template to generate folder and filename
 */
export function applySeriesTemplate(
  template: SeriesNamingTemplate | undefined,
  data: SeriesTemplateData
): { seriesFolder: string; seasonFolder: string; fileName: string; fullPath: string } {
  const t = template || defaultSeriesNamingTemplate;

  // Pad numbers according to template settings
  const seasonPadded = data.season.toString().padStart(t.seasonPadding, "0");
  const episodePadded = data.episode.toString().padStart(t.episodePadding, "0");

  // Sanitize inputs
  // Strip year from series name if it already ends with it (e.g. "The Studio (2025)" + year "2025")
  let rawSeriesName = data.seriesName;
  const seriesYear = data.seriesYear || "";
  if (seriesYear && rawSeriesName.endsWith(`(${seriesYear})`)) {
    rawSeriesName = rawSeriesName.slice(0, -(seriesYear.length + 2)).trim();
  }
  const seriesName = sanitizeFileName(rawSeriesName);
  const episodeTitle = data.episodeTitle ? sanitizeFileName(data.episodeTitle) : "";
  const quality = data.quality || "";
  const codec = data.codec || "";
  const extraTags = data.extraTags || "";

  // Helper to replace tokens in a string
  const replaceTokens = (str: string): string => {
    return str
      .replace(/\{seriesName\}/g, seriesName)
      .replace(/\{seriesYear\}/g, seriesYear)
      .replace(/\{season\}/g, seasonPadded)
      .replace(/\{episode\}/g, episodePadded)
      .replace(/\{episodeTitle\}/g, episodeTitle)
      .replace(/\{quality\}/g, quality)
      .replace(/\{codec\}/g, codec)
      .replace(/\{extraTags\}/g, extraTags)
      // Clean up empty parentheses/brackets from missing values
      .replace(/\s*\(\s*\)/g, "")
      .replace(/\s*\[\s*\]/g, "")
      // Clean up trailing/leading spaces inside brackets and parentheses
      .replace(/\[\s+/g, "[")  // Remove spaces after [
      .replace(/\s+\]/g, "]")  // Remove spaces before ]
      .replace(/\(\s+/g, "(")  // Remove spaces after (
      .replace(/\s+\)/g, ")")  // Remove spaces before )
      // Clean up trailing/leading separators
      .replace(/\s+-\s*$/g, "") // Remove trailing " -"
      .replace(/^\s*-\s+/g, "") // Remove leading "- "
      // Clean up multiple consecutive spaces
      .replace(/\s+/g, " ")
      // Clean up multiple consecutive dots
      .replace(/\.{2,}/g, ".")
      .trim();
  };

  // Generate series folder
  const seriesFolder = replaceTokens(t.folderTemplate);

  // Generate season folder
  const seasonFolder = data.season === 0
    ? replaceTokens(t.specialsFolderTemplate)
    : replaceTokens(t.seasonFolderTemplate);

  // Generate filename (without extension) - also remove trailing dots/spaces
  const fileNameWithoutExt = replaceTokens(t.fileTemplate).replace(/[\s.]+$/g, "").replace(/^[\s.]+/g, "");
  const fileName = `${fileNameWithoutExt}.${data.extension}`;

  // Generate full path
  const fullPath = `${seriesFolder}/${seasonFolder}/${fileName}`;

  return { seriesFolder, seasonFolder, fileName, fullPath };
}

/**
 * Apply a movie naming template to generate folder and filename
 */
export function applyMovieTemplate(
  template: MovieNamingTemplate | undefined,
  data: MovieTemplateData
): { folder: string; fileName: string; fullPath: string } {
  const t = template || defaultMovieNamingTemplate;

  // Sanitize inputs
  const movieName = sanitizeFileName(data.movieName);
  const year = data.year || "";
  const quality = data.quality || "";
  const codec = data.codec || "";
  const extraTags = data.extraTags || "";

  // Helper to replace tokens in a string
  const replaceTokens = (str: string): string => {
    return str
      .replace(/\{movieName\}/g, movieName)
      .replace(/\{year\}/g, year)
      .replace(/\{quality\}/g, quality)
      .replace(/\{codec\}/g, codec)
      .replace(/\{extraTags\}/g, extraTags)
      // Clean up empty parentheses/brackets from missing values
      .replace(/\s*\(\s*\)/g, "")
      .replace(/\s*\[\s*\]/g, "")
      // Clean up trailing/leading spaces inside brackets and parentheses
      .replace(/\[\s+/g, "[")  // Remove spaces after [
      .replace(/\s+\]/g, "]")  // Remove spaces before ]
      .replace(/\(\s+/g, "(")  // Remove spaces after (
      .replace(/\s+\)/g, ")")  // Remove spaces before )
      // Clean up trailing/leading separators
      .replace(/\s+-\s*$/g, "") // Remove trailing " -"
      .replace(/^\s*-\s+/g, "") // Remove leading "- "
      // Clean up multiple consecutive spaces
      .replace(/\s+/g, " ")
      // Clean up multiple consecutive dots
      .replace(/\.{2,}/g, ".")
      .trim();
  };

  // Generate filename (without extension) - also remove trailing dots/spaces
  const fileNameWithoutExt = replaceTokens(t.fileTemplate).replace(/[\s.]+$/g, "").replace(/^[\s.]+/g, "");
  const fileName = `${fileNameWithoutExt}.${data.extension}`;

  // Generate folder based on folderStructure setting
  let folder = "";
  switch (t.folderStructure) {
    case "year":
      // Use year as folder
      folder = year;
      break;
    case "name":
      // Use folder template
      folder = replaceTokens(t.folderTemplate);
      break;
    case "none":
    default:
      // No subfolder
      folder = "";
      break;
  }

  // Generate full path
  const fullPath = folder ? `${folder}/${fileName}` : fileName;

  return { folder, fileName, fullPath };
}
