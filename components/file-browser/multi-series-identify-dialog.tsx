"use client";

import { useState, useEffect, useCallback } from "react";
import { showErrorToast } from "@/components/ui/toast";
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
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import {
  AlertCircle,
  Check,
  X,
  Search,
  Loader2,
  Image as ImageIcon,
  SkipForward,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
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
  applySeriesTemplate,
  splitQualityInfo,
} from "@/lib/filename-parser";
import {
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

// Normalize series name for grouping (lowercase, remove special chars)
function normalizeSeriesName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

interface ScannedFile {
  path: string;
  name: string;
  relativePath: string;
  parsed: ParsedFileName;
  mediaInfoQuality?: string;
}

// Each file within a group has its own episode mapping
interface FileEpisodeMapping {
  file: ScannedFile;
  selectedSeason: number | null;
  selectedEpisode: number | null;
  selectedEpisodeData: TVDBEpisode | null;
  newPath: string;
  error?: string;
}

// A group represents files from the same series
interface SeriesGroup {
  groupKey: string;
  displayName: string;
  files: FileEpisodeMapping[];
  searchQuery: string;
  searchResults: TVDBSearchResult[];
  selectedResult: TVDBSearchResult | null;
  isSearching: boolean;
  searchError: string | null;
  episodes: TVDBEpisode[];
  isLoadingEpisodes: boolean;
  status: "pending" | "accepted" | "skipped";
}

interface MultiSeriesIdentifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePaths: string[];
  pane?: "downloads" | "media";
  operation: "copy" | "move" | "rename";
  onConfirm: (newPath: string, hasErrors?: boolean) => void;
  isLoading?: boolean;
  language?: Language;
  seriesBaseFolders?: BaseFolder[];
  seriesNamingTemplate?: SeriesNamingTemplate;
  // Quality/codec/extraTag values from config
  qualityValues?: string[];
  codecValues?: string[];
  extraTagValues?: string[];
}

