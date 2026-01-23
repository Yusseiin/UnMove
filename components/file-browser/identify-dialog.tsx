"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { showErrorToast, showSuccessToast, showWarningToast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { File, AlertCircle, AlertTriangle, Image as ImageIcon, Pencil, Check, X, ChevronDown, ChevronRight, Search, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Image from "next/image";
import {
  formatSeason,
  sanitizeFileName,
  applySeriesTemplate,
  applyMovieTemplate,
  splitQualityInfo,
} from "@/lib/filename-parser";
import {
  normalizeForComparison,
  calculateSimilarity,
  findAutoMatch,
  getDisplayName,
} from "@/lib/matching-utils";
import { getTranslations, interpolate } from "@/lib/translations";
import type {
  TVDBSearchResult,
  TVDBEpisode,
  ParsedFileName,
  TVDBApiResponse,
} from "@/types/tvdb";
import type {
  Language,
  MetadataProvider,
  BaseFolder,
  SeriesNamingTemplate,
  MovieNamingTemplate,
  EpisodeOrder,
} from "@/types/config";

// Helper function to format bytes as human-readable string
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

interface ScannedFile {
  path: string;
  name: string;
  relativePath: string;
  parsed: ParsedFileName;
  mediaInfoQuality?: string; // Quality info from ffprobe (fallback when not in filename)
}

interface FileMapping {
  file: ScannedFile;
  episode: TVDBEpisode | null;
  newPath: string;
  error?: string;
  skipped?: boolean;
  existsAtDestination?: boolean; // File already exists at destination
  overwrite?: boolean; // User confirmed overwrite for this file
}

interface IdentifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  filePath: string;
  filePaths?: string[]; // Support multiple paths
  pane?: "downloads" | "media"; // Which pane the files are from
  operation: "copy" | "move" | "rename";
  onConfirm: (newPath: string, hasErrors?: boolean) => void;
  isLoading?: boolean;
  language?: Language;
  // Separate metadata providers for series and movies
  seriesMetadataProvider?: MetadataProvider;
  moviesMetadataProvider?: MetadataProvider;
  // Legacy: single metadata provider (fallback)
  metadataProvider?: MetadataProvider;
  seriesBaseFolders?: BaseFolder[];
  moviesBaseFolders?: BaseFolder[];
  // Global naming templates (used when folder doesn't have override)
  seriesNamingTemplate?: SeriesNamingTemplate;
  movieNamingTemplate?: MovieNamingTemplate;
  // Quality/codec/extraTag values from config
  qualityValues?: string[];
  codecValues?: string[];
  extraTagValues?: string[];
  // Default media type filter (series or movie) - when set, dialog opens with this type pre-selected
  defaultMediaType?: "series" | "movie";
}

