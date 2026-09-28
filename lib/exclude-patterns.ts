// Matching for the "ignored files and folders" setting.
//
// Two ways to write a pattern, so users don't have to know glob syntax:
//   - plain text ("sample") matches anywhere in the name -> "Show.Sample.mkv"
//   - a pattern with * or ? is a glob over the whole name -> "*.nfo", "sample?"
// Matching is always case-insensitive and applies to the file/folder name,
// never to the rest of the path.

const GLOB_CHARS = /[*?]/;

// Compiled patterns are reused across entries of the same directory listing
const patternCache = new Map<string, RegExp>();

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patternToRegExp(pattern: string): RegExp {
  if (!GLOB_CHARS.test(pattern)) {
    // Plain text: match anywhere in the name
    return new RegExp(escapeRegex(pattern), "i");
  }

  // Glob: * = any characters, ? = one character, anchored to the whole name
  const source = pattern
    .split(/([*?])/)
    .map((part) => (part === "*" ? ".*" : part === "?" ? "." : escapeRegex(part)))
    .join("");

  return new RegExp(`^${source}$`, "i");
}

function compilePattern(pattern: string): RegExp {
  let regex = patternCache.get(pattern);
  if (!regex) {
    regex = patternToRegExp(pattern);
    patternCache.set(pattern, regex);
  }
  return regex;
}

/**
 * Check whether a file or folder name matches any of the ignore patterns
 *
 * @param name - The file or folder name (not the full path)
 * @param patterns - Patterns from the excludePatterns setting
 */
export function isExcludedName(name: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;

  return patterns.some((pattern) => {
    const trimmed = pattern.trim();
    return trimmed.length > 0 && compilePattern(trimmed).test(name);
  });
}
