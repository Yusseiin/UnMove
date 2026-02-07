"use client";

import { useState, useEffect, useCallback, Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { showErrorToast, showSuccessToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertCircle,
  Check,
  X,
  Search,
  Loader2,
  Image as ImageIcon,
  SkipForward,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Pencil,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
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
  MetadataProvider,
  BaseFolder,
  SeriesNamingTemplate,
  AppConfig,
  EpisodeOrder,
} from "@/types/config";
import { getTranslations } from "@/lib/translations";

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
  searchYear: string;
  searchResults: TVDBSearchResult[];
  selectedResult: TVDBSearchResult | null;
  isSearching: boolean;
  searchError: string | null;
  episodes: TVDBEpisode[];
  isLoadingEpisodes: boolean;
  status: "pending" | "accepted" | "skipped";
  // Folder rename options (for rename operation)
  renameSeasonFolders: boolean;
  renameMainFolder: boolean;
}

function IdentifyMultiSeriesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();

  // Get params from URL
  const pane = (searchParams.get("pane") as "downloads" | "media") || "downloads";
  const operation = (searchParams.get("operation") as "copy" | "move" | "rename") || "rename";

  // Config state
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);

  // Get file paths from sessionStorage
  const [filePaths, setFilePaths] = useState<string[]>([]);

  const language = config?.language || "en";
  const t = useMemo(() => getTranslations(language), [language]);
  const seriesBaseFolders = config?.seriesBaseFolders || [];
  const seriesNamingTemplate = config?.seriesNamingTemplate;
  // Build parse options from config values
  const parseOptions = {
    qualityValues: config?.qualityValues,
    codecValues: config?.codecValues,
    extraTagValues: config?.extraTagValues,
  };

  // Current slide index (no carousel, just state)
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

  // Metadata provider (TVDB or TMDB) - use seriesMetadataProvider with fallback to legacy metadataProvider
  const [activeProvider, setActiveProvider] = useState<MetadataProvider>(
    config?.seriesMetadataProvider ?? config?.metadataProvider ?? "tvdb"
  );

  // Sync activeProvider when config loads
  useEffect(() => {
    const provider = config?.seriesMetadataProvider ?? config?.metadataProvider;
    if (provider) {
      setActiveProvider(provider);
    }
  }, [config?.seriesMetadataProvider, config?.metadataProvider]);

  // Track if provider was manually changed (not from config load)
  const [providerManuallyChanged, setProviderManuallyChanged] = useState(false);

  // Re-search all groups when provider is manually changed
  useEffect(() => {
    if (providerManuallyChanged && seriesGroups.length > 0) {
      seriesGroups.forEach((group, index) => {
        if (group.searchQuery.trim()) {
          performSearch(index, group.searchQuery);
        }
      });
      setProviderManuallyChanged(false);
    }
  }, [providerManuallyChanged, activeProvider]);

  // FFprobe checkbox state for rename operations
  const [useFFprobe, setUseFFprobe] = useState(true);

  // Episode order for TVDB (Aired, DVD, Absolute)
  const [episodeOrder, setEpisodeOrder] = useState<EpisodeOrder>("default");

  // Re-fetch episodes when episode order changes (for TVDB)
  useEffect(() => {
    if (activeProvider === "tvdb" && seriesGroups.length > 0) {
      seriesGroups.forEach((group, index) => {
        if (group.selectedResult) {
          fetchEpisodes(index, group.selectedResult);
        }
      });
    }
  }, [episodeOrder]);

  // Track which file is being edited (groupIndex-fileIndex or null)
  const [editingFile, setEditingFile] = useState<string | null>(null);

  // Track collapsed seasons per group (groupIndex-season)
  const [collapsedSeasons, setCollapsedSeasons] = useState<Set<string>>(new Set());

  // Load config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch("/api/config");
        const data = await response.json();
        if (data.success) {
          setConfig(data.data);
        }
      } catch (error) {
        console.error("Failed to load config:", error);
      } finally {
        setIsLoadingConfig(false);
      }
    };
    loadConfig();
  }, []);

  // Load file paths from sessionStorage
  useEffect(() => {
    const stored = sessionStorage.getItem("multiSeriesFilePaths");
    if (stored) {
      try {
        const paths = JSON.parse(stored);
        setFilePaths(paths);
      } catch {
        console.error("Failed to parse file paths from sessionStorage");
      }
    }
  }, []);

  // Get the alwaysUseFFprobe setting - for rename use checkbox, for copy/move use folder setting
  const getAlwaysUseFFprobe = useCallback(() => {
    if (operation === "rename") {
      return useFFprobe;
    }
    // For copy/move, use folder setting
    if (!selectedBaseFolder) return false;
    const folder = seriesBaseFolders.find((f: BaseFolder) => f.name === selectedBaseFolder);
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
    const folder = seriesBaseFolders.find((f: BaseFolder) => f.name === selectedBaseFolder);
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
    if (language === "de") {
      return episode.nameGerman || episode.nameEnglish || episode.name;
    }
    return episode.nameEnglish || episode.name;
  }, [language]);

  // Scan files when file paths are loaded
  useEffect(() => {
    if (filePaths.length > 0 && !isLoadingConfig && config) {
      scanFiles();
    }
  }, [filePaths, isLoadingConfig, config]);

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
        const groups: SeriesGroup[] = Array.from(groupMap.entries()).map(([key, value]) => {
          // Extract year from the first file in the group (if available)
          const firstFileYear = value.files[0]?.parsed?.year;
          return {
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
            searchYear: firstFileYear ? String(firstFileYear) : "",
            searchResults: [],
            selectedResult: null,
            isSearching: false,
            searchError: null,
            episodes: [],
            isLoadingEpisodes: false,
            status: "pending" as const,
            renameSeasonFolders: false,
            renameMainFolder: false,
          };
        });

        setSeriesGroups(groups);

        // Auto-search for each group
        groups.forEach((_, index) => {
          performSearch(index, groups[index].searchQuery, groups[index].searchYear);
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

  const performSearch = async (groupIndex: number, query: string, year?: string) => {
    if (!query.trim()) return;

    setSeriesGroups((prev) =>
      prev.map((g, i) =>
        i === groupIndex
          ? { ...g, isSearching: true, searchError: null }
          : g
      )
    );

    try {
      // Use the active provider's search endpoint
      const searchEndpoint = activeProvider === "tmdb" ? "/api/tmdb/search" : "/api/tvdb/search";
      // Build request body - include year for both providers
      const requestBody: { query: string; type: "series"; lang: string; year?: string } = {
        query,
        type: "series",
        lang: language,
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
        // Check for API key missing error
        if (data.error?.startsWith("API_KEY_MISSING:")) {
          const provider = data.error.split(":")[1];
          showErrorToast(`${provider} API key missing`, "Please add it to your .env file.");
        }
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
      const langParam = language === "it" ? "&lang=it" : language === "de" ? "&lang=de" : "";
      // Use the active provider's episodes endpoint
      const episodesEndpoint = activeProvider === "tmdb" ? "/api/tmdb/episodes" : "/api/tvdb/episodes";
      // Add episode order for TVDB
      const orderParam = activeProvider === "tvdb" ? `&order=${episodeOrder}` : "";
      const response = await fetch(`${episodesEndpoint}?seriesId=${series.id}${langParam}${orderParam}`);
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

  const updateSearchYear = (groupIndex: number, year: string) => {
    setSeriesGroups((prev) =>
      prev.map((g, i) =>
        i === groupIndex ? { ...g, searchYear: year } : g
      )
    );
  };

  const acceptGroup = (groupIndex: number) => {
    setSeriesGroups((prev) =>
      prev.map((g, i) =>
        i === groupIndex ? { ...g, status: "accepted" as const } : g
      )
    );
    goToNextOrSummary(groupIndex);
  };

  const skipGroup = (groupIndex: number) => {
    setSeriesGroups((prev) =>
      prev.map((g, i) =>
        i === groupIndex ? { ...g, status: "skipped" as const } : g
      )
    );
    goToNextOrSummary(groupIndex);
  };

  const goToNextOrSummary = (fromIndex: number) => {
    const nextPending = seriesGroups.findIndex(
      (g, i) => i > fromIndex && g.status === "pending"
    );

    if (nextPending !== -1) {
      setCurrentSlide(nextPending);
    } else {
      setViewMode("summary");
    }
  };

  const goToSlide = (index: number) => {
    setViewMode("carousel");
    setCurrentSlide(index);
  };

  const goToPrevious = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1);
    }
  };

  const goToNext = () => {
    if (currentSlide < seriesGroups.length - 1) {
      setCurrentSlide(currentSlide + 1);
    }
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
    let folderRenames: { oldPath: string; newName: string }[] = [];
    let seasonFolderCreates: { filePath: string; newFileName: string; seasonFolder: string }[] = [];

    for (const group of seriesGroups) {
      if (group.status === "accepted") {
        // Build file rename map for this group
        const fileRenameMap = new Map<string, string>();

        for (const fm of group.files) {
          if (fm.newPath && fm.selectedEpisodeData && !fm.error) {
            acceptedFiles.push({
              sourcePath: fm.file.path,
              destinationPath: fm.newPath,
            });
            fileRenameMap.set(fm.file.path, fm.newPath);
          }
        }

        // Process folder renames for this group (only for rename operation)
        if (operation === "rename" && group.selectedResult && (group.renameSeasonFolders || group.renameMainFolder)) {
          const seriesName = getDisplayName(group.selectedResult, language);
          const seriesYear = group.selectedResult.year || "";
          const template = getSeriesNamingTemplate();

          // Get quality info from first file
          const firstFile = group.files[0]?.file;
          const qualityInfo = firstFile ? getQualityInfo(firstFile) : undefined;
          const { quality, codec, extraTags } = splitQualityInfo(qualityInfo, parseOptions);

          const folderMap = new Map<string, string>();

          for (const fm of group.files) {
            if (!fm.selectedEpisodeData || fm.error) continue;

            const season = fm.selectedEpisodeData.seasonNumber;

            // Get expected folder names from template
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

            // === FILE-CENTRIC FOLDER LOGIC ===
            const fullFilePath = fm.file.path.replace(/\\/g, "/");
            const fullPathParts = fullFilePath.split("/").filter(p => p.length > 0);
            fullPathParts.pop(); // Remove filename

            console.log("[FOLDER-LOGIC-MULTI] ========================================");
            console.log("[FOLDER-LOGIC-MULTI] File:", fm.file.path);
            console.log("[FOLDER-LOGIC-MULTI] Full path parts:", fullPathParts);
            console.log("[FOLDER-LOGIC-MULTI] Expected series folder:", expectedSeriesFolder);
            console.log("[FOLDER-LOGIC-MULTI] Expected season folder:", expectedSeasonFolder);

            // Indexes from the FILE's perspective (counting backwards from file)
            const seasonFolderFullIndex = fullPathParts.length - 1;
            const mainFolderFullIndex = fullPathParts.length - 2;

            console.log("[FOLDER-LOGIC-MULTI] Season folder index:", seasonFolderFullIndex, "=", fullPathParts[seasonFolderFullIndex]);
            console.log("[FOLDER-LOGIC-MULTI] Main folder index:", mainFolderFullIndex, "=", fullPathParts[mainFolderFullIndex]);

            // === SEASON FOLDER ===
            if (group.renameSeasonFolders && seasonFolderFullIndex >= 0 && expectedSeasonFolder) {
              const seasonPath = fullPathParts.slice(0, seasonFolderFullIndex + 1).join("/");
              const currentSeasonName = fullPathParts[seasonFolderFullIndex];
              console.log("[FOLDER-LOGIC-MULTI] RENAME SEASON: '%s' → '%s' (path: %s)",
                currentSeasonName, expectedSeasonFolder, seasonPath);
              if (currentSeasonName !== expectedSeasonFolder && !folderMap.has(seasonPath)) {
                folderMap.set(seasonPath, expectedSeasonFolder);
              }
            }

            // === MAIN FOLDER ===
            if (group.renameMainFolder && mainFolderFullIndex >= 0) {
              const mainPath = fullPathParts.slice(0, mainFolderFullIndex + 1).join("/");
              const currentMainName = fullPathParts[mainFolderFullIndex];
              console.log("[FOLDER-LOGIC-MULTI] RENAME MAIN: '%s' → '%s' (path: %s)",
                currentMainName, expectedSeriesFolder, mainPath);
              if (currentMainName !== expectedSeriesFolder && !folderMap.has(mainPath)) {
                folderMap.set(mainPath, expectedSeriesFolder);
              }
            }

            console.log("[FOLDER-LOGIC-MULTI] ========================================");
          }

          // Add to folder renames (sorted by depth, deepest first)
          const groupFolderRenames = Array.from(folderMap.entries())
            .map(([oldPath, newName]) => ({ oldPath, newName }))
            .sort((a, b) => b.oldPath.split("/").length - a.oldPath.split("/").length);

          folderRenames = [...folderRenames, ...groupFolderRenames];
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
        body: JSON.stringify({
          files,
          operation,
          overwrite: true,
          pane,
          folderRenames: folderRenames.length > 0 ? folderRenames : undefined,
          seasonFolderCreates: seasonFolderCreates.length > 0 ? seasonFolderCreates : undefined,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to start operation");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: { completed: number; errors: string[] } = { completed: 0, errors: [] };

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
                finalResult = { completed: data.completed, errors: data.errors || [] };
              } else if (data.type === "error") {
                setScanError(data.message || "Operation failed");
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      // Handle completion
      if (finalResult.completed > 0) {
        const actionText = operation === "copy" ? "copied" : operation === "move" ? "moved" : "renamed";
        showSuccessToast(`Files ${actionText} successfully`, `${finalResult.completed} files processed`);

        if (finalResult.errors.length > 0) {
          showErrorToast("Some operations failed", finalResult.errors.join("\n"));
        }

        // Clear session storage and save pane to focus on return
        sessionStorage.removeItem("multiSeriesFilePaths");
        // For rename operation, stay on same pane; for copy/move, go to media pane
        const returnPane = operation === "rename" ? pane : "media";
        sessionStorage.setItem("returnToPane", returnPane);
        router.push("/");
      } else {
        setScanError(finalResult.errors?.join(", ") || "All files failed");
      }
    } catch {
      setScanError("Failed to process files");
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  }, [seriesGroups, operation, pane, router, language, getSeriesNamingTemplate, getQualityInfo]);

  const handleBack = () => {
    sessionStorage.removeItem("multiSeriesFilePaths");
    router.push("/");
  };

  const isLoading = isProcessing;

  // Stats
  const pendingCount = seriesGroups.filter((g) => g.status === "pending").length;
  const acceptedCount = seriesGroups.filter((g) => g.status === "accepted").length;
  const skippedCount = seriesGroups.filter((g) => g.status === "skipped").length;

  const totalAcceptedFiles = seriesGroups
    .filter(g => g.status === "accepted")
    .reduce((sum, g) => sum + g.files.filter(f => f.newPath && !f.error).length, 0);

  // Can only confirm when ALL series have been decided (none pending) AND at least one file is accepted
  const allSeriesDecided = pendingCount === 0;
  const canConfirm = totalAcceptedFiles > 0 && allSeriesDecided && !isLoading;

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

  // Get files grouped by season for a group
  const getFilesBySeason = (group: SeriesGroup) => {
    const bySeason = new Map<number, { file: FileEpisodeMapping; index: number }[]>();

    group.files.forEach((fm, index) => {
      const season = fm.selectedSeason ?? -1;
      if (!bySeason.has(season)) {
        bySeason.set(season, []);
      }
      bySeason.get(season)!.push({ file: fm, index });
    });

    // Sort seasons
    const sortedSeasons = [...bySeason.keys()].sort((a, b) => {
      if (a === -1) return 1;
      if (b === -1) return -1;
      return a - b;
    });

    return { bySeason, sortedSeasons };
  };

  // Toggle season collapse
  const toggleSeasonCollapse = (groupIndex: number, season: number) => {
    const key = `${groupIndex}-${season}`;
    setCollapsedSeasons(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  // Check if group can be accepted
  const canAcceptGroup = (group: SeriesGroup) => {
    if (!group.selectedResult || group.episodes.length === 0) return false;
    return group.files.some(f => f.newPath && !f.error);
  };

  // Current group
  const currentGroup = seriesGroups[currentSlide];

  // Show loading while config loads
  if (isLoadingConfig) {
    return (
      <div className="h-dvh flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show error if no files
  if (filePaths.length === 0 && !isLoadingConfig) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center gap-4">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">{t.multiSeries.noFilesSelected}</p>
        <Button onClick={handleBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t.multiSeries.goBack}
        </Button>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="h-dvh flex flex-col overflow-hidden bg-background">
        {/* Header */}
        <header className="border-b px-3 lg:px-8 py-2 lg:py-4 shrink-0">
          <div className="max-w-5xl mx-auto flex items-center gap-2 lg:gap-4">
            <Button variant="ghost" size="icon" onClick={handleBack} disabled={isProcessing} className="shrink-0 h-8 w-8 lg:h-10 lg:w-10">
              <ArrowLeft className="h-4 w-4 lg:h-5 lg:w-5" />
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-sm lg:text-xl font-semibold break-all">
                {filePaths.length === 1
                  ? t.multiSeries.identifyWithProvider.replace("{provider}", "TVDB")
                  : t.multiSeries.title}
              </h1>
              <p className="text-xs lg:text-sm text-muted-foreground break-all">
                {isScanning
                  ? t.multiSeries.scanning
                  : viewMode === "summary"
                  ? t.multiSeries.summary
                  : seriesGroups.length > 0
                  ? seriesGroups.length === 1
                    ? ""
                    : `${currentSlide + 1}/${seriesGroups.length}`
                  : ""}
              </p>
            </div>
            {/* Status badges - desktop */}
            {!isMobile && seriesGroups.length > 0 && (
              <div className="flex gap-4 text-sm shrink-0">
                {acceptedCount > 0 && (
                  <span className="text-green-600 dark:text-green-400 flex items-center gap-1.5 bg-green-500/10 px-3 py-1 rounded-full">
                    <Check className="h-4 w-4" /> {acceptedCount} {t.multiSeries.accepted}
                  </span>
                )}
                {skippedCount > 0 && (
                  <span className="text-muted-foreground flex items-center gap-1.5 bg-muted px-3 py-1 rounded-full">
                    <X className="h-4 w-4" /> {skippedCount} {t.multiSeries.skipped}
                  </span>
                )}
                {pendingCount > 0 && (
                  <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5 bg-amber-500/10 px-3 py-1 rounded-full">
                    {pendingCount} {t.multiSeries.pending}
                  </span>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Progress bar during processing */}
        {progress && (
          <div className="shrink-0 px-4 lg:px-8 py-3 border-b bg-muted/30">
            <div className="max-w-5xl mx-auto space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-muted-foreground">
                    {operation === "copy" ? t.common.copying : operation === "move" ? t.common.moving : t.common.renaming}...
                  </span>
                </div>
                <span className="font-medium">{progress.current} / {progress.total}</span>
              </div>
              <Progress value={(progress.current / progress.total) * 100} className="h-2" />
            </div>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {/* Scanning state */}
          {isScanning && (
            <div className="flex-1 flex items-center justify-center">
              <div className="space-y-4 text-center">
                <Loader2 className="h-10 w-10 animate-spin mx-auto text-muted-foreground" />
                <p className="text-lg text-muted-foreground">{t.multiSeries.scanningFiles}</p>
              </div>
            </div>
          )}

          {/* Scan error */}
          {scanError && (
            <div className="px-4 lg:px-8 mt-4">
              <div className="max-w-5xl mx-auto flex items-center gap-3 p-4 bg-destructive/10 text-destructive rounded-lg text-sm">
                <AlertCircle className="h-5 w-5 shrink-0" />
                {scanError}
              </div>
            </div>
          )}

          {/* Carousel view */}
          {!isScanning && seriesGroups.length > 0 && viewMode === "carousel" && currentGroup && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {/* Progress dots - clickable */}
              <div className="shrink-0 flex items-center justify-center gap-2 py-2 lg:py-3 px-4 border-b overflow-x-auto">
                {seriesGroups.map((g, index) => (
                  <Tooltip key={index} delayDuration={0}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => goToSlide(index)}
                        className={`w-3 h-3 lg:w-3.5 lg:h-3.5 rounded-full transition-all cursor-pointer shrink-0 hover:scale-125 ${
                          index === currentSlide
                            ? "bg-primary scale-125 ring-2 ring-primary/30"
                            : g.status === "accepted"
                            ? "bg-green-500"
                            : g.status === "skipped"
                            ? "bg-muted-foreground/50"
                            : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                        }`}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="font-medium">{g.displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {g.files.length} {g.files.length !== 1 ? t.common.files : t.common.file} · {g.status === "accepted" ? t.multiSeries.accepted : g.status === "skipped" ? t.multiSeries.skipped : t.multiSeries.pending}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>

              {/* Current group content - centered container for desktop */}
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <div className="flex-1 min-h-0 w-full max-w-5xl mx-auto flex flex-col overflow-hidden">
                  {/* Group header with status */}
                  <div className="shrink-0 px-3 lg:px-6 py-2 lg:py-4 border-b bg-muted/30">
                    <div className="flex items-center gap-2 lg:gap-4">
                      {currentGroup.status === "accepted" ? (
                        <div className="w-8 h-8 lg:w-12 lg:h-12 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                          <Check className="h-4 w-4 lg:h-6 lg:w-6 text-green-500" />
                        </div>
                      ) : currentGroup.status === "skipped" ? (
                        <div className="w-8 h-8 lg:w-12 lg:h-12 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <X className="h-4 w-4 lg:h-6 lg:w-6 text-muted-foreground" />
                        </div>
                      ) : (
                        <div className="w-8 h-8 lg:w-12 lg:h-12 rounded-full border-2 border-amber-500 bg-amber-500/10 flex items-center justify-center shrink-0">
                          <span className="text-xs lg:text-base font-semibold text-amber-600 dark:text-amber-400">{currentSlide + 1}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm lg:text-lg break-all">{currentGroup.displayName}</p>
                        <p className="text-xs lg:text-sm text-muted-foreground break-all">
                          {currentGroup.files.length} {currentGroup.files.length === 1 ? "file" : "files"}
                          {currentGroup.selectedResult && (
                            <span className="ml-1 lg:ml-2 text-primary font-medium">
                              → {currentGroup.selectedResult.name_translated || currentGroup.selectedResult.name}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Scrollable content with better desktop layout */}
                  <ScrollArea className="flex-1 min-h-0">
                    <div className="p-3 lg:p-6 space-y-4 lg:space-y-6">
                      {/* Folder rename options - only for rename operation - at the top */}
                      {operation === "rename" && currentGroup.selectedResult && currentGroup.episodes.length > 0 && (
                        <div className="flex flex-col gap-2 lg:gap-4 p-3 lg:p-4 bg-muted/30 rounded-lg border">
                          <label className="text-xs lg:text-sm font-medium">
                            {t.multiSeries.options}
                          </label>
                          <div className="flex flex-col lg:flex-row lg:flex-wrap gap-2 lg:gap-4">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id="use-ffprobe-page"
                                checked={useFFprobe}
                                onCheckedChange={(checked) => setUseFFprobe(checked === true)}
                                className="h-4 w-4"
                              />
                              <label
                                htmlFor="use-ffprobe-page"
                                className="text-xs lg:text-sm cursor-pointer select-none"
                              >
                                {t.multiSeries.ffprobeQuality}
                              </label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`rename-season-folders-${currentSlide}`}
                                checked={currentGroup.renameSeasonFolders}
                                onCheckedChange={(checked) => {
                                  setSeriesGroups((prev) =>
                                    prev.map((g, i) =>
                                      i === currentSlide ? { ...g, renameSeasonFolders: checked === true } : g
                                    )
                                  );
                                }}
                                className="h-4 w-4"
                              />
                              <label
                                htmlFor={`rename-season-folders-${currentSlide}`}
                                className="text-xs lg:text-sm cursor-pointer select-none"
                              >
                                {t.multiSeries.createSeasonFolders}
                              </label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`rename-main-folder-${currentSlide}`}
                                checked={currentGroup.renameMainFolder}
                                onCheckedChange={(checked) => {
                                  setSeriesGroups((prev) =>
                                    prev.map((g, i) =>
                                      i === currentSlide ? { ...g, renameMainFolder: checked === true } : g
                                    )
                                  );
                                }}
                                className="h-4 w-4"
                              />
                              <label
                                htmlFor={`rename-main-folder-${currentSlide}`}
                                className="text-xs lg:text-sm cursor-pointer select-none"
                              >
                                {t.multiSeries.createMainFolder}
                              </label>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Two column layout for desktop */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                        {/* Left column: Search and results */}
                        <div className="space-y-3 lg:space-y-4">
                          {/* Base folder selector - only show for non-rename operations */}
                          {operation !== "rename" && (
                            <div className="space-y-1 lg:space-y-2">
                              <label className="text-xs lg:text-sm font-medium">
                                {t.multiSeries.destination}
                              </label>
                              <Select
                                value={selectedBaseFolder}
                                onValueChange={(value) => setSelectedBaseFolder(value === "__none__" ? "" : value)}
                              >
                                <SelectTrigger className="w-full h-9 lg:h-10 text-sm">
                                  <SelectValue placeholder={t.multiSeries.selectPlaceholder} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">
                                    {t.identify.mediaRoot}
                                  </SelectItem>
                                  {seriesBaseFolders.map((folder: BaseFolder) => (
                                    <SelectItem key={folder.name} value={folder.name}>
                                      {folder.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          {/* Search section */}
                          <div className="space-y-1 lg:space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <label className="text-xs lg:text-sm font-medium">
                                {t.common.search} {activeProvider.toUpperCase()}
                              </label>
                              <div className="flex items-center gap-2">
                                {/* Episode order selector for TVDB */}
                                {activeProvider === "tvdb" && (
                                  <Select
                                    value={episodeOrder}
                                    onValueChange={(value: EpisodeOrder) => setEpisodeOrder(value)}
                                  >
                                    <SelectTrigger className="h-6 w-32 text-xs">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="default">
                                        <span className="text-xs">{t.identify.orderAired}</span>
                                      </SelectItem>
                                      <SelectItem value="official">
                                        <span className="text-xs">{t.identify.orderDVD}</span>
                                      </SelectItem>
                                      <SelectItem value="absolute">
                                        <span className="text-xs">{t.identify.orderAbsolute}</span>
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
                                value={currentGroup.searchQuery}
                                onChange={(e) => updateSearchQuery(currentSlide, e.target.value)}
                                placeholder={t.multiSeries.searchSeries}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    performSearch(currentSlide, currentGroup.searchQuery, currentGroup.searchYear);
                                  }
                                }}
                                className="flex-1 h-9 lg:h-10 text-sm"
                              />
                              <Input
                                value={currentGroup.searchYear}
                                onChange={(e) => {
                                  // Only allow digits, max 4 chars
                                  const value = e.target.value.replace(/\D/g, "").slice(0, 4);
                                  updateSearchYear(currentSlide, value);
                                }}
                                placeholder={t.common.year}
                                className="w-20 h-9 lg:h-10 text-sm"
                                maxLength={4}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    performSearch(currentSlide, currentGroup.searchQuery, currentGroup.searchYear);
                                  }
                                }}
                              />
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-9 w-9 lg:h-10 lg:w-10"
                                onClick={() => performSearch(currentSlide, currentGroup.searchQuery, currentGroup.searchYear)}
                                disabled={currentGroup.isSearching}
                              >
                                {currentGroup.isSearching ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Search className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                            {currentGroup.searchError && (
                              <p className="text-xs lg:text-sm text-destructive">{currentGroup.searchError}</p>
                            )}
                          </div>

                          {/* Search results */}
                          {currentGroup.searchResults.length > 0 && (
                            <div className="space-y-1 lg:space-y-2">
                              <label className="text-xs lg:text-sm font-medium">
                                {t.common.results}
                              </label>
                              <div className="border rounded-lg divide-y max-h-48 lg:max-h-64 overflow-y-auto">
                                {currentGroup.searchResults.slice(0, 5).map((result) => (
                                  <button
                                    key={result.id}
                                    type="button"
                                    onClick={() => selectResult(currentSlide, result)}
                                    className={`w-full text-left p-2 lg:p-3 hover:bg-accent transition-colors ${
                                      currentGroup.selectedResult?.id === result.id ? "bg-accent" : ""
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 lg:gap-3">
                                      <div className="relative w-8 h-11 lg:w-10 lg:h-14 rounded overflow-hidden bg-muted shrink-0">
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
                                            <ImageIcon className="h-3 w-3 lg:h-4 lg:w-4 text-muted-foreground" />
                                          </div>
                                        )}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <p className="font-medium text-xs lg:text-sm break-all">
                                          {result.name_translated || result.name}
                                          {result.year && (
                                            <span className="text-muted-foreground ml-1">({result.year})</span>
                                          )}
                                        </p>
                                      </div>
                                      {currentGroup.selectedResult?.id === result.id && (
                                        <Check className="h-5 w-5 text-primary shrink-0" />
                                      )}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Episodes loading */}
                          {currentGroup.isLoadingEpisodes && (
                            <div className="p-4 lg:p-6 flex items-center justify-center gap-2 lg:gap-3 text-muted-foreground border rounded-lg">
                              <Loader2 className="h-4 w-4 lg:h-5 lg:w-5 animate-spin" />
                              <span className="text-xs lg:text-sm">{t.multiSeries.loadingEpisodes}</span>
                            </div>
                          )}
                        </div>

                        {/* Right column: File list with episode selection - grouped by season */}
                        <div className="space-y-3 lg:space-y-4">
                          {currentGroup.selectedResult && currentGroup.episodes.length > 0 && (() => {
                            const { bySeason, sortedSeasons } = getFilesBySeason(currentGroup);

                            return (
                              <div className="space-y-2 lg:space-y-3">
                                <label className="text-xs lg:text-sm font-medium flex items-center gap-2">
                                  {t.multiSeries.filesAndEpisodes}
                                  <span className="text-xs text-muted-foreground font-normal">
                                    ({currentGroup.files.filter(f => f.newPath && !f.error).length}/{currentGroup.files.length})
                                  </span>
                                </label>
                                <div className="border rounded-lg max-h-60 lg:max-h-100 overflow-y-auto overflow-x-auto">
                                  <div className="min-w-120">
                                  {sortedSeasons.map((season) => {
                                    const seasonFiles = bySeason.get(season) || [];
                                    const collapseKey = `${currentSlide}-${season}`;
                                    const isCollapsed = collapsedSeasons.has(collapseKey);
                                    const seasonValidCount = seasonFiles.filter(({ file: f }) => f.newPath && !f.error).length;
                                    const seasonErrorCount = seasonFiles.filter(({ file: f }) => f.error).length;
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
                                          onClick={() => toggleSeasonCollapse(currentSlide, season)}
                                          className="w-full flex items-center gap-1.5 lg:gap-2 p-2 lg:p-2.5 hover:bg-muted/50 transition-colors text-left cursor-pointer"
                                        >
                                          {isCollapsed ? (
                                            <ChevronRight className="h-3 w-3 lg:h-4 lg:w-4 text-muted-foreground shrink-0" />
                                          ) : (
                                            <ChevronDown className="h-3 w-3 lg:h-4 lg:w-4 text-muted-foreground shrink-0" />
                                          )}
                                          <span className="font-medium text-xs lg:text-sm">{seasonLabel}</span>
                                          <span className="text-xs text-muted-foreground">
                                            ({seasonFiles.length})
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
                                        </button>

                                        {/* Season files - collapsible content */}
                                        {!isCollapsed && (
                                          <div className="divide-y border-t bg-muted/10">
                                            {seasonFiles.map(({ file: fm, index: fileIndex }) => {
                                              const fileKey = `${currentSlide}-${fileIndex}`;
                                              const isEditing = editingFile === fileKey;
                                              const hasMatch = fm.newPath && !fm.error;

                                              return (
                                                <div key={fileIndex} className="p-2 lg:p-2.5 pl-6 lg:pl-8">
                                                  {/* Compact view - show when matched and not editing */}
                                                  {hasMatch && !isEditing ? (
                                                    <div className="flex items-center gap-1.5 lg:gap-2">
                                                      <div className="w-4 h-4 lg:w-5 lg:h-5 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                                                        <Check className="h-2.5 w-2.5 lg:h-3 lg:w-3 text-green-500" />
                                                      </div>
                                                      <div className="flex-1 min-w-0">
                                                        <p className="text-xs lg:text-sm break-all">
                                                          <span className="text-muted-foreground">{fm.file.name}</span>
                                                          <span className="mx-1 lg:mx-1.5 text-green-500">→</span>
                                                          <span className="font-medium text-green-600 dark:text-green-400">
                                                            E{formatSeason(fm.selectedEpisode!)}
                                                          </span>
                                                        </p>
                                                      </div>
                                                      <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-6 w-6 lg:h-7 lg:w-7 shrink-0"
                                                        onClick={() => setEditingFile(fileKey)}
                                                      >
                                                        <Pencil className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
                                                      </Button>
                                                    </div>
                                                  ) : (
                                                    /* Expanded view - show when not matched or editing */
                                                    <div className="space-y-1.5 lg:space-y-2">
                                                      {/* File name with status */}
                                                      <div className="flex items-center gap-1.5 lg:gap-2">
                                                        {fm.error ? (
                                                          <div className="w-4 h-4 lg:w-5 lg:h-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                                                            <AlertCircle className="h-2.5 w-2.5 lg:h-3 lg:w-3 text-amber-500" />
                                                          </div>
                                                        ) : (
                                                          <div className="w-4 h-4 lg:w-5 lg:h-5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                                                        )}
                                                        <p className="text-xs lg:text-sm break-all flex-1 min-w-0">{fm.file.name}</p>
                                                        {isEditing && (
                                                          <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6 lg:h-7 lg:w-7 shrink-0"
                                                            onClick={() => setEditingFile(null)}
                                                          >
                                                            <Check className="h-3 w-3 lg:h-3.5 lg:w-3.5" />
                                                          </Button>
                                                        )}
                                                      </div>

                                                      {/* Episode selector */}
                                                      <div className="flex gap-1.5 lg:gap-2 pl-5 lg:pl-7">
                                                        <Select
                                                          value={fm.selectedSeason?.toString() ?? ""}
                                                          onValueChange={(val) => {
                                                            const newSeason = parseInt(val, 10);
                                                            selectFileEpisode(currentSlide, fileIndex, newSeason, fm.selectedEpisode ?? 1);
                                                          }}
                                                        >
                                                          <SelectTrigger className="w-16 lg:w-20 h-7 lg:h-8 text-xs">
                                                            <SelectValue placeholder="S" />
                                                          </SelectTrigger>
                                                          <SelectContent>
                                                            {getGroupSeasons(currentGroup).map((s) => (
                                                              <SelectItem key={s} value={s.toString()}>
                                                                {s === 0 ? "Sp" : `S${formatSeason(s)}`}
                                                              </SelectItem>
                                                            ))}
                                                          </SelectContent>
                                                        </Select>

                                                        {fm.selectedSeason !== null && (
                                                          <Select
                                                            value={fm.selectedEpisode?.toString() ?? ""}
                                                            onValueChange={(val) => {
                                                              selectFileEpisode(currentSlide, fileIndex, fm.selectedSeason!, parseInt(val, 10));
                                                              if (isEditing) setEditingFile(null);
                                                            }}
                                                          >
                                                            <SelectTrigger className="flex-1 h-7 lg:h-8 text-xs">
                                                              <SelectValue placeholder="Ep" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                              {getEpisodesForSeason(currentGroup, fm.selectedSeason).map((ep) => (
                                                                <SelectItem key={ep.id} value={ep.number.toString()}>
                                                                  E{formatSeason(ep.number)} - {getEpisodeDisplayName(ep) || `Ep ${ep.number}`}
                                                                </SelectItem>
                                                              ))}
                                                            </SelectContent>
                                                          </Select>
                                                        )}
                                                      </div>

                                                      {/* Error message */}
                                                      {fm.error && (
                                                        <p className="text-xs text-amber-600 dark:text-amber-400 pl-5 lg:pl-7">{fm.error}</p>
                                                      )}
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
                                </div>
                              </div>
                            );
                          })()}

                          {/* Placeholder when no series selected */}
                          {!currentGroup.selectedResult && !currentGroup.isLoadingEpisodes && (
                            <div className="border-2 border-dashed rounded-lg p-4 lg:p-8 text-center text-muted-foreground">
                              <Search className="h-6 w-6 lg:h-8 lg:w-8 mx-auto mb-2 lg:mb-3 opacity-50" />
                              <p className="font-medium text-sm lg:text-base">{t.multiSeries.selectASeries}</p>
                              <p className="text-xs lg:text-sm mt-1">{t.multiSeries.searchAndSelectSeries}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </ScrollArea>

                  {/* Navigation and action buttons - mobile optimized */}
                  <div className="shrink-0 border-t p-2 lg:p-6 bg-background safe-area-inset-bottom">
                    <div className="max-w-5xl mx-auto">
                      {/* Mobile: two rows layout */}
                      <div className="flex flex-col gap-1.5 lg:hidden">
                        {/* First row: Prev, Next, Skip */}
                        <div className="flex gap-1.5">
                          <Button
                            variant="outline"
                            onClick={goToPrevious}
                            disabled={currentSlide === 0}
                            className="flex-1 h-9 px-2"
                            size="sm"
                          >
                            <ChevronLeft className="h-4 w-4 mr-1" />
                            <span className="text-xs">{t.multiSeries.prev}</span>
                          </Button>
                          <Button
                            variant="outline"
                            onClick={goToNext}
                            disabled={currentSlide === seriesGroups.length - 1}
                            className="flex-1 h-9 px-2"
                            size="sm"
                          >
                            <span className="text-xs">{t.multiSeries.next}</span>
                            <ChevronRight className="h-4 w-4 ml-1" />
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => skipGroup(currentSlide)}
                            disabled={currentGroup.status !== "pending"}
                            className="flex-1 h-9 px-2"
                            size="sm"
                          >
                            <SkipForward className="h-4 w-4 mr-1" />
                            <span className="text-xs">{t.common.skip}</span>
                          </Button>
                        </div>
                        {/* Second row: Accept + Summary */}
                        <div className="flex gap-1.5">
                          <Button
                            onClick={() => acceptGroup(currentSlide)}
                            disabled={!canAcceptGroup(currentGroup) || currentGroup.status !== "pending"}
                            className="flex-1 h-9 px-2"
                            size="sm"
                          >
                            <Check className="h-4 w-4 mr-1" />
                            <span className="text-xs">{t.multiSeries.accept} ({currentGroup.files.filter(f => f.newPath && !f.error).length})</span>
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setViewMode("summary")}
                            className="h-9 px-3 text-muted-foreground text-xs"
                            size="sm"
                          >
                            {t.multiSeries.summary}
                          </Button>
                        </div>
                      </div>

                      {/* Desktop: single row */}
                      <div className="hidden lg:flex lg:items-center gap-4">
                        {/* Navigation buttons */}
                        <div className="flex gap-3">
                          <Button
                            variant="outline"
                            onClick={goToPrevious}
                            disabled={currentSlide === 0}
                            className="w-32 h-11"
                          >
                            <ChevronLeft className="h-4 w-4 mr-1" />
                            {t.multiSeries.previous}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={goToNext}
                            disabled={currentSlide === seriesGroups.length - 1}
                            className="w-32 h-11"
                          >
                            {t.multiSeries.next}
                            <ChevronRight className="h-4 w-4 ml-1" />
                          </Button>
                        </div>

                        {/* Spacer */}
                        <div className="flex-1" />

                        {/* Action buttons */}
                        <div className="flex gap-3">
                          <Button
                            variant="outline"
                            onClick={() => skipGroup(currentSlide)}
                            disabled={currentGroup.status !== "pending"}
                            className="w-32 h-11"
                          >
                            <SkipForward className="h-4 w-4 mr-2" />
                            {t.common.skip}
                          </Button>
                          <Button
                            onClick={() => acceptGroup(currentSlide)}
                            disabled={!canAcceptGroup(currentGroup) || currentGroup.status !== "pending"}
                            className="min-w-40 h-11"
                          >
                            <Check className="h-4 w-4 mr-2" />
                            {t.multiSeries.accept} ({currentGroup.files.filter(f => f.newPath && !f.error).length})
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => setViewMode("summary")}
                            className="h-11"
                          >
                            {t.multiSeries.summary}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Summary view */}
          {!isScanning && viewMode === "summary" && (
            <div className="flex-1 min-h-0 flex flex-col p-4 lg:p-6">
              <div className="max-w-5xl mx-auto w-full flex-1 min-h-0 flex flex-col">
                {/* Summary header */}
                <div className="shrink-0 mb-4 lg:mb-6">
                  <h2 className="text-lg lg:text-xl font-semibold">
                    {t.multiSeries.selectionSummary}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {t.multiSeries.filesReadyFor
                      .replace("{count}", String(totalAcceptedFiles))
                      .replace("{operation}", operation === "copy" ? t.common.copy.toLowerCase() : operation === "move" ? t.common.move.toLowerCase() : t.common.rename.toLowerCase())}
                  </p>
                </div>

                {/* Stats badges - desktop */}
                <div className="shrink-0 flex flex-wrap gap-3 mb-4 lg:mb-6">
                  <span className="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-1.5 rounded-full">
                    <Check className="h-4 w-4" />
                    {totalAcceptedFiles} {t.multiSeries.filesReady}
                  </span>
                  {skippedCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
                      <X className="h-4 w-4" />
                      {skippedCount} {t.multiSeries.skipped}
                    </span>
                  )}
                  {pendingCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-full">
                      <AlertCircle className="h-4 w-4" />
                      {pendingCount} {t.multiSeries.pending}
                    </span>
                  )}
                </div>

                <ScrollArea className="flex-1 border rounded-lg">
                  <div className="divide-y">
                    {seriesGroups.map((group, groupIndex) => (
                      <div
                        key={groupIndex}
                        className={`p-4 lg:p-5 transition-colors ${
                          group.status === "skipped"
                            ? "opacity-50 bg-muted/30"
                            : group.status === "accepted"
                            ? "bg-green-500/5"
                            : "bg-amber-500/5"
                        }`}
                      >
                        <div className="flex items-start gap-3 lg:gap-4">
                          {group.status === "accepted" ? (
                            <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                              <Check className="h-4 w-4 lg:h-5 lg:w-5 text-green-500" />
                            </div>
                          ) : group.status === "skipped" ? (
                            <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                              <X className="h-4 w-4 lg:h-5 lg:w-5 text-muted-foreground" />
                            </div>
                          ) : (
                            <div className="w-8 h-8 lg:w-10 lg:h-10 rounded-full border-2 border-amber-500 bg-amber-500/10 flex items-center justify-center shrink-0">
                              <AlertCircle className="h-4 w-4 lg:h-5 lg:w-5 text-amber-500" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm lg:text-base">{group.displayName}</p>
                              {group.selectedResult && (
                                <span className="text-xs lg:text-sm text-primary font-medium">
                                  → {group.selectedResult.name_translated || group.selectedResult.name}
                                </span>
                              )}
                            </div>
                            {group.status === "accepted" ? (
                              <p className="text-xs lg:text-sm text-green-600 dark:text-green-400 mt-0.5">
                                {group.files.filter(f => f.newPath && !f.error).length} {t.multiSeries.filesReady}
                              </p>
                            ) : group.status === "skipped" ? (
                              <p className="text-xs lg:text-sm text-muted-foreground mt-0.5">
                                {t.multiSeries.skipped}
                              </p>
                            ) : (
                              <p className="text-xs lg:text-sm text-amber-600 dark:text-amber-400 mt-0.5">
                                {t.multiSeries.pending}
                              </p>
                            )}

                            {/* Show files for accepted groups */}
                            {group.status === "accepted" && (
                              <div className="mt-3 space-y-2 bg-background/50 rounded-lg p-3 border">
                                {group.files.filter(f => f.newPath && !f.error).map((fm, fi) => (
                                  <Tooltip key={fi} delayDuration={0}>
                                    <TooltipTrigger asChild>
                                      <div className="text-xs lg:text-sm text-muted-foreground cursor-default hover:text-foreground transition-colors">
                                        <span className="font-medium text-foreground">{fm.file.name}</span>
                                        <span className="mx-2 text-green-500">→</span>
                                        <span className="text-green-600 dark:text-green-400">{fm.newPath}</span>
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-lg break-all">
                                      <div className="space-y-1">
                                        <p><span className="font-medium">From:</span> {fm.file.path}</p>
                                        <p><span className="font-medium">To:</span> {fm.newPath}</p>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                ))}
                              </div>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => goToSlide(groupIndex)}
                            className="shrink-0 h-9 lg:h-10"
                          >
                            {t.multiSeries.edit}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </main>

        {/* Footer with main action buttons */}
        <footer className="border-t px-4 lg:px-8 py-3 lg:py-4 shrink-0 bg-background">
          <div className="max-w-5xl mx-auto flex items-center gap-3 lg:gap-4">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={isLoading}
              className="h-10 lg:h-11 px-4 lg:px-6"
            >
              {t.common.cancel}
            </Button>

            {/* Desktop: show Back to carousel button in summary view */}
            {viewMode === "summary" && (
              <Button
                variant="outline"
                onClick={() => setViewMode("carousel")}
                className="hidden lg:flex h-10 lg:h-11 px-4 lg:px-6"
              >
                <ChevronLeft className="h-4 w-4 mr-2" />
                {t.multiSeries.backToDetails}
              </Button>
            )}

            <div className="flex-1" />

            <Button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className={`min-w-36 lg:min-w-48 h-10 lg:h-11 px-4 lg:px-6 ${!canConfirm ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {operation === "copy"
                    ? t.multiSeries.copyingEllipsis
                    : operation === "move"
                    ? t.multiSeries.movingEllipsis
                    : t.multiSeries.renamingEllipsis}
                </>
              ) : (
                operation === "copy"
                  ? t.multiSeries.copyFiles.replace("{count}", String(totalAcceptedFiles))
                  : operation === "move"
                  ? t.multiSeries.moveFiles.replace("{count}", String(totalAcceptedFiles))
                  : t.multiSeries.renameFiles.replace("{count}", String(totalAcceptedFiles))
              )}
            </Button>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}

export default function IdentifyMultiSeriesPage() {
  return (
    <Suspense fallback={
      <div className="h-dvh flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <IdentifyMultiSeriesContent />
    </Suspense>
  );
}