export function IdentifyDialog({
  open,
  onOpenChange,
  fileName,
  filePath,
  filePaths,
  pane = "downloads",
  operation,
  onConfirm,
  isLoading: externalLoading,
  language = "en",
  seriesMetadataProvider,
  moviesMetadataProvider,
  metadataProvider,
  seriesBaseFolders = [],
  moviesBaseFolders = [],
  seriesNamingTemplate,
  movieNamingTemplate,
  qualityValues,
  codecValues,
  extraTagValues,
  defaultMediaType,
}: IdentifyDialogProps) {
  // Determine default provider based on defaultMediaType
  // If movie mode, use moviesMetadataProvider; if series mode, use seriesMetadataProvider
  // Falls back to legacy metadataProvider, then to "tvdb"
  const defaultProvider = defaultMediaType === "movie"
    ? (moviesMetadataProvider ?? metadataProvider ?? "tmdb")
    : (seriesMetadataProvider ?? metadataProvider ?? "tvdb");
  // Build parse options from config values
  const parseOptions = { qualityValues, codecValues, extraTagValues };
  const isMobile = useIsMobile();
  // Get translations
  const t = useMemo(() => getTranslations(language), [language]);
  // Scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchYear, setSearchYear] = useState(""); // Year filter for TMDB
  const [searchResults, setSearchResults] = useState<TVDBSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Selection state
  const [selectedResult, setSelectedResult] = useState<TVDBSearchResult | null>(null);

  // Episodes state
  const [episodes, setEpisodes] = useState<TVDBEpisode[]>([]);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);

  // File mappings (how each file maps to an episode)
  const [fileMappings, setFileMappings] = useState<FileMapping[]>([]);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    currentFile: string;
    completed: number;
    failed: number;
    bytesCopied?: number;
    bytesTotal?: number;
    bytesPerSecond?: number;
  } | null>(null);

  // Manual episode selection state
  const [editingFileIndex, setEditingFileIndex] = useState<number | null>(null);
  const [editingSeason, setEditingSeason] = useState<number | null>(null);
  const [editingEpisode, setEditingEpisode] = useState<number | null>(null);

  // Collapsed seasons state
  const [collapsedSeasons, setCollapsedSeasons] = useState<Set<number>>(new Set());

  // Expanded filename tooltip (for mobile click)
  const [expandedFileName, setExpandedFileName] = useState<number | null>(null);

  // Expanded destination path (for mobile click)
  const [expandedDestPath, setExpandedDestPath] = useState<number | null>(null);

  // Expanded movie path (for mobile click)
  const [expandedMoviePath, setExpandedMoviePath] = useState(false);

  // Selected base folder for series/movies
  const [selectedBaseFolder, setSelectedBaseFolder] = useState<string>("");

  // State for folder renaming options (only for rename operation)
  const [renameSeasonFolders, setRenameSeasonFolders] = useState(false);
  const [createSeasonFolders, setCreateSeasonFolders] = useState(false);
  const [renameMainFolder, setRenameMainFolder] = useState(false);
  const [createMainFolder, setCreateMainFolder] = useState(false);

  // Media type filter for search (series or movie)
  const [mediaTypeFilter, setMediaTypeFilter] = useState<"series" | "movie" | null>(defaultMediaType ?? null);

  // Metadata provider (TVDB or TMDB)
  const [activeProvider, setActiveProvider] = useState<MetadataProvider>(defaultProvider);

  // Episode order for TVDB (Aired, DVD, Absolute)
  const [episodeOrder, setEpisodeOrder] = useState<EpisodeOrder>("default");

  // Sync activeProvider and mediaTypeFilter with defaults when dialog opens
  useEffect(() => {
    if (open) {
      setActiveProvider(defaultProvider);
      // Also reset mediaTypeFilter to defaultMediaType when dialog opens
      setMediaTypeFilter(defaultMediaType ?? null);
    }
  }, [open, defaultProvider, defaultMediaType]);

  // Track if provider was manually changed (not from dialog open/default change)
  const [providerManuallyChanged, setProviderManuallyChanged] = useState(false);

  // Re-search when provider is manually changed
  useEffect(() => {
    if (providerManuallyChanged && searchQuery.trim()) {
      performSearch(searchQuery, scannedFiles.length > 1 ? "series" : null, searchYear);
      setProviderManuallyChanged(false);
    }
  }, [providerManuallyChanged, activeProvider]);

  // FFprobe checkbox state for rename operations
  const [useFFprobe, setUseFFprobe] = useState(true);

  // Get the alwaysUseFFprobe setting - for rename use checkbox, for copy/move use folder setting
  const getAlwaysUseFFprobe = useCallback(() => {
    if (operation === "rename") {
      return useFFprobe;
    }
    // For copy/move, use folder setting
    if (!selectedBaseFolder || !selectedResult) return false;
    const folders = selectedResult.type === "series" ? seriesBaseFolders : moviesBaseFolders;
    const folder = folders.find(f => f.name === selectedBaseFolder);
    return folder?.alwaysUseFFprobe ?? false;
  }, [operation, useFFprobe, selectedBaseFolder, selectedResult, seriesBaseFolders, moviesBaseFolders]);

  // Helper to get the appropriate quality info based on settings
  // Combines ffprobe data (resolution/codec) with filename data (extra tags like ITA, HDR)
  const getQualityInfo = useCallback((file: ScannedFile) => {
    const alwaysFFprobe = getAlwaysUseFFprobe();
    const filenameQuality = file.parsed.qualityInfo || "";
    const ffprobeQuality = file.mediaInfoQuality || "";

    if (alwaysFFprobe && ffprobeQuality) {
      // Use ffprobe for resolution/codec, but merge with filename extra tags
      // ffprobe gives us "1080p.H264", filename might have "Ita.HDR"
      if (filenameQuality) {
        return `${ffprobeQuality}.${filenameQuality}`;
      }
      return ffprobeQuality;
    }
    // Default: prefer filename quality, fallback to ffprobe if filename has no quality info
    return filenameQuality || ffprobeQuality;
  }, [getAlwaysUseFFprobe]);

  // Get the effective series naming template (folder override or global)
  const getSeriesNamingTemplate = useCallback((): SeriesNamingTemplate | undefined => {
    if (!selectedBaseFolder) return seriesNamingTemplate;
    const folder = seriesBaseFolders.find(f => f.name === selectedBaseFolder);
    return folder?.seriesNamingTemplate || seriesNamingTemplate;
  }, [selectedBaseFolder, seriesBaseFolders, seriesNamingTemplate]);

  // Get the effective movie naming template (folder override or global)
  const getMovieNamingTemplate = useCallback((): MovieNamingTemplate | undefined => {
    if (!selectedBaseFolder) return movieNamingTemplate;
    const folder = moviesBaseFolders.find(f => f.name === selectedBaseFolder);
    return folder?.movieNamingTemplate || movieNamingTemplate;
  }, [selectedBaseFolder, moviesBaseFolders, movieNamingTemplate]);

  // Check if template uses quality/codec/extraTags tokens
  const templateUsesQuality = useCallback((template: SeriesNamingTemplate | MovieNamingTemplate | undefined): boolean => {
    if (!template) return false;
    const fileTemplate = template.fileTemplate || "";
    const folderTemplate = template.folderTemplate || "";
    return fileTemplate.includes("{quality}") || fileTemplate.includes("{codec}") || fileTemplate.includes("{extraTags}") ||
           folderTemplate.includes("{quality}") || folderTemplate.includes("{codec}") || folderTemplate.includes("{extraTags}");
  }, []);

  // Existing files check state
  const [isCheckingExisting, setIsCheckingExisting] = useState(false);

  // Get the display name for an episode (prefer translation over original name)
  const getEpisodeDisplayName = (episode: TVDBEpisode): string => {
    // For Italian language, prefer Italian > English > original
    if (language === "it") {
      return episode.nameItalian || episode.nameEnglish || episode.name;
    }
    // For German language, prefer German > English > original
    if (language === "de") {
      return episode.nameGerman || episode.nameEnglish || episode.name;
    }
    // For English, prefer English translation if original is non-Latin
    return episode.nameEnglish || episode.name;
  };

  // Toggle season collapse
  const toggleSeasonCollapse = (season: number) => {
    setCollapsedSeasons(prev => {
      const newSet = new Set(prev);
      if (newSet.has(season)) {
        newSet.delete(season);
      } else {
        newSet.add(season);
      }
      return newSet;
    });
  };

  // Scan files when dialog opens
  useEffect(() => {
    const hasPath = filePaths?.length ? filePaths.length > 0 : !!filePath;
    if (open && hasPath) {
      scanFiles();
    }
  }, [open, filePath, filePaths]);

  // Auto-search when search query changes (not year - year requires manual search)
  useEffect(() => {
    if (searchQuery.trim() && !isScanning) {
      const timer = setTimeout(() => {
        performSearch(searchQuery, null, searchYear);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [searchQuery, isScanning]);

  // Fetch episodes when series is selected, or create movie mapping
  useEffect(() => {
    if (selectedResult?.type === "series") {
      fetchEpisodes(selectedResult.id, episodeOrder);
    } else if (selectedResult?.type === "movie") {
      // For movies, create simple mapping (just rename, no folder structure)
      createMovieMapping();
    } else {
      setEpisodes([]);
      setFileMappings([]);
    }
    // Reset base folder selection when result changes
    setSelectedBaseFolder("");
  }, [selectedResult, episodeOrder]);

  // Map files to episodes when episodes are loaded
  useEffect(() => {
    if (episodes.length > 0 && scannedFiles.length > 0 && selectedResult) {
      createFileMappings();
    }
  }, [episodes, scannedFiles, selectedResult]);

  // Track the previous base folder to detect changes
  const prevBaseFolderRef = useRef<string>(selectedBaseFolder);

  // Regenerate mappings when template changes (full regeneration needed)
  const seriesTemplateJson = JSON.stringify(seriesNamingTemplate);
  const movieTemplateJson = JSON.stringify(movieNamingTemplate);

  useEffect(() => {
    if (selectedResult?.type === "series" && episodes.length > 0) {
      createFileMappings();
    } else if (selectedResult?.type === "movie" && scannedFiles.length > 0) {
      createMovieMapping();
    }
  }, [seriesTemplateJson, movieTemplateJson]);

  // Update paths when only base folder changes (preserve episode assignments)
  useEffect(() => {
    // Skip if base folder didn't actually change
    if (prevBaseFolderRef.current === selectedBaseFolder) return;
    prevBaseFolderRef.current = selectedBaseFolder;

    // Only update paths if we have existing mappings (don't regenerate from scratch)
    if (fileMappings.length === 0) return;

    // Update the base folder prefix in all existing paths
    setFileMappings(prev => prev.map(mapping => {
      if (!mapping.newPath || mapping.error || operation === "rename") {
        return mapping;
      }

      // Extract the relative path (remove any existing base folder prefix)
      // Find where the series/movie folder starts (after base folder)
      const currentPath = mapping.newPath;

      // Identify the content path by finding the first segment that matches series/movie structure
      // For series: "SeriesName (Year)/Season XX/file.mkv" or just "SeriesName/..."
      // For movies: "MovieName (Year)/file.mkv" or just "file.mkv"

      // Find the base folders to strip
      const allBaseFolders = [...seriesBaseFolders, ...moviesBaseFolders].map(f => f.name);
      let relativePath = currentPath;

      // Check if path starts with any known base folder and strip it
      for (const baseFolder of allBaseFolders) {
        if (currentPath.startsWith(baseFolder + "/")) {
          relativePath = currentPath.substring(baseFolder.length + 1);
          break;
        }
      }

      // Apply new base folder
      const basePath = selectedBaseFolder ? `${selectedBaseFolder}/` : "";
      const newPath = `${basePath}${relativePath}`;

      return {
        ...mapping,
        newPath,
      };
    }));
  }, [selectedBaseFolder, operation, seriesBaseFolders, moviesBaseFolders]);

  // Check for existing files when mappings change and update each mapping's existsAtDestination flag
  useEffect(() => {
    const checkExistingFiles = async () => {
      const validMappings = fileMappings.filter(m => m.newPath && !m.error && !m.skipped);
      if (validMappings.length === 0) {
        return;
      }

      setIsCheckingExisting(true);
      try {
        const response = await fetch("/api/files/check-destinations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: validMappings.map(m => ({
              sourcePath: m.file.path,
              destinationPath: m.newPath,
            })),
          }),
        });

        const data = await response.json();
        if (data.success) {
          const existingDestPaths = new Set(
            data.existingFiles.map((f: { destinationPath: string }) => f.destinationPath)
          );

          // Update mappings with existsAtDestination flag
          setFileMappings(prev => prev.map(m => {
            if (m.newPath && !m.error && !m.skipped) {
              const exists = existingDestPaths.has(m.newPath);
              // Only update if changed to avoid infinite loop
              if (m.existsAtDestination !== exists) {
                return { ...m, existsAtDestination: exists, overwrite: exists ? m.overwrite : undefined };
              }
            }
            return m;
          }));
        }
      } catch {
        // Ignore errors in pre-check
      } finally {
        setIsCheckingExisting(false);
      }
    };

    // Only run if we haven't already checked these mappings
    const needsCheck = fileMappings.some(m => m.newPath && !m.error && !m.skipped && m.existsAtDestination === undefined);
    if (needsCheck) {
      checkExistingFiles();
    }
  }, [fileMappings]);

  const scanFiles = async () => {
    setIsScanning(true);
    setScanError(null);
    setScannedFiles([]);
    setSearchQuery("");
    setSearchYear("");
    setSearchResults([]);
    setSelectedResult(null);
    setEpisodes([]);
    setFileMappings([]);
    setEditingFileIndex(null);
    setEditingSeason(null);
    setEditingEpisode(null);
    setMediaTypeFilter(null);

    try {
      // Use multiple paths if provided, otherwise fall back to single path
      const pathsToScan = filePaths?.length ? filePaths : [filePath];

      const response = await fetch("/api/files/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePaths: pathsToScan, pane }),
      });

      const data = await response.json();

      if (data.success && data.data) {
        setScannedFiles(data.data.files);
        setSearchQuery(data.data.suggestedShowName);
        // Extract year from the first file's parsed data
        if (data.data.files.length > 0 && data.data.files[0].parsed?.year) {
          setSearchYear(String(data.data.files[0].parsed.year));
        }
      } else {
        setScanError(data.error || "Failed to scan files");
      }
    } catch {
      setScanError("Failed to scan files");
    } finally {
      setIsScanning(false);
    }
  };

  const performSearch = async (query: string, typeFilter?: "series" | "movie" | null, year?: string) => {
    setIsSearching(true);
    setSearchError(null);
    setSelectedResult(null);
    setEpisodes([]);
    setFileMappings([]);
    setEditingFileIndex(null);
    setEditingSeason(null);
    setEditingEpisode(null);

    try {
      // Use passed typeFilter or fall back to state
      const searchType = typeFilter !== undefined ? typeFilter : mediaTypeFilter;
      // Use the active provider's search endpoint
      const searchEndpoint = activeProvider === "tmdb" ? "/api/tmdb/search" : "/api/tvdb/search";
      // Build request body - include year for both providers
      const requestBody: { query: string; lang: string; type: typeof searchType; year?: string } = {
        query,
        lang: language,
        type: searchType,
      };
      if (year) {
        requestBody.year = year;
      }
      const response = await fetch(searchEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data: TVDBApiResponse<TVDBSearchResult[]> = await response.json();

      if (data.success && data.data) {
        setSearchResults(data.data);

        // Try to auto-select a matching result based on the first scanned file
        if (scannedFiles.length > 0 && data.data.length > 0) {
          const autoMatch = findAutoMatch(data.data, scannedFiles[0].parsed);
          if (autoMatch) {
            setSelectedResult(autoMatch);
          }
        }
      } else {
        // Check for API key missing error
        if (data.error?.startsWith("API_KEY_MISSING:")) {
          const provider = data.error.split(":")[1];
          showErrorToast(`${provider} API key missing`, "Please add it to your .env file.");
        }
        setSearchError(data.error || "Search failed");
        setSearchResults([]);
      }
    } catch {
      setSearchError("Failed to search");
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const fetchEpisodes = async (seriesId: string, order: EpisodeOrder = "default") => {
    setIsLoadingEpisodes(true);

    try {
      // Fetch episodes, with Italian translations only if language is Italian
      const langParam = language === "it" ? "&lang=it" : language === "de" ? "&lang=de" : "";
      // Use the active provider's episodes endpoint
      const episodesEndpoint = activeProvider === "tmdb" ? "/api/tmdb/episodes" : "/api/tvdb/episodes";
      // Add order parameter for TVDB
      const orderParam = activeProvider === "tvdb" ? `&order=${order}` : "";
      const response = await fetch(`${episodesEndpoint}?seriesId=${seriesId}${langParam}${orderParam}`);
      const data: TVDBApiResponse<TVDBEpisode[]> = await response.json();

      if (data.success && data.data) {
        setEpisodes(data.data);
      } else {
        setEpisodes([]);
      }
    } catch {
      setEpisodes([]);
    } finally {
      setIsLoadingEpisodes(false);
    }
  };

  const createMovieMapping = () => {
    if (!selectedResult || scannedFiles.length === 0) return;

    // For movies, just use the first file and rename it directly
    const file = scannedFiles[0];
    const movieName = getDisplayName(selectedResult, language);
    const year = selectedResult.year || "";
    const ext = file.parsed.extension || "mkv";

    // Get the effective naming template for this folder
    const template = getMovieNamingTemplate();

    // Get quality info if template uses quality/codec/extraTags tokens
    const needsQuality = templateUsesQuality(template);
    const qualityInfo = needsQuality ? getQualityInfo(file) : undefined;
    const { quality, codec, extraTags } = splitQualityInfo(qualityInfo, parseOptions);

    // Apply template to generate path
    const result = applyMovieTemplate(template, {
      movieName,
      year,
      quality,
      codec,
      extraTags,
      extension: ext,
    });

    let finalPath: string;
    if (operation === "rename") {
      // For rename operation, only use the filename (stay in same folder)
      finalPath = result.fileName;
    } else {
      // Prepend selected base folder if configured
      const basePath = selectedBaseFolder ? `${selectedBaseFolder}/` : "";
      finalPath = `${basePath}${result.fullPath}`;
    }

    setFileMappings([{
      file,
      episode: null,
      newPath: finalPath,
    }]);
  };

  const createFileMappings = () => {
    if (!selectedResult || episodes.length === 0) return;

    // Get series info
    const seriesName = getDisplayName(selectedResult, language);
    const seriesYear = selectedResult.year || "";

    // Get the effective naming template for this folder
    const template = getSeriesNamingTemplate();

    // Check if template uses quality/codec tokens
    const needsQuality = templateUsesQuality(template);

    // First pass: create initial mappings
    const initialMappings: FileMapping[] = scannedFiles.map(file => {
      const { season, episode: epNum } = file.parsed;

      if (season === undefined || epNum === undefined) {
        return {
          file,
          episode: null,
          newPath: "",
          error: "Could not detect season/episode from filename",
        };
      }

      // Find matching episode
      const matchedEpisode = episodes.find(
        ep => ep.seasonNumber === season && ep.number === epNum
      );

      if (!matchedEpisode) {
        return {
          file,
          episode: null,
          newPath: "",
          error: `Episode S${formatSeason(season)}E${formatSeason(epNum)} not found`,
        };
      }

      // Get episode title and quality info
      const episodeTitle = getEpisodeDisplayName(matchedEpisode);
      const qualityInfo = needsQuality ? getQualityInfo(file) : undefined;
      const { quality, codec, extraTags } = splitQualityInfo(qualityInfo, parseOptions);
      const ext = file.parsed.extension || "mkv";

      // Apply template to generate path
      const result = applySeriesTemplate(template, {
        seriesName,
        seriesYear,
        season,
        episode: epNum,
        episodeTitle,
        quality,
        codec,
        extraTags,
        extension: ext,
      });

      let newPath: string;
      if (operation === "rename") {
        // For rename operation, only use the filename (stay in same folder)
        newPath = result.fileName;
      } else {
        // Prepend selected base folder if configured
        const basePath = selectedBaseFolder ? `${selectedBaseFolder}/` : "";
        newPath = `${basePath}${result.fullPath}`;
      }

      return {
        file,
        episode: matchedEpisode,
        newPath,
      };
    });

    // Second pass: detect duplicates (files mapping to the same destination path)
    const pathCounts = new Map<string, number>();
    for (const m of initialMappings) {
      if (m.newPath && !m.error) {
        pathCounts.set(m.newPath, (pathCounts.get(m.newPath) || 0) + 1);
      }
    }

    // Mark ALL duplicates as errors (all files that share the same path need manual resolution)
    const mappings = initialMappings.map(m => {
      if (m.newPath && !m.error) {
        const count = pathCounts.get(m.newPath) || 0;
        if (count > 1) {
          // This file shares a path with others - mark as duplicate error
          return {
            ...m,
            error: `Duplicate: ${count} files map to S${formatSeason(m.episode?.seasonNumber ?? 0)}E${formatSeason(m.episode?.number ?? 0)}`,
          };
        }
      }
      return m;
    });

    setFileMappings(mappings);
  };

  // Get unique seasons from episodes
  const availableSeasons = [...new Set(episodes.map(ep => ep.seasonNumber))]
    .filter(s => s !== undefined && s >= 0)
    .sort((a, b) => a - b);

  // Get episodes for a specific season
  const getEpisodesForSeason = (season: number) => {
    return episodes
      .filter(ep => ep.seasonNumber === season)
      .sort((a, b) => a.number - b.number);
  };

  // Start editing a file mapping
  const startEditingFile = (fileIndex: number) => {
    const mapping = fileMappings[fileIndex];
    setEditingFileIndex(fileIndex);
    // Pre-select detected season/episode if available
    setEditingSeason(mapping.file.parsed.season ?? (availableSeasons[0] ?? null));
    setEditingEpisode(mapping.episode?.number ?? mapping.file.parsed.episode ?? null);
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingFileIndex(null);
    setEditingSeason(null);
    setEditingEpisode(null);
  };

  // Helper to recheck duplicates in mappings
  const recheckDuplicates = (mappings: FileMapping[]): FileMapping[] => {
    // First, clear all duplicate errors and count paths
    const cleanMappings = mappings.map(m => {
      const wasOnlyDuplicateError = m.error?.startsWith("Duplicate:");
      return wasOnlyDuplicateError ? { ...m, error: undefined } : m;
    });

    // Count paths (only for mappings without other errors)
    const pathCounts = new Map<string, number>();
    for (const m of cleanMappings) {
      if (m.newPath && !m.error) {
        pathCounts.set(m.newPath, (pathCounts.get(m.newPath) || 0) + 1);
      }
    }

    // Mark ALL duplicates as errors (all files that share the same path)
    return cleanMappings.map(m => {
      if (m.newPath && !m.error) {
        const count = pathCounts.get(m.newPath) || 0;
        if (count > 1) {
          return {
            ...m,
            error: `Duplicate: ${count} files map to S${formatSeason(m.episode?.seasonNumber ?? 0)}E${formatSeason(m.episode?.number ?? 0)}`,
          };
        }
      }
      return m;
    });
  };

  // Apply manual episode selection
  const applyManualSelection = () => {
    if (editingFileIndex === null || editingSeason === null || editingEpisode === null || !selectedResult) {
      return;
    }

    const file = fileMappings[editingFileIndex].file;
    const matchedEpisode = episodes.find(
      ep => ep.seasonNumber === editingSeason && ep.number === editingEpisode
    );

    if (!matchedEpisode) {
      return;
    }

    // Get series info
    const seriesName = getDisplayName(selectedResult, language);
    const seriesYear = selectedResult.year || "";
    const episodeTitle = getEpisodeDisplayName(matchedEpisode);

    // Get the effective naming template for this folder
    const template = getSeriesNamingTemplate();

    // Get quality info if template uses quality/codec/extraTags tokens
    const needsQuality = templateUsesQuality(template);
    const qualityInfo = needsQuality ? getQualityInfo(file) : undefined;
    const { quality, codec, extraTags } = splitQualityInfo(qualityInfo, parseOptions);
    const ext = file.parsed.extension || "mkv";

    // Apply template to generate path
    const result = applySeriesTemplate(template, {
      seriesName,
      seriesYear,
      season: editingSeason,
      episode: editingEpisode,
      episodeTitle,
      quality,
      codec,
      extraTags,
      extension: ext,
    });

    let newPath: string;
    if (operation === "rename") {
      // For rename operation, only use the filename (stay in same folder)
      newPath = result.fileName;
    } else {
      // Prepend selected base folder if configured
      const basePath = selectedBaseFolder ? `${selectedBaseFolder}/` : "";
      newPath = `${basePath}${result.fullPath}`;
    }

    // Update the mapping and recheck duplicates
    setFileMappings(prev => {
      const updated = [...prev];
      updated[editingFileIndex] = {
        file,
        episode: matchedEpisode,
        newPath,
        error: undefined,
      };
      // Recheck all mappings for duplicates
      return recheckDuplicates(updated);
    });

    cancelEditing();
  };

  // Skip a file (mark as skipped, keep in manual selection)
  const skipFile = (fileIndex: number) => {
    setFileMappings(prev => {
      const updated = [...prev];
      updated[fileIndex] = {
        ...updated[fileIndex],
        skipped: true,
        error: "Skipped",
      };
      return updated;
    });
    // If we were editing this file, cancel editing
    if (editingFileIndex === fileIndex) {
      cancelEditing();
    }
  };

  // Unskip a file (remove skipped status, recheck for duplicates)
  const unskipFile = (fileIndex: number) => {
    setFileMappings(prev => {
      const updated = [...prev];
      updated[fileIndex] = {
        ...updated[fileIndex],
        skipped: false,
        error: undefined,
      };
      // Recheck duplicates after unskipping
      return recheckDuplicates(updated);
    });
  };

  // Toggle overwrite flag for a file that exists at destination
  const toggleOverwrite = (fileIndex: number, overwrite: boolean) => {
    setFileMappings(prev => {
      const updated = [...prev];
      updated[fileIndex] = {
        ...updated[fileIndex],
        overwrite,
      };
      return updated;
    });
  };

  const handleConfirm = useCallback(async () => {
    if (fileMappings.length === 0) return;

    setIsProcessing(true);
    setProgress(null);
    setScanError(null);

    try {
      // Prepare file operations (exclude skipped files and files that exist but weren't marked for overwrite)
      const files = fileMappings
        .filter(m => m.newPath && !m.error && !m.skipped)
        .filter(m => !m.existsAtDestination || m.overwrite) // Include if doesn't exist OR user confirmed overwrite
        .map(m => ({
          sourcePath: m.file.path,
          destinationPath: m.newPath,
          overwrite: m.overwrite || false,
        }));

      if (files.length === 0) {
        return;
      }

      // Build folder rename/create info if enabled
      let folderRenames: { oldPath: string; newName: string }[] | undefined;
      let folderCreates: { filePath: string; newFileName: string; folderName: string; subfolderName?: string }[] | undefined;
      let seasonFolderCreates: { filePath: string; newFileName: string; seasonFolder: string }[] | undefined;

      if ((renameSeasonFolders || renameMainFolder || createSeasonFolders || createMainFolder) && selectedResult?.type === "series") {
        const seriesName = getDisplayName(selectedResult, language);
        const seriesYear = selectedResult.year || "";
        const template = getSeriesNamingTemplate();

        // Get quality/codec info from first file for folder template
        const firstFile = scannedFiles[0];
        const qualityInfo = firstFile ? getQualityInfo(firstFile) : undefined;
        const { quality, codec, extraTags } = splitQualityInfo(qualityInfo, parseOptions);

        // Collect unique folder paths from files and compute new names
        const folderMap = new Map<string, string>(); // oldPath -> newName (for renames)
        const seasonCreates: { filePath: string; newFileName: string; seasonFolder: string }[] = [];
        const mainFolderCreates: { filePath: string; newFileName: string; folderName: string; subfolderName?: string }[] = [];

        // Build a map of original file path to new filename from the files array
        const fileRenameMap = new Map<string, string>();
        for (const f of files) {
          fileRenameMap.set(f.sourcePath, f.destinationPath);
        }

        for (const m of fileMappings) {
          if (m.skipped || m.error) continue;

          // Get the full path from the file (this is relative to source base, e.g., /Percy Jackson/Season 02/file.mkv)
          const fullFilePath = m.file.path.replace(/\\/g, "/");
          const fullDirParts = fullFilePath.split("/").filter(p => p.length > 0);
          fullDirParts.pop(); // Remove filename

          const season = m.episode?.seasonNumber;

          // Check if the user selected individual files (not a folder)
          // When a file is selected directly, relativePath equals the filename (no folder components)
          const userSelectedFile = m.file.relativePath === m.file.name;

          // Determine folder structure based on what user selected
          const hasFolderStructure = fullDirParts.length > 0;
          const hasOnlyOneFolder = fullDirParts.length === 1;

          console.log("[FRONTEND] Processing file:", m.file.path);
          console.log("[FRONTEND] m.file.relativePath:", m.file.relativePath);
          console.log("[FRONTEND] m.file.name:", m.file.name);
          console.log("[FRONTEND] fullDirParts:", fullDirParts);
          console.log("[FRONTEND] userSelectedFile:", userSelectedFile);
          console.log("[FRONTEND] hasFolderStructure:", hasFolderStructure);
          console.log("[FRONTEND] hasOnlyOneFolder:", hasOnlyOneFolder);
          console.log("[FRONTEND] createMainFolder:", createMainFolder);
          console.log("[FRONTEND] renameMainFolder:", renameMainFolder);
          console.log("[FRONTEND] createSeasonFolders:", createSeasonFolders);
          console.log("[FRONTEND] renameSeasonFolders:", renameSeasonFolders);

          // Get expected folder names
          const mainResult = applySeriesTemplate(template, {
            seriesName,
            seriesYear,
            season: season || 1,
            episode: 1,
            episodeTitle: "",
            quality,
            codec,
            extraTags,
            extension: "mkv",
          });
          const expectedSeriesFolder = mainResult.seriesFolder;
          const expectedSeasonFolder = season !== undefined ? mainResult.seasonFolder : undefined;
          const newFileName = fileRenameMap.get(m.file.path)?.split("/").pop() || m.newPath.split("/").pop() || "";

          // Handle CREATE main folder - ALWAYS create if checked, regardless of existing structure
          if (createMainFolder) {
            console.log("[FRONTEND] → Taking CREATE MAIN FOLDER branch");
            // CREATE: Build new folder structure
            if (createSeasonFolders && expectedSeasonFolder) {
              console.log("[FRONTEND] → Creating main + season folder");
              // Create main + season folder
              mainFolderCreates.push({
                filePath: m.file.path,
                newFileName,
                folderName: expectedSeriesFolder,
                subfolderName: expectedSeasonFolder,
              });
            } else {
              console.log("[FRONTEND] → Creating just main folder");
              // Create just main folder
              mainFolderCreates.push({
                filePath: m.file.path,
                newFileName,
                folderName: expectedSeriesFolder,
              });
            }
          }
          // Handle CREATE season folder (without main folder) - ALWAYS create if checked
          else if (createSeasonFolders && expectedSeasonFolder) {
            console.log("[FRONTEND] → Taking CREATE SEASON FOLDER ONLY branch");
            // CREATE season folder only
            seasonCreates.push({
              filePath: m.file.path,
              newFileName,
              seasonFolder: expectedSeasonFolder,
            });
          }
          // Handle RENAME operations (for existing folder structures)
          else if (hasFolderStructure && (renameMainFolder || renameSeasonFolders)) {
            console.log("[FRONTEND] → Taking RENAME/EXISTING FOLDER branch");
            // Handle season folder rename/create
            if ((renameSeasonFolders || createSeasonFolders) && season !== undefined && expectedSeasonFolder) {
              const result = applySeriesTemplate(template, {
                seriesName,
                seriesYear,
                season,
                episode: 1,
                episodeTitle: "",
                quality,
                codec,
                extraTags,
                extension: "mkv",
              });
              const expectedSeasonFolder = result.seasonFolder;

              if (fullDirParts.length > 0) {
                // Check if there's a season folder that needs renaming
                const seasonFolderName = fullDirParts[fullDirParts.length - 1];
                const seasonMatch = seasonFolderName.match(/Season\s*(\d{1,2})/i);

                if (seasonMatch && expectedSeasonFolder && expectedSeasonFolder !== seasonFolderName) {
                  // The folder has a season pattern but doesn't match expected
                  // Check if the folder's season matches the FILE's season
                  const folderSeasonNum = parseInt(seasonMatch[1], 10);

                  if (folderSeasonNum === season) {
                    // Folder season matches file season, just needs renaming (e.g., "Season 1" -> "Season 01")
                    const seasonFolderPath = fullDirParts.join("/");
                    if (!folderMap.has(seasonFolderPath)) {
                      folderMap.set(seasonFolderPath, expectedSeasonFolder);
                    }
                  } else {
                    // File is in WRONG season folder - need to create correct folder and move file
                    const newFileName = fileRenameMap.get(m.file.path) || m.file.name;
                    seasonCreates.push({
                      filePath: m.file.path,
                      newFileName,
                      seasonFolder: expectedSeasonFolder,
                    });
                  }
                } else if (!seasonMatch && expectedSeasonFolder) {
                  // No season folder exists - need to create one and move file into it
                  const newFileName = fileRenameMap.get(m.file.path) || m.file.name;
                  seasonCreates.push({
                    filePath: m.file.path,
                    newFileName,
                    seasonFolder: expectedSeasonFolder,
                  });
                }
              }
            }

            // Handle main folder rename
            if (renameMainFolder && fullDirParts.length > 0) {
              // Get the series folder template name
              const result = applySeriesTemplate(template, {
                seriesName,
                seriesYear,
                season: 1,
                episode: 1,
                episodeTitle: "",
                quality,
                codec,
                extraTags,
                extension: "mkv",
              });
              const expectedSeriesFolder = result.seriesFolder;

              // Determine the main folder from relativePath
              // relativePath is relative to what the user selected/navigated to
              // So the "main folder" (the folder user selected) is NOT in relativePath
              const relativePathParts = m.file.relativePath.replace(/\\/g, "/").split("/").filter(p => p.length > 0);
              relativePathParts.pop(); // Remove filename

              console.log("[FRONTEND] RENAME MAIN FOLDER:");
              console.log("[FRONTEND] - relativePathParts:", relativePathParts);
              console.log("[FRONTEND] - fullDirParts:", fullDirParts);
              console.log("[FRONTEND] - expectedSeriesFolder:", expectedSeriesFolder);

              // The main folder is the folder the user selected, which is:
              // fullDirParts minus the relativePathParts at the end
              // Example:
              //   fullDirParts = ["media", "anime Serie", "Season 01"]
              //   relativePathParts = ["Season 01"]  (relative to selected folder)
              //   mainFolder = "anime Serie" at index (3 - 1 - 1) = 1
              const mainFolderIndex = fullDirParts.length - relativePathParts.length - 1;

              console.log("[FRONTEND] - mainFolderIndex:", mainFolderIndex);

              if (mainFolderIndex >= 0 && mainFolderIndex < fullDirParts.length) {
                const mainFolderName = fullDirParts[mainFolderIndex];
                const mainFolderPath = fullDirParts.slice(0, mainFolderIndex + 1).join("/");

                console.log("[FRONTEND] - mainFolderName:", mainFolderName);
                console.log("[FRONTEND] - mainFolderPath:", mainFolderPath);

                if (mainFolderName && mainFolderName !== expectedSeriesFolder) {
                  // The main folder needs to be renamed
                  if (!folderMap.has(mainFolderPath)) {
                    folderMap.set(mainFolderPath, expectedSeriesFolder);
                    console.log("[FRONTEND] - Added to folderMap:", mainFolderPath, "->", expectedSeriesFolder);
                  }
                }
              } else {
                console.log("[FRONTEND] - Could not determine main folder (index out of range)");
              }
            }
          }
        }

        // Convert to array, sorted by depth (deepest first to avoid conflicts)
        folderRenames = Array.from(folderMap.entries())
          .map(([oldPath, newName]) => ({ oldPath, newName }))
          .sort((a, b) => b.oldPath.split("/").length - a.oldPath.split("/").length);

        // Set folder creates if any
        if (mainFolderCreates.length > 0) {
          folderCreates = mainFolderCreates;
        }

        // Set season folder creates if any
        if (seasonCreates.length > 0) {
          seasonFolderCreates = seasonCreates;
        }

        console.log("[FRONTEND] Final folderRenames:", folderRenames);
        console.log("[FRONTEND] Final folderCreates:", folderCreates);
        console.log("[FRONTEND] Final seasonFolderCreates:", seasonFolderCreates);
      }

      // Use streaming API for progress updates
      // Pass overwrite: true since we've already filtered to only include files that should be overwritten
      // Pass pane so the API knows which base path to use for rename operations
      const response = await fetch("/api/files/batch-rename-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, operation, overwrite: true, pane, folderRenames, folderCreates, seasonFolderCreates }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to start operation");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "progress" || data.type === "file_progress") {
                setProgress({
                  current: data.current,
                  total: data.total,
                  currentFile: data.currentFile || "",
                  completed: data.completed,
                  failed: data.failed,
                  bytesCopied: data.bytesCopied,
                  bytesTotal: data.bytesTotal,
                  bytesPerSecond: data.bytesPerSecond,
                });
              } else if (data.type === "complete") {
                if (data.completed > 0) {
                  const hasErrors = data.errors && data.errors.length > 0;
                  onConfirm(fileMappings[0].newPath, hasErrors);
                  // Show errors as toast since dialog is closing (e.g., folder rename errors)
                  if (hasErrors) {
                    showErrorToast(
                      data.message || "Some operations failed",
                      data.errors.join("\n")
                    );
                  }
                } else {
                  setScanError(data.errors?.join(", ") || "All files failed");
                }
              } else if (data.type === "error") {
                setScanError(data.message || "Operation failed");
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      setScanError("Failed to process files");
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  }, [fileMappings, operation, onConfirm, renameSeasonFolders, renameMainFolder, createSeasonFolders, createMainFolder, selectedResult, scannedFiles, language, getSeriesNamingTemplate, getQualityInfo, pane]);

  const isLoading = externalLoading || isProcessing;
  const validMappings = fileMappings.filter(m => m.newPath && !m.error && !m.skipped);
  const skippedMappings = fileMappings.filter(m => m.skipped);
  const errorMappings = fileMappings.filter(m => m.error && !m.skipped); // Errors excluding skipped
  // Files that exist but haven't been marked for overwrite
  const existingNotConfirmedMappings = fileMappings.filter(m => m.existsAtDestination && !m.overwrite && !m.skipped);
  // Files that will actually be processed (valid + either new or overwrite confirmed)
  const processableMappings = validMappings.filter(m => !m.existsAtDestination || m.overwrite);
  // Can only confirm if there are processable mappings, NO unresolved errors (skipped is OK), and we have a selection
  const canConfirm = processableMappings.length > 0 && errorMappings.length === 0 && selectedResult && !isLoading;

  // Group file mappings by season (using detected or matched season)
  const mappingsBySeason = fileMappings.reduce((acc, m, index) => {
    const season = m.episode?.seasonNumber ?? m.file.parsed.season ?? -1; // -1 for unknown
    if (!acc[season]) acc[season] = [];
    acc[season].push({ mapping: m, originalIndex: index });
    return acc;
  }, {} as Record<number, { mapping: FileMapping; originalIndex: number }[]>);

  // Get sorted season keys
  const sortedSeasons = Object.keys(mappingsBySeason)
    .map(Number)
    .sort((a, b) => a - b);

  // Calculate missing episodes per season
  const missingEpisodesBySeason = useMemo(() => {
    if (!selectedResult || selectedResult.type !== "series" || episodes.length === 0) {
      return {};
    }

    const result: Record<number, TVDBEpisode[]> = {};

    // Get all seasons that have episodes in TVDB
    const allSeasons = [...new Set(episodes.map(ep => ep.seasonNumber))].sort((a, b) => a - b);

    for (const season of allSeasons) {
      // Get all episodes for this season from TVDB
      const seasonEpisodes = episodes.filter(ep => ep.seasonNumber === season);

      // Get episode numbers that we have files for (successfully matched, not skipped)
      const mappedEpisodeNumbers = new Set(
        fileMappings
          .filter(m => m.episode?.seasonNumber === season && !m.skipped && !m.error)
          .map(m => m.episode!.number)
      );

      // Find missing episodes
      const missing = seasonEpisodes.filter(ep => !mappedEpisodeNumbers.has(ep.number));

      if (missing.length > 0) {
        result[season] = missing.sort((a, b) => a.number - b.number);
      }
    }

    return result;
  }, [selectedResult, episodes, fileMappings]);

  // Total missing episodes count
  const totalMissingEpisodes = Object.values(missingEpisodesBySeason).reduce(
    (sum, eps) => sum + eps.length,
    0
  );

  // State for showing/hiding missing episodes section
  const [showMissingEpisodes, setShowMissingEpisodes] = useState(false);

  // Check if we have files to show (for series with episodes loaded)
  const hasFilesToShow = fileMappings.length > 0 && selectedResult?.type === "series" && episodes.length > 0;
  // Always use wider dialog when showing file list, and taller on desktop
  const dialogWidth = hasFilesToShow && !isMobile ? "sm:max-w-5xl" : "sm:max-w-2xl";
  const dialogHeight = hasFilesToShow && !isMobile ? "sm:h-[85dvh]" : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogWidth} ${dialogHeight} max-h-[90dvh] flex flex-col p-4 sm:p-6`}>
        <DialogHeader className="shrink-0">
          <DialogTitle>{t.identify.title}</DialogTitle>
          <DialogDescription className="text-sm">
            {isScanning
              ? t.identify.scanningFiles
              : scannedFiles.length > 0
                ? interpolate(t.identify.foundFiles, { count: scannedFiles.length })
                : interpolate(t.identify.searchProvider, { provider: activeProvider.toUpperCase() })
            }
          </DialogDescription>
        </DialogHeader>

        {/* Mobile progress bar - shown at top, outside scrollable area */}
        {isMobile && progress && (
          <div className="shrink-0 space-y-2 py-2 border-b bg-background">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-muted-foreground">
                  {operation === "copy" ? t.identify.copyingFiles : operation === "move" ? t.identify.movingFiles : t.identify.renamingFiles}
                </span>
              </div>
              <span className="font-medium">
                {progress.current} / {progress.total}
              </span>
            </div>
            <Progress value={(progress.current / progress.total) * 100} className="h-1.5" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate max-w-[50%]">{progress.currentFile}</span>
              {progress.bytesPerSecond !== undefined && progress.bytesPerSecond > 0 && (
                <span className="shrink-0">{formatBytes(progress.bytesPerSecond)}/s</span>
              )}
            </div>
            {/* Byte progress (compact) */}
            {progress.bytesTotal !== undefined && progress.bytesTotal > 0 && (
              <div className="flex items-center gap-2">
                <Progress
                  value={(progress.bytesCopied ?? 0) / progress.bytesTotal * 100}
                  className="h-1 flex-1"
                />
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {Math.round((progress.bytesCopied ?? 0) / progress.bytesTotal * 100)}%
                </span>
              </div>
            )}
            {progress.failed > 0 && (
              <p className="text-xs text-destructive">
                {progress.failed} {t.common.failed}
              </p>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 py-2 sm:flex sm:flex-col">
          {/* Scanning state */}
          {isScanning && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}

          {/* Scan error */}
          {scanError && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {scanError}
            </div>
          )}

          {/* Search input */}
          {!isScanning && scannedFiles.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  {t.common.search} {activeProvider.toUpperCase()}
                </label>
                <div className="flex items-center gap-2">
                  {/* Episode order selector - only for TVDB series */}
                  {activeProvider === "tvdb" && (scannedFiles.length > 1 || mediaTypeFilter === "series") && (
                    <Select
                      value={episodeOrder}
                      onValueChange={(value) => setEpisodeOrder(value as EpisodeOrder)}
                    >
                      <SelectTrigger className="h-6 text-xs w-auto min-w-25">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">
                          <div className="flex flex-col items-start">
                            <span>{t.identify.orderAired}</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="official">
                          <div className="flex flex-col items-start">
                            <span>{t.identify.orderDVD}</span>
                          </div>
                        </SelectItem>
                        <SelectItem value="absolute">
                          <div className="flex flex-col items-start">
                            <span>{t.identify.orderAbsolute}</span>
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <div className="flex rounded-md border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        if (activeProvider !== "tvdb") {
                          setActiveProvider("tvdb");
                          setProviderManuallyChanged(true);
                        }
                      }}
                      className={`px-2 py-0.5 text-xs font-medium transition-colors ${
                        activeProvider === "tvdb"
                          ? "bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted"
                      }`}
                    >
                      TVDB
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (activeProvider !== "tmdb") {
                          setActiveProvider("tmdb");
                          setProviderManuallyChanged(true);
                        }
                      }}
                      className={`px-2 py-0.5 text-xs font-medium transition-colors ${
                        activeProvider === "tmdb"
                          ? "bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted"
                      }`}
                    >
                      TMDB
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={scannedFiles.length > 1
                    ? t.identify.searchSeries
                    : t.identify.searchSeriesOrMovie}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && searchQuery.trim()) {
                      // For multiple files, filter to series only
                      performSearch(searchQuery, scannedFiles.length > 1 ? "series" : null, searchYear);
                    }
                  }}
                />
                <Input
                  value={searchYear}
                  onChange={(e) => {
                    // Only allow digits, max 4 chars
                    const value = e.target.value.replace(/\D/g, "").slice(0, 4);
                    setSearchYear(value);
                  }}
                  placeholder={t.common.year}
                  className="w-20"
                  maxLength={4}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && searchQuery.trim()) {
                      performSearch(searchQuery, scannedFiles.length > 1 ? "series" : null, searchYear);
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => performSearch(searchQuery, scannedFiles.length > 1 ? "series" : null, searchYear)}
                  disabled={!searchQuery.trim() || isSearching}
                  title="Search"
                >
                  {isSearching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Search results */}
          {!isScanning && searchQuery && (
            <div className="space-y-1">
              <label className="text-sm font-medium">{t.common.results}</label>
              <div className="border rounded-md max-h-32 overflow-y-auto">
                {isSearching ? (
                  <div className="p-4 flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">{interpolate(t.identify.searchingProvider, { provider: activeProvider.toUpperCase() })}</span>
                  </div>
                ) : searchError ? (
                  <div className="p-3 text-sm text-destructive">{searchError}</div>
                ) : searchResults.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">
                    {t.common.noResultsFound}
                  </div>
                ) : (
                  <div className="divide-y">
                    {searchResults.slice(0, 8).map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => setSelectedResult(result)}
                        className={`w-full text-left p-2 hover:bg-accent transition-colors ${
                          selectedResult?.id === result.id ? "bg-accent" : ""
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {/* Poster thumbnail */}
                          <div className="relative w-10 h-14 rounded overflow-hidden bg-muted shrink-0">
                            {result.image_url ? (
                              <Image
                                src={result.image_url}
                                alt={result.name}
                                fill
                                className="object-cover"
                                sizes="40px"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <ImageIcon className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">
                              {result.name_translated || result.name}
                              {result.year && (
                                <span className="text-muted-foreground ml-1">
                                  ({result.year})
                                </span>
                              )}
                            </p>
                            {result.name_translated && result.name_translated !== result.name && (
                              <p className="text-xs text-muted-foreground truncate">
                                {result.name}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground capitalize">
                              {result.type}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Loading episodes */}
          {isLoadingEpisodes && (
            <div className="p-4 flex items-center justify-center gap-2 text-muted-foreground border rounded-md">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">{t.identify.loadingEpisodes}</span>
            </div>
          )}

          {/* Base folder selector - show when a result is selected (not for rename operation) */}
          {selectedResult && !isLoadingEpisodes && operation !== "rename" && (
            <div className="space-y-1">
              <label className="text-sm font-medium">
                {t.identify.destinationFolder}
              </label>
              <Select
                value={selectedBaseFolder}
                onValueChange={(value) => {
                  setSelectedBaseFolder(value === "__none__" ? "" : value);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t.identify.selectFolder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    {t.identify.mediaRoot}
                  </SelectItem>
                  {(selectedResult.type === "series" ? seriesBaseFolders : moviesBaseFolders).map((folder) => (
                    <SelectItem key={folder.name} value={folder.name}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedResult && (
                <p className="text-xs text-muted-foreground">
                  {t.identify.destination}{" "}
                  {selectedBaseFolder ? `${selectedBaseFolder}/` : ""}
                  {selectedResult.type === "series" ? (
                    <>
                      {(() => {
                        // Get quality/codec/extraTags from first scanned file if available
                        const firstFile = scannedFiles[0];
                        const qualityInfo = firstFile ? getQualityInfo(firstFile) : undefined;
                        const { quality, codec, extraTags } = splitQualityInfo(qualityInfo, parseOptions);
                        return applySeriesTemplate(getSeriesNamingTemplate(), {
                          seriesName: getDisplayName(selectedResult, language),
                          seriesYear: selectedResult.year || "",
                          season: 1,
                          episode: 1,
                          episodeTitle: "",
                          quality,
                          codec,
                          extraTags,
                          extension: "mkv",
                        }).seriesFolder;
                      })()}/...
                    </>
                  ) : (
                    <>
                      {(() => {
                        // Get quality/codec/extraTags from first scanned file if available
                        const firstFile = scannedFiles[0];
                        const qualityInfo = firstFile ? getQualityInfo(firstFile) : undefined;
                        const { quality, codec, extraTags } = splitQualityInfo(qualityInfo, parseOptions);
                        return applyMovieTemplate(getMovieNamingTemplate(), {
                          movieName: getDisplayName(selectedResult, language),
                          year: selectedResult.year || "",
                          quality,
                          codec,
                          extraTags,
                          extension: "mkv",
                        }).folder;
                      })()}
                    </>
                  )}
                </p>
              )}
            </div>
          )}

          {/* Rename options - FFprobe checkbox for all, folder options for series */}
          {operation === "rename" && scannedFiles.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="use-ffprobe"
                  checked={useFFprobe}
                  onCheckedChange={(checked) => setUseFFprobe(checked === true)}
                />
                <label
                  htmlFor="use-ffprobe"
                  className="text-sm cursor-pointer select-none"
                >
                  {t.identify.useFFprobeForQuality}
                </label>
              </div>
              {selectedResult?.type === "series" && (
                <>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="create-main-folder"
                      checked={createMainFolder}
                      onCheckedChange={(checked) => setCreateMainFolder(checked === true)}
                    />
                    <label
                      htmlFor="create-main-folder"
                      className="text-sm cursor-pointer select-none"
                    >
                      {t.identify.createMainFolder}
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="rename-main-folder"
                      checked={renameMainFolder}
                      onCheckedChange={(checked) => setRenameMainFolder(checked === true)}
                    />
                    <label
                      htmlFor="rename-main-folder"
                      className="text-sm cursor-pointer select-none"
                    >
                      {t.identify.renameMainFolder}
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="create-season-folders"
                      checked={createSeasonFolders}
                      onCheckedChange={(checked) => setCreateSeasonFolders(checked === true)}
                    />
                    <label
                      htmlFor="create-season-folders"
                      className="text-sm cursor-pointer select-none"
                    >
                      {t.identify.createSeasonFolders}
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="rename-season-folders"
                      checked={renameSeasonFolders}
                      onCheckedChange={(checked) => setRenameSeasonFolders(checked === true)}
                    />
                    <label
                      htmlFor="rename-season-folders"
                      className="text-sm cursor-pointer select-none"
                    >
                      {t.identify.renameSeasonFolders}
                    </label>
                  </div>
                </>
              )}
            </div>
          )}

          {/* File mappings - grouped by season with collapsible sections */}
          {hasFilesToShow && selectedResult && (
            <div className="space-y-2 sm:flex sm:flex-col sm:flex-1 sm:min-h-0">
              <label className="text-sm font-medium shrink-0">
                {t.identify.fileMappings} ({fileMappings.length} {t.common.files})
                {skippedMappings.length > 0 && (
                  <span className="text-muted-foreground font-normal"> · {skippedMappings.length} {t.common.skipped}</span>
                )}
                {errorMappings.length > 0 && (
                  <span className="text-amber-600 dark:text-amber-400 font-normal"> · {errorMappings.length} {t.identify.needAttention}</span>
                )}
              </label>
              <ScrollArea className="h-112 sm:flex-1 sm:min-h-0 border rounded-md">
                <div>
                  {sortedSeasons.map((season) => {
                    const seasonMappings = mappingsBySeason[season];
                    const isCollapsed = collapsedSeasons.has(season);
                    const seasonValidCount = seasonMappings.filter(({ mapping: m }) => m.newPath && !m.error && !m.skipped && (!m.existsAtDestination || m.overwrite)).length;
                    const seasonErrorCount = seasonMappings.filter(({ mapping: m }) => m.error && !m.skipped).length;
                    const seasonSkippedCount = seasonMappings.filter(({ mapping: m }) => m.skipped).length;
                    const seasonExistsCount = seasonMappings.filter(({ mapping: m }) => m.existsAtDestination && !m.overwrite && !m.skipped).length;
                    const seasonLabel = season === -1
                      ? t.naming.unknownSeason
                      : season === 0
                        ? t.naming.specials
                        : `${t.naming.season} ${season}`;

                    return (
                      <div key={season} className="border-b last:border-b-0">
                        {/* Season header - collapsible */}
                        <button
                          type="button"
                          onClick={() => toggleSeasonCollapse(season)}
                          className="w-full flex items-center gap-2 p-3 hover:bg-muted/50 transition-colors text-left cursor-pointer"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="font-medium text-sm">{seasonLabel}</span>
                          <span className="text-xs text-muted-foreground">
                            ({seasonMappings.length} file{seasonMappings.length !== 1 ? "s" : ""})
                          </span>
                          {seasonValidCount > 0 && (
                            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-0.5">
                              <Check className="h-3 w-3" /> {seasonValidCount}
                            </span>
                          )}
                          {seasonErrorCount > 0 && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                              <AlertCircle className="h-3 w-3" /> {seasonErrorCount}
                            </span>
                          )}
                          {seasonExistsCount > 0 && (
                            <span className="text-xs text-amber-500 dark:text-amber-300 flex items-center gap-0.5">
                              <AlertTriangle className="h-3 w-3" /> {seasonExistsCount}
                            </span>
                          )}
                          {seasonSkippedCount > 0 && (
                            <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                              <X className="h-3 w-3" /> {seasonSkippedCount}
                            </span>
                          )}
                        </button>

                        {/* Season files - collapsible content */}
                        {!isCollapsed && (
                          <div className="divide-y border-t bg-muted/20">
                            {seasonMappings.map(({ mapping: m, originalIndex: fileIndex }) => {
                              const isEditing = editingFileIndex === fileIndex;
                              const isSkipped = m.skipped;
                              const hasError = m.error && !m.skipped;
                              const isValid = m.newPath && !m.error && !m.skipped;
                              const episodesForSeason = editingSeason !== null ? getEpisodesForSeason(editingSeason) : [];

                              const existsAtDest = m.existsAtDestination && !m.skipped;
                              const overwriteConfirmed = m.overwrite;

                              return (
                                <div key={fileIndex} className={`p-3 pl-3 sm:pl-9 space-y-2 ${isSkipped ? "opacity-50 bg-muted/30" : hasError ? "bg-amber-500/5" : existsAtDest && !overwriteConfirmed ? "bg-amber-500/10" : ""}`}>
                                  {/* File info row */}
                                  <div className="flex items-start gap-2">
                                    {/* Status icon */}
                                    {isSkipped ? (
                                      <X className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                                    ) : hasError ? (
                                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                                    ) : existsAtDest && !overwriteConfirmed ? (
                                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                                    ) : (
                                      <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                                    )}

                                    {/* File details */}
                                    <div className="flex-1 min-w-0 overflow-hidden">
                                      {isMobile ? (
                                        // Mobile: click to expand/collapse full filename
                                        <button
                                          type="button"
                                          onClick={() => setExpandedFileName(expandedFileName === fileIndex ? null : fileIndex)}
                                          className={`text-sm font-medium text-left w-full ${isSkipped ? "line-through text-muted-foreground" : ""} ${expandedFileName === fileIndex ? "whitespace-normal break-all" : "truncate max-w-37.5"}`}
                                        >
                                          {m.file.name}
                                        </button>
                                      ) : (
                                        // Desktop: hover tooltip
                                        <Tooltip delayDuration={0}>
                                          <TooltipTrigger asChild>
                                            <p className={`text-sm font-medium truncate cursor-default ${isSkipped ? "line-through text-muted-foreground" : ""}`}>
                                              {m.file.name}
                                            </p>
                                          </TooltipTrigger>
                                          <TooltipContent side="top" className="max-w-75 break-all">
                                            {m.file.name}
                                          </TooltipContent>
                                        </Tooltip>
                                      )}
                                      {isSkipped ? (
                                        <p className="text-xs text-muted-foreground">{t.common.skipped}</p>
                                      ) : hasError ? (
                                        <p className="text-xs text-amber-600 dark:text-amber-400 truncate">{m.error}</p>
                                      ) : isValid && m.episode ? (
                                        <>
                                          {isMobile ? (
                                            <button
                                              type="button"
                                              onClick={() => setExpandedDestPath(expandedDestPath === fileIndex ? null : fileIndex)}
                                              className={`text-xs text-green-600 dark:text-green-400 text-left w-full ${expandedDestPath === fileIndex ? "whitespace-normal break-all" : "truncate"}`}
                                            >
                                              → {m.newPath.split("/").pop()}
                                            </button>
                                          ) : (
                                            <Tooltip delayDuration={0}>
                                              <TooltipTrigger asChild>
                                                <p className="text-xs text-green-600 dark:text-green-400 truncate cursor-default">
                                                  → {m.newPath.split("/").pop()}
                                                </p>
                                              </TooltipTrigger>
                                              <TooltipContent side="top" className="max-w-100 break-all">
                                                {m.newPath}
                                              </TooltipContent>
                                            </Tooltip>
                                          )}
                                          {existsAtDest && (
                                            <div className="flex items-center gap-2 mt-1">
                                              <span className="text-xs text-amber-600 dark:text-amber-400">
                                                {t.identify.fileAlreadyExists}
                                              </span>
                                              <label className="flex items-center gap-1.5 cursor-pointer">
                                                <Checkbox
                                                  checked={overwriteConfirmed || false}
                                                  onCheckedChange={(checked) => toggleOverwrite(fileIndex, checked === true)}
                                                  className="h-3.5 w-3.5"
                                                />
                                                <span className="text-xs text-muted-foreground">{t.common.overwrite}</span>
                                              </label>
                                            </div>
                                          )}
                                        </>
                                      ) : null}
                                    </div>

                                    {/* Action buttons */}
                                    {!isEditing && (
                                      <div className="flex gap-1 shrink-0">
                                        {isSkipped ? (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => unskipFile(fileIndex)}
                                          >
                                            {t.common.unskip}
                                          </Button>
                                        ) : (
                                          <>
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => startEditingFile(fileIndex)}
                                            >
                                              <Pencil className="h-3 w-3 sm:mr-1" />
                                              <span className="hidden sm:inline">{isValid ? t.common.change : t.common.select}</span>
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => skipFile(fileIndex)}
                                            >
                                              <X className="h-3 w-3 sm:mr-1" />
                                              <span className="hidden sm:inline">{t.common.skip}</span>
                                            </Button>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {/* Manual selection UI (expanded when editing) */}
                                  {isEditing && (
                                    <div className="space-y-3 pt-2 pl-6">
                                      {/* Season selector */}
                                      <div className="space-y-1">
                                        <label className="text-xs font-medium text-muted-foreground">{t.naming.season}</label>
                                        <Select
                                          value={editingSeason?.toString() ?? ""}
                                          onValueChange={(val) => {
                                            setEditingSeason(parseInt(val, 10));
                                            setEditingEpisode(null);
                                          }}
                                        >
                                          <SelectTrigger className="w-full h-10">
                                            <SelectValue placeholder={t.identify.selectSeason} />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {availableSeasons.map((s) => (
                                              <SelectItem key={s} value={s.toString()}>
                                                {s === 0 ? t.naming.specials : `${t.naming.season} ${s}`}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>

                                      {/* Episode selector */}
                                      {editingSeason !== null && (
                                        <div className="space-y-1">
                                          <label className="text-xs font-medium text-muted-foreground">{t.naming.episode}</label>
                                          <Select
                                            value={editingEpisode?.toString() ?? ""}
                                            onValueChange={(val) => setEditingEpisode(parseInt(val, 10))}
                                          >
                                            <SelectTrigger className="w-full h-10">
                                              <SelectValue placeholder={t.identify.selectEpisode} />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {episodesForSeason.map((ep) => {
                                                const epTitle = getEpisodeDisplayName(ep);
                                                return (
                                                  <SelectItem key={ep.id} value={ep.number.toString()}>
                                                    E{formatSeason(ep.number)} - {epTitle || `${t.naming.episode} ${ep.number}`}
                                                  </SelectItem>
                                                );
                                              })}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      )}

                                      {/* Action buttons */}
                                      <div className="flex gap-2">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={cancelEditing}
                                          className="flex-1"
                                        >
                                          <X className="h-3 w-3 mr-1" />
                                          {t.common.cancel}
                                        </Button>
                                        <Button
                                          size="sm"
                                          onClick={applyManualSelection}
                                          disabled={editingSeason === null || editingEpisode === null}
                                          className="flex-1"
                                        >
                                          <Check className="h-3 w-3 mr-1" />
                                          {t.common.apply}
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Missing episodes section */}
          {hasFilesToShow && totalMissingEpisodes > 0 && (
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setShowMissingEpisodes(!showMissingEpisodes)}
                className="flex items-center gap-2 text-xs sm:text-sm text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
              >
                {showMissingEpisodes ? (
                  <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4" />
                ) : (
                  <ChevronRight className="h-3 w-3 sm:h-4 sm:w-4" />
                )}
                <AlertTriangle className="h-3 w-3 sm:h-4 sm:w-4" />
                <span>
                  {interpolate(t.identify.missingEpisodes, { count: totalMissingEpisodes })}
                </span>
              </button>

              {showMissingEpisodes && (
                <div className="mt-2 border border-amber-500/30 rounded-md p-2 sm:p-3 bg-amber-500/5 max-h-32 sm:max-h-48 overflow-y-auto">
                  <div className="space-y-2">
                    {Object.entries(missingEpisodesBySeason)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([seasonNum, missingEps]) => {
                        const season = Number(seasonNum);
                        const seasonLabel = season === 0
                          ? t.naming.specials
                          : `${t.naming.season} ${season}`;

                        return (
                          <div key={season}>
                            <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1">
                              {seasonLabel} ({missingEps.length} {t.identify.missing})
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {missingEps.map((ep) => (
                                <Tooltip key={ep.id} delayDuration={0}>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] sm:text-xs bg-amber-500/20 text-amber-700 dark:text-amber-300 cursor-default">
                                      E{formatSeason(ep.number)}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-50">
                                    <p className="text-xs">
                                      S{formatSeason(season)}E{formatSeason(ep.number)} - {getEpisodeDisplayName(ep)}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Movie preview (simpler, no editing needed) */}
          {selectedResult?.type === "movie" && validMappings.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">{t.identify.renamedFile}</label>
              <div className="border rounded-md p-3">
                {isMobile ? (
                  <button
                    type="button"
                    onClick={() => setExpandedMoviePath(!expandedMoviePath)}
                    className={`flex items-start gap-2 text-sm font-mono text-left w-full ${expandedMoviePath ? "" : ""}`}
                  >
                    <File className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                    <span className={expandedMoviePath ? "whitespace-normal break-all" : "truncate"}>{validMappings[0]?.newPath}</span>
                  </button>
                ) : (
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 text-sm font-mono cursor-default">
                        <File className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="truncate">{validMappings[0]?.newPath}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-100 break-all">
                      {validMappings[0]?.newPath}
                    </TooltipContent>
                  </Tooltip>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {t.identify.willBePlacedIn}
                </p>
              </div>
            </div>
          )}

          {/* Errors that can't be fixed (no episodes loaded) */}
          {errorMappings.length > 0 && selectedResult?.type === "series" && episodes.length === 0 && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-destructive">
                {t.identify.couldNotMatch} ({errorMappings.length})
              </label>
              <div className="border border-destructive/30 rounded-md p-2 space-y-1 text-xs">
                {errorMappings.map((m, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <AlertCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">{m.file.name}</p>
                      <p className="text-muted-foreground">{m.error}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Progress bar during operation - desktop only (mobile has fixed progress at top) */}
          {!isMobile && progress && (
            <div className="space-y-2 py-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {operation === "copy" ? t.identify.copyingFiles : operation === "move" ? t.identify.movingFiles : t.identify.renamingFiles}
                </span>
                <span className="font-medium">
                  {progress.current} / {progress.total}
                </span>
              </div>
              <Progress value={(progress.current / progress.total) * 100} className="h-2" />
              <p className="text-xs text-muted-foreground truncate">
                {progress.currentFile}
              </p>
              {/* Byte-level progress for current file */}
              {progress.bytesTotal !== undefined && progress.bytesTotal > 0 && (
                <div className="space-y-1">
                  <Progress
                    value={(progress.bytesCopied ?? 0) / progress.bytesTotal * 100}
                    className="h-1.5"
                  />
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(progress.bytesCopied ?? 0)} / {formatBytes(progress.bytesTotal)}
                    {progress.bytesTotal > 0 && (
                      <span className="ml-2">
                        ({Math.round((progress.bytesCopied ?? 0) / progress.bytesTotal * 100)}%)
                      </span>
                    )}
                    {progress.bytesPerSecond !== undefined && progress.bytesPerSecond > 0 && (
                      <span className="ml-2">
                        • {formatBytes(progress.bytesPerSecond)}/s
                      </span>
                    )}
                  </p>
                </div>
              )}
              {progress.failed > 0 && (
                <p className="text-xs text-destructive">
                  {progress.failed} {t.common.failed}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="flex-1 sm:flex-none"
          >
            {t.common.cancel}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex-1 sm:flex-none"
          >
            {isLoading
              ? operation === "copy" ? t.identify.copyingFiles : operation === "move" ? t.identify.movingFiles : t.identify.renamingFiles
              : `${operation === "copy" ? t.common.copy : operation === "move" ? t.common.move : t.common.rename} ${processableMappings.length} ${t.common.files}${existingNotConfirmedMappings.length > 0 ? ` (${existingNotConfirmedMappings.length} ${t.common.skipped})` : ""}`
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