export function MultiSeriesIdentifyDialog({
  open,
  onOpenChange,
  filePaths,
  pane = "downloads",
  operation,
  onConfirm,
  isLoading: externalLoading,
  language = "en",
  seriesBaseFolders = [],
  seriesNamingTemplate,
  qualityValues,
  codecValues,
  extraTagValues,
}: MultiSeriesIdentifyDialogProps) {
  // Build parse options from config values
  const parseOptions = { qualityValues, codecValues, extraTagValues };
  const isMobile = useIsMobile();
  const strings = getLocalizedStrings(language);

  // Carousel API
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const [currentSlide, setCurrentSlide] = useState(0);

  // Scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Series groups state
  const [seriesGroups, setSeriesGroups] = useState<SeriesGroup[]>([]);

  // Selected base folder for series
  const [selectedBaseFolder, setSelectedBaseFolder] = useState<string>("");

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

  // View mode: "carousel" or "summary"
  const [viewMode, setViewMode] = useState<"carousel" | "summary">("carousel");

  // Expanded file list state
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  // FFprobe checkbox state for rename operations
  const [useFFprobe, setUseFFprobe] = useState(true);

  // Get the alwaysUseFFprobe setting - for rename use checkbox, for copy/move use folder setting
  const getAlwaysUseFFprobe = useCallback(() => {
    if (operation === "rename") {
      return useFFprobe;
    }
    // For copy/move, use folder setting
    if (!selectedBaseFolder) return false;
    const folder = seriesBaseFolders.find(f => f.name === selectedBaseFolder);
    return folder?.alwaysUseFFprobe ?? false;
  }, [operation, useFFprobe, selectedBaseFolder, seriesBaseFolders]);

  // Helper to get the appropriate quality info based on settings
  // Combines ffprobe data (resolution/codec) with filename data (extra tags like ITA, HDR)
  const getQualityInfo = useCallback((file: ScannedFile) => {
    const alwaysFFprobe = getAlwaysUseFFprobe();
    const filenameQuality = file.parsed.qualityInfo || "";
    const ffprobeQuality = file.mediaInfoQuality || "";

    if (alwaysFFprobe && ffprobeQuality) {
      // Use ffprobe for resolution/codec, but merge with filename extra tags
      if (filenameQuality) {
        return `${ffprobeQuality}.${filenameQuality}`;
      }
      return ffprobeQuality;
    }
    return filenameQuality || ffprobeQuality;
  }, [getAlwaysUseFFprobe]);

  // Get the effective series naming template
  const getSeriesNamingTemplate = useCallback((): SeriesNamingTemplate | undefined => {
    if (!selectedBaseFolder) return seriesNamingTemplate;
    const folder = seriesBaseFolders.find(f => f.name === selectedBaseFolder);
    return folder?.seriesNamingTemplate || seriesNamingTemplate;
  }, [selectedBaseFolder, seriesBaseFolders, seriesNamingTemplate]);

  // Check if template uses quality/codec/extraTags tokens
  const templateUsesQuality = useCallback((template: SeriesNamingTemplate | undefined): boolean => {
    if (!template) return false;
    const fileTemplate = template.fileTemplate || "";
    const folderTemplate = template.folderTemplate || "";
    return fileTemplate.includes("{quality}") || fileTemplate.includes("{codec}") || fileTemplate.includes("{extraTags}") ||
           folderTemplate.includes("{quality}") || folderTemplate.includes("{codec}") || folderTemplate.includes("{extraTags}");
  }, []);

  // Get episode display name
  const getEpisodeDisplayName = useCallback((episode: TVDBEpisode): string => {
    if (language === "it") {
      return episode.nameItalian || episode.nameEnglish || episode.name;
    }
    return episode.nameEnglish || episode.name;
  }, [language]);

  // Carousel slide change handler
  useEffect(() => {
    if (!carouselApi) return;

    const onSelect = () => {
      setCurrentSlide(carouselApi.selectedScrollSnap());
    };

    carouselApi.on("select", onSelect);
    onSelect();

    return () => {
      carouselApi.off("select", onSelect);
    };
  }, [carouselApi]);

  // Scan files when dialog opens
  useEffect(() => {
    if (open && filePaths.length > 0) {
      scanFiles();
    }
  }, [open, filePaths]);

  // Reset view mode when dialog opens
  useEffect(() => {
    if (open) {
      setViewMode("carousel");
      setCurrentSlide(0);
      setExpandedGroups(new Set());
    }
  }, [open]);

  const scanFiles = async () => {
    setIsScanning(true);
    setScanError(null);
    setSeriesGroups([]);
    setViewMode("carousel");

    try {
      const response = await fetch("/api/files/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePaths: filePaths, pane }),
      });

      const data = await response.json();

      if (data.success && data.data) {
        // Group files by normalized series name
        const groupMap = new Map<string, { displayName: string; files: ScannedFile[] }>();

        for (const file of data.data.files as ScannedFile[]) {
          const normalizedName = normalizeSeriesName(file.parsed.cleanName);
          const existing = groupMap.get(normalizedName);

          if (existing) {
            existing.files.push(file);
          } else {
            groupMap.set(normalizedName, {
              displayName: file.parsed.cleanName,
              files: [file],
            });
          }
        }

        // Convert to SeriesGroup array
        const groups: SeriesGroup[] = Array.from(groupMap.entries()).map(([key, value]) => ({
          groupKey: key,
          displayName: value.displayName,
          files: value.files.map(file => ({
            file,
            selectedSeason: file.parsed.season ?? null,
            selectedEpisode: file.parsed.episode ?? null,
            selectedEpisodeData: null,
            newPath: "",
          })),
          searchQuery: value.displayName,
          searchResults: [],
          selectedResult: null,
          isSearching: false,
          searchError: null,
          episodes: [],
          isLoadingEpisodes: false,
          status: "pending" as const,
        }));

        setSeriesGroups(groups);

        // Auto-search for each group
        groups.forEach((_, index) => {
          performSearch(index, groups[index].searchQuery);
        });
      } else {
        setScanError(data.error || "Failed to scan files");
      }
    } catch {
      setScanError("Failed to scan files");
    } finally {
      setIsScanning(false);
    }
  };

  const performSearch = async (groupIndex: number, query: string) => {
    if (!query.trim()) return;

    setSeriesGroups((prev) =>
      prev.map((g, i) =>
        i === groupIndex
          ? { ...g, isSearching: true, searchError: null }
          : g
      )
    );

    try {
      const response = await fetch("/api/tvdb/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, type: "series", lang: language }),
      });

      const data: TVDBApiResponse<TVDBSearchResult[]> = await response.json();

      if (data.success && data.data) {
        const results = data.data;

        setSeriesGroups((prev) => {
          const currentGroup = prev[groupIndex];
          const autoMatch = findAutoMatch(results, currentGroup.files[0].file.parsed);

          return prev.map((g, i) => {
            if (i !== groupIndex) return g;

            if (autoMatch) {
              fetchEpisodes(groupIndex, autoMatch);
              return {
                ...g,
                isSearching: false,
                searchResults: results,
                searchError: null,
                selectedResult: autoMatch,
              };
            }

            return {
              ...g,
              isSearching: false,
              searchResults: results,
              searchError: null,
            };
          });
        });
      } else {
        setSeriesGroups((prev) =>
          prev.map((g, i) =>
            i === groupIndex
              ? {
                  ...g,
                  isSearching: false,
                  searchResults: [],
                  searchError: data.error || "Search failed",
                }
              : g
          )
        );
      }
    } catch {
      setSeriesGroups((prev) =>
        prev.map((g, i) =>
          i === groupIndex
            ? { ...g, isSearching: false, searchError: "Failed to search" }
            : g
        )
      );
    }
  };

  const fetchEpisodes = async (groupIndex: number, series: TVDBSearchResult) => {
    setSeriesGroups((prev) =>
      prev.map((g, i) =>
        i === groupIndex ? { ...g, isLoadingEpisodes: true } : g
      )
    );

    try {
      const langParam = language === "it" ? "&lang=it" : "";
      const response = await fetch(`/api/tvdb/episodes?seriesId=${series.id}${langParam}`);
      const data: TVDBApiResponse<TVDBEpisode[]> = await response.json();

      if (data.success && data.data) {
        setSeriesGroups((prev) =>
          prev.map((g, i) => {
            if (i !== groupIndex) return g;

            const episodes = data.data!;

            const updatedFiles = g.files.map(fm => {
              const matchedEp = episodes.find(
                (ep) => ep.seasonNumber === fm.selectedSeason && ep.number === fm.selectedEpisode
              );

              let newPath = "";
              let error: string | undefined;

              if (matchedEp) {
                newPath = generatePath(fm.file, series, matchedEp);
              } else if (fm.selectedSeason !== null && fm.selectedEpisode !== null) {
                error = `S${formatSeason(fm.selectedSeason)}E${formatSeason(fm.selectedEpisode)} not found`;
              }

              return {
                ...fm,
                selectedEpisodeData: matchedEp || null,
                newPath,
                error,
              };
            });

            return {
              ...g,
              isLoadingEpisodes: false,
              episodes,
              files: updatedFiles,
            };
          })
        );
      } else {
        setSeriesGroups((prev) =>
          prev.map((g, i) =>
            i === groupIndex ? { ...g, isLoadingEpisodes: false, episodes: [] } : g
          )
        );
      }
    } catch {
      setSeriesGroups((prev) =>
        prev.map((g, i) =>
          i === groupIndex ? { ...g, isLoadingEpisodes: false, episodes: [] } : g
        )
      );
    }
  };

  const selectResult = (groupIndex: number, result: TVDBSearchResult) => {
    setSeriesGroups((prev) =>
      prev.map((g, i) => {
        if (i !== groupIndex) return g;
        return {
          ...g,
          selectedResult: result,
          episodes: [],
          files: g.files.map(fm => ({
            ...fm,
            selectedEpisodeData: null,
            newPath: "",
            error: undefined,
          })),
        };
      })
    );
    fetchEpisodes(groupIndex, result);
  };

  const selectFileEpisode = (groupIndex: number, fileIndex: number, season: number, episode: number) => {
    setSeriesGroups((prev) =>
      prev.map((g, i) => {
        if (i !== groupIndex) return g;

        const updatedFiles = g.files.map((fm, fi) => {
          if (fi !== fileIndex) return fm;

          const episodeData = g.episodes.find(
            (ep) => ep.seasonNumber === season && ep.number === episode
          );

          let newPath = "";
          let error: string | undefined;

          if (g.selectedResult && episodeData) {
            newPath = generatePath(fm.file, g.selectedResult, episodeData);
          } else if (!episodeData) {
            error = `S${formatSeason(season)}E${formatSeason(episode)} not found`;
          }

          return {
            ...fm,
            selectedSeason: season,
            selectedEpisode: episode,
            selectedEpisodeData: episodeData || null,
            newPath,
            error,
          };
        });

        return { ...g, files: updatedFiles };
      })
    );
  };

  const generatePath = (file: ScannedFile, series: TVDBSearchResult, episode: TVDBEpisode): string => {
    const seriesName = getDisplayName(series, language);
    const seriesYear = series.year || "";
    const episodeTitle = getEpisodeDisplayName(episode);
    const template = getSeriesNamingTemplate();
    const needsQuality = templateUsesQuality(template);
    const qualityInfo = needsQuality ? getQualityInfo(file) : undefined;
    const { quality, codec, extraTags } = splitQualityInfo(qualityInfo, parseOptions);
    const ext = file.parsed.extension || "mkv";

    const result = applySeriesTemplate(template, {
      seriesName,
      seriesYear,
      season: episode.seasonNumber,
      episode: episode.number,
      episodeTitle,
      quality,
      codec,
      extraTags,
      extension: ext,
    });

    if (operation === "rename") {
      return result.fileName;
    }

    const basePath = selectedBaseFolder ? `${selectedBaseFolder}/` : "";
    return `${basePath}${result.fullPath}`;
  };

  const updateSearchQuery = (groupIndex: number, query: string) => {
    setSeriesGroups((prev) =>
      prev.map((g, i) =>
        i === groupIndex ? { ...g, searchQuery: query } : g
      )
    );
  };

  const acceptGroup = (groupIndex: number) => {
    setSeriesGroups((prev) =>
      prev.map((g, i) =>
        i === groupIndex ? { ...g, status: "accepted" as const } : g
      )
    );
    goToNextOrSummary();
  };

  const skipGroup = (groupIndex: number) => {
    setSeriesGroups((prev) =>
      prev.map((g, i) =>
        i === groupIndex ? { ...g, status: "skipped" as const } : g
      )
    );
    goToNextOrSummary();
  };

  const goToNextOrSummary = () => {
    const nextPending = seriesGroups.findIndex(
      (g, i) => i > currentSlide && g.status === "pending"
    );

    if (nextPending !== -1) {
      carouselApi?.scrollTo(nextPending);
    } else {
      setViewMode("summary");
    }
  };

  const goToSlide = (index: number) => {
    setViewMode("carousel");
    setTimeout(() => {
      carouselApi?.scrollTo(index);
    }, 100);
  };

  const toggleGroupExpanded = (groupIndex: number) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupIndex)) {
        newSet.delete(groupIndex);
      } else {
        newSet.add(groupIndex);
      }
      return newSet;
    });
  };

  // Regenerate paths when base folder changes
  useEffect(() => {
    setSeriesGroups((prev) =>
      prev.map((g) => {
        if (!g.selectedResult) return g;

        const updatedFiles = g.files.map(fm => {
          if (!fm.selectedEpisodeData) return fm;
          const newPath = generatePath(fm.file, g.selectedResult!, fm.selectedEpisodeData);
          return { ...fm, newPath };
        });

        return { ...g, files: updatedFiles };
      })
    );
  }, [selectedBaseFolder, seriesNamingTemplate]);

  const handleConfirm = useCallback(async () => {
    const acceptedFiles: { sourcePath: string; destinationPath: string }[] = [];

    for (const group of seriesGroups) {
      if (group.status === "accepted") {
        for (const fm of group.files) {
          if (fm.newPath && fm.selectedEpisodeData && !fm.error) {
            acceptedFiles.push({
              sourcePath: fm.file.path,
              destinationPath: fm.newPath,
            });
          }
        }
      }
    }

    if (acceptedFiles.length === 0) return;

    setIsProcessing(true);
    setProgress(null);
    setScanError(null);

    try {
      const files = acceptedFiles.map((f) => ({
        ...f,
        overwrite: false,
      }));

      const response = await fetch("/api/files/batch-rename-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, operation, overwrite: true, pane }),
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
                  onConfirm(acceptedFiles[0].destinationPath, hasErrors);
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
    } catch {
      setScanError("Failed to process files");
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  }, [seriesGroups, operation, onConfirm, pane]);

  const isLoading = externalLoading || isProcessing;

  // Stats
  const pendingCount = seriesGroups.filter((g) => g.status === "pending").length;
  const acceptedCount = seriesGroups.filter((g) => g.status === "accepted").length;
  const skippedCount = seriesGroups.filter((g) => g.status === "skipped").length;

  const totalAcceptedFiles = seriesGroups
    .filter(g => g.status === "accepted")
    .reduce((sum, g) => sum + g.files.filter(f => f.newPath && !f.error).length, 0);

  const canConfirm = totalAcceptedFiles > 0 && !isLoading;

  // Get unique seasons for a group
  const getGroupSeasons = (group: SeriesGroup) => {
    return [...new Set(group.episodes.map((ep) => ep.seasonNumber))]
      .filter((s) => s !== undefined && s >= 0)
      .sort((a, b) => a - b);
  };

  // Get episodes for a season
  const getEpisodesForSeason = (group: SeriesGroup, season: number) => {
    return group.episodes
      .filter((ep) => ep.seasonNumber === season)
      .sort((a, b) => a.number - b.number);
  };

  // Check if group can be accepted
  const canAcceptGroup = (group: SeriesGroup) => {
    if (!group.selectedResult || group.episodes.length === 0) return false;
    return group.files.some(f => f.newPath && !f.error);
  };

  // Use wider dialog when showing file list
  const dialogWidth = !isMobile ? "sm:max-w-4xl" : "";
  const dialogHeight = !isMobile ? "sm:h-[80dvh]" : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dialogWidth} ${dialogHeight} max-h-[90dvh] flex flex-col p-4 sm:p-6`}>
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base sm:text-lg">
            {language === "it" ? "Identifica Serie Multiple" : "Identify Multiple Series"}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {isScanning
              ? language === "it"
                ? "Scansione file..."
                : "Scanning files..."
              : viewMode === "summary"
              ? language === "it"
                ? "Riepilogo - Conferma le selezioni"
                : "Summary - Confirm your selections"
              : seriesGroups.length > 0
              ? `${language === "it" ? "Gruppo" : "Group"} ${currentSlide + 1} / ${seriesGroups.length}: ${seriesGroups[currentSlide]?.displayName || ""}`
              : language === "it"
              ? "Identifica ogni serie con i file raggruppati"
              : "Identify each series with grouped files"}
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator dots */}
        {!isScanning && seriesGroups.length > 0 && viewMode === "carousel" && (
          <div className="shrink-0 flex items-center justify-center gap-2 py-2">
            <div className="flex gap-1.5 flex-wrap justify-center">
              {seriesGroups.map((g, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => goToSlide(index)}
                  className={`w-2.5 h-2.5 rounded-full transition-all cursor-pointer ${
                    index === currentSlide
                      ? "bg-primary scale-125"
                      : g.status === "accepted"
                      ? "bg-green-500"
                      : g.status === "skipped"
                      ? "bg-muted-foreground/50"
                      : "bg-muted-foreground/30"
                  }`}
                  title={`${g.displayName} (${g.files.length} files)`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Mobile progress bar during processing */}
        {isMobile && progress && (
          <div className="shrink-0 space-y-2 py-2 border-b bg-background">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-muted-foreground">
                  {operation === "copy" ? (language === "it" ? "Copiando" : "Copying") : operation === "move" ? (language === "it" ? "Spostando" : "Moving") : (language === "it" ? "Rinominando" : "Renaming")}...
                </span>
              </div>
              <span className="font-medium">
                {progress.current} / {progress.total}
              </span>
            </div>
            <Progress value={(progress.current / progress.total) * 100} className="h-1.5" />
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 py-2 sm:flex sm:flex-col">
          {/* Scanning state */}
          {isScanning && (
            <div className="space-y-2 p-4">
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

          {/* Carousel view */}
          {!isScanning && seriesGroups.length > 0 && viewMode === "carousel" && (
            <div className="flex-1 min-h-0 flex flex-col sm:flex sm:flex-col sm:flex-1">
              {/* Base folder selector - only show for non-rename operations */}
              {operation !== "rename" && (
                <div className="space-y-1 shrink-0">
                  <label className="text-sm font-medium">
                    {language === "it" ? "Cartella di destinazione" : "Destination Folder"}
                  </label>
                  <Select
                    value={selectedBaseFolder}
                    onValueChange={(value) =>
                      setSelectedBaseFolder(value === "__none__" ? "" : value)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          language === "it" ? "Seleziona cartella..." : "Select folder..."
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        {language === "it" ? "(Radice Media)" : "(Media Root)"}
                      </SelectItem>
                      {seriesBaseFolders.map((folder) => (
                        <SelectItem key={folder.name} value={folder.name}>
                          {folder.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* FFprobe checkbox for rename operations */}
              {operation === "rename" && seriesGroups.length > 0 && (
                <div className="flex items-center gap-2 py-2">
                  <Checkbox
                    id="use-ffprobe-multi"
                    checked={useFFprobe}
                    onCheckedChange={(checked) => setUseFFprobe(checked === true)}
                  />
                  <label
                    htmlFor="use-ffprobe-multi"
                    className="text-sm cursor-pointer select-none"
                  >
                    {language === "it" ? "Usa FFprobe per qualità/codec" : "Use FFprobe for quality/codec"}
                  </label>
                </div>
              )}

              <Carousel
                setApi={setCarouselApi}
                opts={{ watchDrag: false }}
                className="flex-1 min-h-0 w-full mt-4"
              >
                <CarouselContent className="-ml-2 md:-ml-4">
                  {seriesGroups.map((group, groupIndex) => (
                    <CarouselItem key={groupIndex} className="pl-2 md:pl-4">
                      <div className="p-1">
                        <div className="border rounded-lg p-4 space-y-4">
                          {/* Group header */}
                          <div className="flex items-center gap-2">
                            {group.status === "accepted" ? (
                              <Check className="h-5 w-5 text-green-500 shrink-0" />
                            ) : group.status === "skipped" ? (
                              <X className="h-5 w-5 text-muted-foreground shrink-0" />
                            ) : (
                              <div className="w-5 h-5 rounded-full border-2 border-amber-500 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{group.displayName}</p>
                              <p className="text-xs text-muted-foreground">
                                {group.files.length} {group.files.length === 1 ? "file" : "files"}
                              </p>
                            </div>
                          </div>

                          {/* Search section */}
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Search TVDB</label>
                            <div className="flex gap-2">
                              <Input
                                value={group.searchQuery}
                                onChange={(e) => updateSearchQuery(groupIndex, e.target.value)}
                                placeholder={language === "it" ? "Cerca serie..." : "Search series..."}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    performSearch(groupIndex, group.searchQuery);
                                  }
                                }}
                              />
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => performSearch(groupIndex, group.searchQuery)}
                                disabled={group.isSearching}
                              >
                                {group.isSearching ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Search className="h-4 w-4" />
                                )}
                              </Button>
                            </div>

                            {group.searchError && (
                              <p className="text-xs text-destructive">{group.searchError}</p>
                            )}
                          </div>

                          {/* Search results */}
                          {group.searchResults.length > 0 && (
                            <div className="space-y-1">
                              <label className="text-sm font-medium">Results</label>
                              <div className="border rounded-md max-h-32 overflow-y-auto">
                                <div className="divide-y">
                                  {group.searchResults.slice(0, 5).map((result) => (
                                    <button
                                      key={result.id}
                                      type="button"
                                      onClick={() => selectResult(groupIndex, result)}
                                      className={`w-full text-left p-2 hover:bg-accent transition-colors ${
                                        group.selectedResult?.id === result.id ? "bg-accent" : ""
                                      }`}
                                    >
                                      <div className="flex items-center gap-3">
                                        <div className="relative w-8 h-12 rounded overflow-hidden bg-muted shrink-0">
                                          {result.image_url ? (
                                            <Image
                                              src={result.image_url}
                                              alt={result.name}
                                              fill
                                              className="object-cover"
                                              sizes="32px"
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
                                        </div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Episodes loading */}
                          {group.isLoadingEpisodes && (
                            <div className="p-4 flex items-center justify-center gap-2 text-muted-foreground border rounded-md">
                              <Loader2 className="h-5 w-5 animate-spin" />
                              <span className="text-sm">{language === "it" ? "Caricamento episodi..." : "Loading episodes..."}</span>
                            </div>
                          )}

                          {/* File list with episode selection */}
                          {group.selectedResult && group.episodes.length > 0 && (
                            <div className="space-y-2">
                              <button
                                type="button"
                                onClick={() => toggleGroupExpanded(groupIndex)}
                                className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors cursor-pointer"
                              >
                                {expandedGroups.has(groupIndex) ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                                {language === "it" ? "File ed episodi" : "Files & Episodes"} ({group.files.length})
                              </button>

                              <ScrollArea className={`border rounded-md ${expandedGroups.has(groupIndex) ? "h-64" : "h-40"}`}>
                                <div className="divide-y">
                                  {group.files.map((fm, fileIndex) => (
                                    <div key={fileIndex} className="p-3 space-y-2">
                                      <div className="flex items-start gap-2">
                                        {fm.newPath && !fm.error ? (
                                          <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                                        ) : fm.error ? (
                                          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                                        ) : (
                                          <div className="w-4 h-4 rounded-full border border-muted-foreground shrink-0 mt-0.5" />
                                        )}
                                        <div className="flex-1 min-w-0">
                                          <Tooltip delayDuration={0}>
                                            <TooltipTrigger asChild>
                                              <p className="text-sm truncate cursor-default">{fm.file.name}</p>
                                            </TooltipTrigger>
                                            <TooltipContent side="top" className="max-w-xs break-all">
                                              {fm.file.name}
                                            </TooltipContent>
                                          </Tooltip>
                                        </div>
                                      </div>

                                      {/* Episode selector */}
                                      <div className="flex gap-2 pl-6">
                                        <Select
                                          value={fm.selectedSeason?.toString() ?? ""}
                                          onValueChange={(val) => {
                                            const season = parseInt(val, 10);
                                            selectFileEpisode(groupIndex, fileIndex, season, fm.selectedEpisode ?? 1);
                                          }}
                                        >
                                          <SelectTrigger className="w-24">
                                            <SelectValue placeholder="Season" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {getGroupSeasons(group).map((s) => (
                                              <SelectItem key={s} value={s.toString()}>
                                                {s === 0 ? "SP" : `S${formatSeason(s)}`}
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>

                                        {fm.selectedSeason !== null && (
                                          <Select
                                            value={fm.selectedEpisode?.toString() ?? ""}
                                            onValueChange={(val) => {
                                              selectFileEpisode(groupIndex, fileIndex, fm.selectedSeason!, parseInt(val, 10));
                                            }}
                                          >
                                            <SelectTrigger className="flex-1">
                                              <SelectValue placeholder="Episode" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {getEpisodesForSeason(group, fm.selectedSeason).map((ep) => (
                                                <SelectItem key={ep.id} value={ep.number.toString()}>
                                                  E{formatSeason(ep.number)} - {getEpisodeDisplayName(ep) || `Ep ${ep.number}`}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        )}
                                      </div>

                                      {/* Path preview or error */}
                                      {fm.newPath && !fm.error && (
                                        <Tooltip delayDuration={0}>
                                          <TooltipTrigger asChild>
                                            <p className="text-xs text-green-600 dark:text-green-400 pl-6 truncate cursor-default">
                                              → {fm.newPath}
                                            </p>
                                          </TooltipTrigger>
                                          <TooltipContent side="top" className="max-w-sm break-all">
                                            {fm.newPath}
                                          </TooltipContent>
                                        </Tooltip>
                                      )}
                                      {fm.error && (
                                        <p className="text-xs text-amber-600 dark:text-amber-400 pl-6">
                                          {fm.error}
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </ScrollArea>
                            </div>
                          )}

                          {/* Action buttons */}
                          <div className="flex gap-2 pt-2">
                            <Button
                              variant="outline"
                              className="flex-1"
                              onClick={() => skipGroup(groupIndex)}
                              disabled={group.status !== "pending"}
                            >
                              <SkipForward className="h-4 w-4 mr-2" />
                              {language === "it" ? "Salta" : "Skip"}
                            </Button>
                            <Button
                              className="flex-1"
                              onClick={() => acceptGroup(groupIndex)}
                              disabled={!canAcceptGroup(group) || group.status !== "pending"}
                            >
                              <Check className="h-4 w-4 mr-2" />
                              {language === "it" ? "Accetta" : "Accept"} ({group.files.filter(f => f.newPath && !f.error).length})
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious className="hidden sm:flex" />
                <CarouselNext className="hidden sm:flex" />
              </Carousel>

              {/* Status summary */}
              <div className="shrink-0 flex justify-center gap-4 text-xs pt-2">
                {acceptedCount > 0 && (
                  <span className="text-green-600 dark:text-green-400">
                    {acceptedCount} {language === "it" ? "accettate" : "accepted"}
                  </span>
                )}
                {skippedCount > 0 && (
                  <span className="text-muted-foreground">
                    {skippedCount} {language === "it" ? "saltate" : "skipped"}
                  </span>
                )}
                {pendingCount > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {pendingCount} {language === "it" ? "in attesa" : "pending"}
                  </span>
                )}
              </div>

              {/* Go to summary button */}
              <Button
                variant="outline"
                onClick={() => setViewMode("summary")}
                className="shrink-0 mt-2"
              >
                {language === "it" ? "Vai al riepilogo" : "Go to summary"}
              </Button>
            </div>
          )}

          {/* Summary view */}
          {!isScanning && viewMode === "summary" && (
            <div className="flex-1 min-h-0 flex flex-col space-y-3">
              <h3 className="text-sm font-medium shrink-0">
                {language === "it" ? "Riepilogo Selezioni" : "Selection Summary"}
              </h3>

              <ScrollArea className="flex-1 border rounded-md">
                <div className="divide-y">
                  {seriesGroups.map((group, groupIndex) => (
                    <div
                      key={groupIndex}
                      className={`p-3 ${
                        group.status === "skipped" ? "opacity-50 bg-muted/30" : ""
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {group.status === "accepted" ? (
                          <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                        ) : group.status === "skipped" ? (
                          <X className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{group.displayName}</p>
                          {group.status === "accepted" ? (
                            <p className="text-xs text-green-600 dark:text-green-400">
                              {group.files.filter(f => f.newPath && !f.error).length} {language === "it" ? "file pronti" : "files ready"}
                            </p>
                          ) : group.status === "skipped" ? (
                            <p className="text-xs text-muted-foreground">
                              {language === "it" ? "Saltato" : "Skipped"}
                            </p>
                          ) : (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                              {language === "it" ? "In attesa" : "Pending"}
                            </p>
                          )}

                          {/* Show files for accepted groups */}
                          {group.status === "accepted" && (
                            <div className="mt-1 space-y-0.5">
                              {group.files.filter(f => f.newPath && !f.error).map((fm, fi) => (
                                <p key={fi} className="text-xs text-muted-foreground truncate">
                                  • {fm.file.name} → S{formatSeason(fm.selectedSeason ?? 0)}E{formatSeason(fm.selectedEpisode ?? 0)}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                        {group.status !== "pending" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSeriesGroups((prev) =>
                                prev.map((g, i) =>
                                  i === groupIndex ? { ...g, status: "pending" as const } : g
                                )
                              );
                              goToSlide(groupIndex);
                            }}
                          >
                            {language === "it" ? "Modifica" : "Edit"}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              {/* Stats */}
              <div className="shrink-0 flex gap-4 text-xs">
                <span className="text-green-600 dark:text-green-400">
                  {totalAcceptedFiles} {language === "it" ? "file pronti" : "files ready"}
                </span>
                <span className="text-muted-foreground">
                  {skippedCount} {language === "it" ? "serie saltate" : "series skipped"}
                </span>
                {pendingCount > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {pendingCount} {language === "it" ? "in attesa" : "pending"}
                  </span>
                )}
              </div>

              {/* Back to carousel button */}
              <Button
                variant="outline"
                onClick={() => setViewMode("carousel")}
                className="shrink-0"
              >
                {language === "it" ? "Torna al carosello" : "Back to carousel"}
              </Button>
            </div>
          )}

          {/* Progress bar during operation - desktop */}
          {!isMobile && progress && (
            <div className="space-y-2 py-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {operation === "copy"
                    ? language === "it"
                      ? "Copiando file..."
                      : "Copying files..."
                    : operation === "move"
                    ? language === "it"
                      ? "Spostando file..."
                      : "Moving files..."
                    : language === "it"
                    ? "Rinominando file..."
                    : "Renaming files..."}
                </span>
                <span className="font-medium">
                  {progress.current} / {progress.total}
                </span>
              </div>
              <Progress value={(progress.current / progress.total) * 100} className="h-2" />
              <p className="text-xs text-muted-foreground truncate">
                {progress.currentFile}
              </p>
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
            {language === "it" ? "Annulla" : "Cancel"}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex-1 sm:flex-none"
          >
            {isLoading
              ? operation === "copy"
                ? language === "it"
                  ? "Copia..."
                  : "Copying..."
                : operation === "move"
                ? language === "it"
                  ? "Sposta..."
                  : "Moving..."
                : language === "it"
                ? "Rinomina..."
                : "Renaming..."
              : `${
                  operation === "copy"
                    ? language === "it"
                      ? "Copia"
                      : "Copy"
                    : operation === "move"
                    ? language === "it"
                      ? "Sposta"
                      : "Move"
                    : language === "it"
                    ? "Rinomina"
                    : "Rename"
                } ${totalAcceptedFiles} file${totalAcceptedFiles !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
