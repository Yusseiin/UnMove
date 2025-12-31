"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
import type {
  TVDBSearchResult,
  TVDBEpisode,
  ParsedFileName,
  TVDBApiResponse,
} from "@/types/tvdb";
import type {
  Language,
  BaseFolder,
  SeriesNamingTemplate,
  MovieNamingTemplate,
} from "@/types/config";
import { getLocalizedStrings } from "@/types/config";

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
  operation: "copy" | "move";
  onConfirm: (newPath: string) => void;
  isLoading?: boolean;
  language?: Language;
  seriesBaseFolders?: BaseFolder[];
  moviesBaseFolders?: BaseFolder[];
  // Global naming templates (used when folder doesn't have override)
  seriesNamingTemplate?: SeriesNamingTemplate;
  movieNamingTemplate?: MovieNamingTemplate;
}

export function IdentifyDialog({
  open,
  onOpenChange,
  fileName,
  filePath,
  filePaths,
  operation,
  onConfirm,
  isLoading: externalLoading,
  language = "en",
  seriesBaseFolders = [],
  moviesBaseFolders = [],
  seriesNamingTemplate,
  movieNamingTemplate,
}: IdentifyDialogProps) {
  const isMobile = useIsMobile();
  // Get localized strings based on language
  const strings = getLocalizedStrings(language);
  // Scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [scannedFiles, setScannedFiles] = useState<ScannedFile[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
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

  // Get the alwaysUseFFprobe setting from the selected folder
  const getAlwaysUseFFprobe = useCallback(() => {
    if (!selectedBaseFolder || !selectedResult) return false;
    const folders = selectedResult.type === "series" ? seriesBaseFolders : moviesBaseFolders;
    const folder = folders.find(f => f.name === selectedBaseFolder);
    return folder?.alwaysUseFFprobe ?? false;
  }, [selectedBaseFolder, selectedResult, seriesBaseFolders, moviesBaseFolders]);

  // Helper to get the appropriate quality info based on settings
  // If alwaysUseFFprobe is enabled, always use mediaInfoQuality (ignoring filename)
  // Otherwise, prefer filename quality (more reliable for scene releases)
  const getQualityInfo = useCallback((file: ScannedFile) => {
    const alwaysFFprobe = getAlwaysUseFFprobe();
    if (alwaysFFprobe && file.mediaInfoQuality) {
      // Always use ffprobe result, ignore filename parsing
      return file.mediaInfoQuality;
    }
    // Default: prefer filename quality, fallback to ffprobe if filename has no quality info
    return file.parsed.qualityInfo || file.mediaInfoQuality;
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

  // Check if template uses quality/codec tokens
  const templateUsesQuality = useCallback((template: SeriesNamingTemplate | MovieNamingTemplate | undefined): boolean => {
    if (!template) return false;
    const fileTemplate = template.fileTemplate || "";
    const folderTemplate = template.folderTemplate || "";
    return fileTemplate.includes("{quality}") || fileTemplate.includes("{codec}") ||
           folderTemplate.includes("{quality}") || folderTemplate.includes("{codec}");
  }, []);

  // Existing files check state
  const [isCheckingExisting, setIsCheckingExisting] = useState(false);

  // Get the display name for an episode (prefer English translation over original name)
  const getEpisodeDisplayName = (episode: TVDBEpisode): string => {
    // For Italian language, prefer Italian > English > original
    if (language === "it") {
      return episode.nameItalian || episode.nameEnglish || episode.name;
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

  // Auto-search when we have scanned files
  useEffect(() => {
    if (searchQuery.trim() && !isScanning) {
      const timer = setTimeout(() => {
        performSearch(searchQuery);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [searchQuery, isScanning]);

  // Fetch episodes when series is selected, or create movie mapping
  useEffect(() => {
    if (selectedResult?.type === "series") {
      fetchEpisodes(selectedResult.id);
    } else if (selectedResult?.type === "movie") {
      // For movies, create simple mapping (just rename, no folder structure)
      createMovieMapping();
    } else {
      setEpisodes([]);
      setFileMappings([]);
    }
    // Reset base folder selection when result changes
    setSelectedBaseFolder("");
  }, [selectedResult]);

  // Map files to episodes when episodes are loaded
  useEffect(() => {
    if (episodes.length > 0 && scannedFiles.length > 0 && selectedResult) {
      createFileMappings();
    }
  }, [episodes, scannedFiles, selectedResult]);

  // Regenerate mappings when base folder or template changes
  const seriesTemplateJson = JSON.stringify(seriesNamingTemplate);
  const movieTemplateJson = JSON.stringify(movieNamingTemplate);

  useEffect(() => {
    if (selectedResult?.type === "series" && episodes.length > 0) {
      createFileMappings();
    } else if (selectedResult?.type === "movie" && scannedFiles.length > 0) {
      createMovieMapping();
    }
  }, [selectedBaseFolder, seriesTemplateJson, movieTemplateJson]);

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
    setSearchResults([]);
    setSelectedResult(null);
    setEpisodes([]);
    setFileMappings([]);
    setEditingFileIndex(null);
    setEditingSeason(null);
    setEditingEpisode(null);

    try {
      // Use multiple paths if provided, otherwise fall back to single path
      const pathsToScan = filePaths?.length ? filePaths : [filePath];

      const response = await fetch("/api/files/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePaths: pathsToScan }),
      });

      const data = await response.json();

      if (data.success && data.data) {
        setScannedFiles(data.data.files);
        setSearchQuery(data.data.suggestedShowName);
      } else {
        setScanError(data.error || "Failed to scan files");
      }
    } catch {
      setScanError("Failed to scan files");
    } finally {
      setIsScanning(false);
    }
  };

  const performSearch = async (query: string) => {
    setIsSearching(true);
    setSearchError(null);
    setSelectedResult(null);
    setEpisodes([]);
    setFileMappings([]);
    setEditingFileIndex(null);
    setEditingSeason(null);
    setEditingEpisode(null);

    try {
      const response = await fetch("/api/tvdb/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, lang: language }),
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

  const fetchEpisodes = async (seriesId: string) => {
    setIsLoadingEpisodes(true);

    try {
      // Fetch episodes, with Italian translations only if language is Italian
      const langParam = language === "it" ? "&lang=it" : "";
      const response = await fetch(`/api/tvdb/episodes?seriesId=${seriesId}${langParam}`);
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

    // Get quality info if template uses quality/codec tokens
    const needsQuality = templateUsesQuality(template);
    const qualityInfo = needsQuality ? getQualityInfo(file) : undefined;
    const { quality, codec } = splitQualityInfo(qualityInfo);

    // Apply template to generate path
    const result = applyMovieTemplate(template, {
      movieName,
      year,
      quality,
      codec,
      extension: ext,
    });

    // Prepend selected base folder if configured
    const basePath = selectedBaseFolder ? `${selectedBaseFolder}/` : "";
    const finalPath = `${basePath}${result.fullPath}`;

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
          error: `Episode S${formatSeason(season)}E${formatSeason(epNum)} not found in TVDB`,
        };
      }

      // Get episode title and quality info
      const episodeTitle = getEpisodeDisplayName(matchedEpisode);
      const qualityInfo = needsQuality ? getQualityInfo(file) : undefined;
      const { quality, codec } = splitQualityInfo(qualityInfo);
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
        extension: ext,
      });

      // Prepend selected base folder if configured
      const basePath = selectedBaseFolder ? `${selectedBaseFolder}/` : "";

      return {
        file,
        episode: matchedEpisode,
        newPath: `${basePath}${result.fullPath}`,
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

    // Get quality info if template uses quality/codec tokens
    const needsQuality = templateUsesQuality(template);
    const qualityInfo = needsQuality ? getQualityInfo(file) : undefined;
    const { quality, codec } = splitQualityInfo(qualityInfo);
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
      extension: ext,
    });

    // Prepend selected base folder if configured
    const basePath = selectedBaseFolder ? `${selectedBaseFolder}/` : "";

    // Update the mapping and recheck duplicates
    setFileMappings(prev => {
      const updated = [...prev];
      updated[editingFileIndex] = {
        file,
        episode: matchedEpisode,
        newPath: `${basePath}${result.fullPath}`,
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

      // Use streaming API for progress updates
      // Pass overwrite: true since we've already filtered to only include files that should be overwritten
      const response = await fetch("/api/files/batch-rename-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, operation, overwrite: true }),
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
                  onConfirm(fileMappings[0].newPath);
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
  }, [fileMappings, operation, onConfirm]);

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
          <DialogTitle>Identify Media</DialogTitle>
          <DialogDescription className="text-sm">
            {isScanning
              ? "Scanning files..."
              : scannedFiles.length > 0
                ? `Found ${scannedFiles.length} video file${scannedFiles.length !== 1 ? "s" : ""}`
                : "Search TVDB to identify and rename files"
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
                  {operation === "copy" ? (language === "it" ? "Copiando" : "Copying") : (language === "it" ? "Spostando" : "Moving")}...
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
                {progress.failed} {language === "it" ? "falliti" : "failed"}
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
              <label className="text-sm font-medium">Search TVDB</label>
              <div className="flex gap-2">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search for show or movie..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && searchQuery.trim()) {
                      performSearch(searchQuery);
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => performSearch(searchQuery)}
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
              <label className="text-sm font-medium">Results</label>
              <div className="border rounded-md max-h-32 overflow-y-auto">
                {isSearching ? (
                  <div className="p-4 flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">{language === "it" ? "Ricerca in corso..." : "Searching TVDB..."}</span>
                  </div>
                ) : searchError ? (
                  <div className="p-3 text-sm text-destructive">{searchError}</div>
                ) : searchResults.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">
                    No results found
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
              <span className="text-sm">{language === "it" ? "Caricamento episodi..." : "Loading episodes..."}</span>
            </div>
          )}

          {/* Base folder selector - show when a result is selected */}
          {selectedResult && !isLoadingEpisodes && (
            <div className="space-y-1">
              <label className="text-sm font-medium">
                {language === "it" ? "Cartella di destinazione" : "Destination Folder"}
              </label>
              <Select
                value={selectedBaseFolder}
                onValueChange={(value) => {
                  setSelectedBaseFolder(value === "__none__" ? "" : value);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={language === "it" ? "Seleziona cartella..." : "Select folder..."} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    {language === "it" ? "(Radice Media)" : "(Media Root)"}
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
                  {language === "it" ? "Destinazione:" : "Destination:"}{" "}
                  {selectedBaseFolder ? `${selectedBaseFolder}/` : ""}
                  {selectedResult.type === "series" ? (
                    <>
                      {(() => {
                        // Get quality/codec from first scanned file if available
                        const firstFile = scannedFiles[0];
                        const qualityInfo = firstFile ? getQualityInfo(firstFile) : undefined;
                        const { quality, codec } = splitQualityInfo(qualityInfo);
                        return applySeriesTemplate(getSeriesNamingTemplate(), {
                          seriesName: getDisplayName(selectedResult, language),
                          seriesYear: selectedResult.year || "",
                          season: 1,
                          episode: 1,
                          episodeTitle: "",
                          quality,
                          codec,
                          extension: "mkv",
                        }).seriesFolder;
                      })()}/...
                    </>
                  ) : (
                    <>
                      {(() => {
                        // Get quality/codec from first scanned file if available
                        const firstFile = scannedFiles[0];
                        const qualityInfo = firstFile ? getQualityInfo(firstFile) : undefined;
                        const { quality, codec } = splitQualityInfo(qualityInfo);
                        return applyMovieTemplate(getMovieNamingTemplate(), {
                          movieName: getDisplayName(selectedResult, language),
                          year: selectedResult.year || "",
                          quality,
                          codec,
                          extension: "mkv",
                        }).folder;
                      })()}
                    </>
                  )}
                </p>
              )}
            </div>
          )}

          {/* File mappings - grouped by season with collapsible sections */}
          {hasFilesToShow && selectedResult && (
            <div className="space-y-2 sm:flex sm:flex-col sm:flex-1 sm:min-h-0">
              <label className="text-sm font-medium shrink-0">
                File Mappings ({fileMappings.length} files)
                {skippedMappings.length > 0 && (
                  <span className="text-muted-foreground font-normal"> · {skippedMappings.length} skipped</span>
                )}
                {errorMappings.length > 0 && (
                  <span className="text-amber-600 dark:text-amber-400 font-normal"> · {errorMappings.length} need attention</span>
                )}
              </label>
              <ScrollArea className="h-72 sm:flex-1 sm:min-h-0 border rounded-md">
                <div>
                  {sortedSeasons.map((season) => {
                    const seasonMappings = mappingsBySeason[season];
                    const isCollapsed = collapsedSeasons.has(season);
                    const seasonValidCount = seasonMappings.filter(({ mapping: m }) => m.newPath && !m.error && !m.skipped && (!m.existsAtDestination || m.overwrite)).length;
                    const seasonErrorCount = seasonMappings.filter(({ mapping: m }) => m.error && !m.skipped).length;
                    const seasonSkippedCount = seasonMappings.filter(({ mapping: m }) => m.skipped).length;
                    const seasonExistsCount = seasonMappings.filter(({ mapping: m }) => m.existsAtDestination && !m.overwrite && !m.skipped).length;
                    const seasonLabel = season === -1
                      ? "Unknown Season"
                      : season === 0
                        ? strings.specials
                        : `${strings.season} ${season}`;

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
                                        <p className="text-xs text-muted-foreground">Skipped</p>
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
                                                File already exists
                                              </span>
                                              <label className="flex items-center gap-1.5 cursor-pointer">
                                                <Checkbox
                                                  checked={overwriteConfirmed || false}
                                                  onCheckedChange={(checked) => toggleOverwrite(fileIndex, checked === true)}
                                                  className="h-3.5 w-3.5"
                                                />
                                                <span className="text-xs text-muted-foreground">Overwrite</span>
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
                                            Unskip
                                          </Button>
                                        ) : (
                                          <>
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => startEditingFile(fileIndex)}
                                            >
                                              <Pencil className="h-3 w-3 sm:mr-1" />
                                              <span className="hidden sm:inline">{isValid ? "Change" : "Select"}</span>
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => skipFile(fileIndex)}
                                            >
                                              <X className="h-3 w-3 sm:mr-1" />
                                              <span className="hidden sm:inline">Skip</span>
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
                                        <label className="text-xs font-medium text-muted-foreground">Season</label>
                                        <Select
                                          value={editingSeason?.toString() ?? ""}
                                          onValueChange={(val) => {
                                            setEditingSeason(parseInt(val, 10));
                                            setEditingEpisode(null);
                                          }}
                                        >
                                          <SelectTrigger className="w-full h-10">
                                            <SelectValue placeholder="Select season..." />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {availableSeasons.map((s) => (
                                              <SelectItem key={s} value={s.toString()}>
                                                {s === 0 ? strings.specials : `${strings.season} ${s}`}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>

                                      {/* Episode selector */}
                                      {editingSeason !== null && (
                                        <div className="space-y-1">
                                          <label className="text-xs font-medium text-muted-foreground">Episode</label>
                                          <Select
                                            value={editingEpisode?.toString() ?? ""}
                                            onValueChange={(val) => setEditingEpisode(parseInt(val, 10))}
                                          >
                                            <SelectTrigger className="w-full h-10">
                                              <SelectValue placeholder="Select episode..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {episodesForSeason.map((ep) => {
                                                const epTitle = getEpisodeDisplayName(ep);
                                                return (
                                                  <SelectItem key={ep.id} value={ep.number.toString()}>
                                                    E{formatSeason(ep.number)} - {epTitle || `${strings.episode} ${ep.number}`}
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
                                          Cancel
                                        </Button>
                                        <Button
                                          size="sm"
                                          onClick={applyManualSelection}
                                          disabled={editingSeason === null || editingEpisode === null}
                                          className="flex-1"
                                        >
                                          <Check className="h-3 w-3 mr-1" />
                                          Apply
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
                  {language === "it"
                    ? `${totalMissingEpisodes} episodi mancanti`
                    : `${totalMissingEpisodes} missing episode${totalMissingEpisodes !== 1 ? "s" : ""}`}
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
                          ? strings.specials
                          : `${strings.season} ${season}`;

                        return (
                          <div key={season}>
                            <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1">
                              {seasonLabel} ({missingEps.length} {language === "it" ? "mancanti" : "missing"})
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
              <label className="text-sm font-medium">Renamed File</label>
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
                  Will be placed in the current Media folder
                </p>
              </div>
            </div>
          )}

          {/* Errors that can't be fixed (no episodes loaded) */}
          {errorMappings.length > 0 && selectedResult?.type === "series" && episodes.length === 0 && (
            <div className="space-y-1">
              <label className="text-sm font-medium text-destructive">
                Could not match ({errorMappings.length})
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
                  {operation === "copy" ? (language === "it" ? "Copiando" : "Copying") : (language === "it" ? "Spostando" : "Moving")} {language === "it" ? "file" : "files"}...
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
                  {progress.failed} {language === "it" ? "falliti" : "failed"}
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
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex-1 sm:flex-none"
          >
            {isLoading
              ? operation === "copy" ? "Copying..." : "Moving..."
              : `${operation === "copy" ? "Copy" : "Move"} ${processableMappings.length} file${processableMappings.length !== 1 ? "s" : ""}${existingNotConfirmedMappings.length > 0 ? ` (${existingNotConfirmedMappings.length} skipped)` : ""}`
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
