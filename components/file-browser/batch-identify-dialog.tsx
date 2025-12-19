"use client";

import { useState, useEffect, useCallback } from "react";
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
import {
  AlertCircle,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Search,
  Loader2,
  Image as ImageIcon,
} from "lucide-react";
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
import { sanitizeFileName } from "@/lib/filename-parser";
import {
  normalizeForComparison,
  findAutoMatch,
  getDisplayName,
} from "@/lib/matching-utils";
import type {
  TVDBSearchResult,
  ParsedFileName,
  TVDBApiResponse,
} from "@/types/tvdb";
import type { Language, MovieFolderStructure, BaseFolder } from "@/types/config";

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

// Each file has its own identification state
interface FileIdentification {
  file: ScannedFile;
  searchQuery: string;
  searchResults: TVDBSearchResult[];
  selectedResult: TVDBSearchResult | null;
  isSearching: boolean;
  searchError: string | null;
  newPath: string;
  isExpanded: boolean;
  skipped: boolean;
  existsAtDestination?: boolean;
  overwrite?: boolean;
}

interface BatchIdentifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePaths: string[];
  operation: "copy" | "move";
  onConfirm: (newPath: string) => void;
  isLoading?: boolean;
  language?: Language;
  moviesBaseFolders?: BaseFolder[];
  movieFolderStructure?: MovieFolderStructure;
}

export function BatchIdentifyDialog({
  open,
  onOpenChange,
  filePaths,
  operation,
  onConfirm,
  isLoading: externalLoading,
  language = "en",
  moviesBaseFolders = [],
  movieFolderStructure = "name",
}: BatchIdentifyDialogProps) {
  const isMobile = useIsMobile();

  // Scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Per-file identification state
  const [fileIdentifications, setFileIdentifications] = useState<FileIdentification[]>([]);

  // Selected base folder for movies
  const [selectedBaseFolder, setSelectedBaseFolder] = useState<string>("");

  // Get the preserveQualityInfo setting from the selected folder
  const getPreserveQualityInfo = useCallback(() => {
    if (!selectedBaseFolder) return false;
    const folder = moviesBaseFolders.find(f => f.name === selectedBaseFolder);
    return folder?.preserveQualityInfo ?? false;
  }, [selectedBaseFolder, moviesBaseFolders]);

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

  // Checking existing files state
  const [isCheckingExisting, setIsCheckingExisting] = useState(false);

  // Expanded filename (for mobile click to expand)
  const [expandedFileName, setExpandedFileName] = useState<number | null>(null);

  // Expanded destination path (for mobile click to expand)
  const [expandedDestPath, setExpandedDestPath] = useState<number | null>(null);

  // Scan files when dialog opens
  useEffect(() => {
    if (open && filePaths.length > 0) {
      scanFiles();
    }
  }, [open, filePaths]);

  // Check for existing files when mappings change
  useEffect(() => {
    const validIdentifications = fileIdentifications.filter(
      (fi) => fi.newPath && fi.selectedResult && !fi.skipped
    );
    if (validIdentifications.length === 0) return;

    // Only check if we haven't already
    const needsCheck = validIdentifications.some(
      (fi) => fi.existsAtDestination === undefined
    );
    if (!needsCheck) return;

    checkExistingFiles();
  }, [fileIdentifications]);

  const checkExistingFiles = async () => {
    const validIdentifications = fileIdentifications.filter(
      (fi) => fi.newPath && fi.selectedResult && !fi.skipped && fi.existsAtDestination === undefined
    );
    if (validIdentifications.length === 0) return;

    setIsCheckingExisting(true);
    try {
      const response = await fetch("/api/files/check-destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: validIdentifications.map((fi) => ({
            sourcePath: fi.file.path,
            destinationPath: fi.newPath,
          })),
        }),
      });

      const data = await response.json();
      if (data.success) {
        const existingDestPaths = new Set(
          data.existingFiles.map((f: { destinationPath: string }) => f.destinationPath)
        );

        setFileIdentifications((prev) =>
          prev.map((fi) => {
            if (fi.newPath && fi.selectedResult && !fi.skipped) {
              const exists = existingDestPaths.has(fi.newPath);
              if (fi.existsAtDestination !== exists) {
                return {
                  ...fi,
                  existsAtDestination: exists,
                  overwrite: exists ? fi.overwrite : undefined,
                };
              }
            }
            return fi;
          })
        );
      }
    } catch {
      // Ignore errors in pre-check
    } finally {
      setIsCheckingExisting(false);
    }
  };

  const scanFiles = async () => {
    setIsScanning(true);
    setScanError(null);
    setFileIdentifications([]);

    try {
      const response = await fetch("/api/files/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePaths: filePaths }),
      });

      const data = await response.json();

      if (data.success && data.data) {
        // Create identification state for each file
        const identifications: FileIdentification[] = data.data.files.map(
          (file: ScannedFile) => ({
            file,
            searchQuery: file.parsed.cleanName,
            searchResults: [],
            selectedResult: null,
            isSearching: false,
            searchError: null,
            newPath: "",
            isExpanded: true, // Start expanded
            skipped: false,
          })
        );
        setFileIdentifications(identifications);

        // Auto-search for each file
        identifications.forEach((_, index) => {
          performSearch(index, identifications[index].searchQuery);
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

  const performSearch = async (fileIndex: number, query: string) => {
    if (!query.trim()) return;

    setFileIdentifications((prev) =>
      prev.map((fi, i) =>
        i === fileIndex
          ? { ...fi, isSearching: true, searchError: null }
          : fi
      )
    );

    try {
      const response = await fetch("/api/tvdb/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, type: "movie", lang: language }),
      });

      const data: TVDBApiResponse<TVDBSearchResult[]> = await response.json();

      if (data.success && data.data) {
        const results = data.data;

        // Get the current file info to check for auto-match
        setFileIdentifications((prev) => {
          const currentFile = prev[fileIndex];
          const autoMatch = findAutoMatch(results, currentFile.file.parsed);

          return prev.map((fi, i) => {
            if (i !== fileIndex) return fi;

            // If we found an auto-match, select it automatically
            if (autoMatch) {
              const movieName = sanitizeFileName(getDisplayName(autoMatch));
              const year = autoMatch.year || "";
              const ext = fi.file.parsed.extension || "mkv";
              const preserveQuality = getPreserveQualityInfo();
              // Prefer mediaInfoQuality (has codec from ffprobe) over qualityInfo (from filename only)
              const qualityInfo = fi.file.mediaInfoQuality || fi.file.parsed.qualityInfo;
              const qualitySuffix = preserveQuality && qualityInfo ? ` [${qualityInfo}]` : "";
              const movieFileName = `${movieName}${year ? ` (${year})` : ""}${qualitySuffix}.${ext}`;

              const basePath = selectedBaseFolder ? `${selectedBaseFolder}/` : "";

              let newPath: string;
              if (movieFolderStructure === "none") {
                newPath = `${basePath}${movieFileName}`;
              } else if (movieFolderStructure === "year" && year) {
                newPath = `${basePath}${year}/${movieFileName}`;
              } else {
                const movieFolder = `${movieName}${year ? ` (${year})` : ""}`;
                newPath = `${basePath}${movieFolder}/${movieFileName}`;
              }

              return {
                ...fi,
                isSearching: false,
                searchResults: results,
                searchError: null,
                selectedResult: autoMatch,
                newPath,
                isExpanded: false, // Collapse since we auto-matched
                existsAtDestination: undefined, // Will be re-checked
              };
            }

            return {
              ...fi,
              isSearching: false,
              searchResults: results,
              searchError: null,
            };
          });
        });
      } else {
        setFileIdentifications((prev) =>
          prev.map((fi, i) =>
            i === fileIndex
              ? {
                  ...fi,
                  isSearching: false,
                  searchResults: [],
                  searchError: data.error || "Search failed",
                }
              : fi
          )
        );
      }
    } catch {
      setFileIdentifications((prev) =>
        prev.map((fi, i) =>
          i === fileIndex
            ? { ...fi, isSearching: false, searchError: "Failed to search" }
            : fi
        )
      );
    }
  };

  const selectResult = (fileIndex: number, result: TVDBSearchResult) => {
    setFileIdentifications((prev) =>
      prev.map((fi, i) => {
        if (i !== fileIndex) return fi;

        const movieName = sanitizeFileName(getDisplayName(result));
        const year = result.year || "";
        const ext = fi.file.parsed.extension || "mkv";
        const preserveQuality = getPreserveQualityInfo();
        // Prefer mediaInfoQuality (has codec from ffprobe) over qualityInfo (from filename only)
        const qualityInfo = fi.file.mediaInfoQuality || fi.file.parsed.qualityInfo;
        const qualitySuffix = preserveQuality && qualityInfo ? ` [${qualityInfo}]` : "";
        const movieFileName = `${movieName}${year ? ` (${year})` : ""}${qualitySuffix}.${ext}`;

        const basePath = selectedBaseFolder ? `${selectedBaseFolder}/` : "";

        let newPath: string;
        if (movieFolderStructure === "none") {
          newPath = `${basePath}${movieFileName}`;
        } else if (movieFolderStructure === "year" && year) {
          newPath = `${basePath}${year}/${movieFileName}`;
        } else {
          const movieFolder = `${movieName}${year ? ` (${year})` : ""}`;
          newPath = `${basePath}${movieFolder}/${movieFileName}`;
        }

        return {
          ...fi,
          selectedResult: result,
          newPath,
          existsAtDestination: undefined, // Reset to trigger recheck
        };
      })
    );
  };

  const updateSearchQuery = (fileIndex: number, query: string) => {
    setFileIdentifications((prev) =>
      prev.map((fi, i) =>
        i === fileIndex ? { ...fi, searchQuery: query } : fi
      )
    );
  };

  const toggleExpanded = (fileIndex: number) => {
    setFileIdentifications((prev) =>
      prev.map((fi, i) =>
        i === fileIndex ? { ...fi, isExpanded: !fi.isExpanded } : fi
      )
    );
  };

  const toggleSkipped = (fileIndex: number) => {
    setFileIdentifications((prev) =>
      prev.map((fi, i) =>
        i === fileIndex ? { ...fi, skipped: !fi.skipped } : fi
      )
    );
  };

  const toggleOverwrite = (fileIndex: number, overwrite: boolean) => {
    setFileIdentifications((prev) =>
      prev.map((fi, i) =>
        i === fileIndex ? { ...fi, overwrite } : fi
      )
    );
  };

  // Regenerate paths when base folder changes
  useEffect(() => {
    const preserveQuality = getPreserveQualityInfo();
    setFileIdentifications((prev) =>
      prev.map((fi) => {
        if (!fi.selectedResult) return fi;

        const movieName = sanitizeFileName(getDisplayName(fi.selectedResult));
        const year = fi.selectedResult.year || "";
        const ext = fi.file.parsed.extension || "mkv";
        // Prefer mediaInfoQuality (has codec from ffprobe) over qualityInfo (from filename only)
        const qualityInfo = fi.file.mediaInfoQuality || fi.file.parsed.qualityInfo;
        const qualitySuffix = preserveQuality && qualityInfo ? ` [${qualityInfo}]` : "";
        const movieFileName = `${movieName}${year ? ` (${year})` : ""}${qualitySuffix}.${ext}`;

        const basePath = selectedBaseFolder ? `${selectedBaseFolder}/` : "";

        let newPath: string;
        if (movieFolderStructure === "none") {
          newPath = `${basePath}${movieFileName}`;
        } else if (movieFolderStructure === "year" && year) {
          newPath = `${basePath}${year}/${movieFileName}`;
        } else {
          const movieFolder = `${movieName}${year ? ` (${year})` : ""}`;
          newPath = `${basePath}${movieFolder}/${movieFileName}`;
        }

        return {
          ...fi,
          newPath,
          existsAtDestination: undefined, // Reset to trigger recheck
        };
      })
    );
  }, [selectedBaseFolder, movieFolderStructure, getPreserveQualityInfo]);

  const handleConfirm = useCallback(async () => {
    const validIdentifications = fileIdentifications.filter(
      (fi) =>
        fi.newPath &&
        fi.selectedResult &&
        !fi.skipped &&
        (!fi.existsAtDestination || fi.overwrite)
    );

    if (validIdentifications.length === 0) return;

    setIsProcessing(true);
    setProgress(null);
    setScanError(null);

    try {
      const files = validIdentifications.map((fi) => ({
        sourcePath: fi.file.path,
        destinationPath: fi.newPath,
        overwrite: fi.overwrite || false,
      }));

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
                  onConfirm(validIdentifications[0].newPath);
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
  }, [fileIdentifications, operation, onConfirm]);

  const isLoading = externalLoading || isProcessing;
  const identifiedCount = fileIdentifications.filter(
    (fi) => fi.selectedResult && !fi.skipped
  ).length;
  const skippedCount = fileIdentifications.filter((fi) => fi.skipped).length;
  const pendingCount = fileIdentifications.filter(
    (fi) => !fi.selectedResult && !fi.skipped
  ).length;
  const existingNotConfirmedCount = fileIdentifications.filter(
    (fi) => fi.existsAtDestination && !fi.overwrite && !fi.skipped
  ).length;
  const processableCount = fileIdentifications.filter(
    (fi) =>
      fi.selectedResult &&
      !fi.skipped &&
      (!fi.existsAtDestination || fi.overwrite)
  ).length;

  const canConfirm = processableCount > 0 && !isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:w-[50vw] sm:min-w-250 max-h-[90dvh] flex flex-col p-3 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base sm:text-lg">
            {language === "it" ? "Identifica Film" : "Identify Movies"}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {isScanning
              ? language === "it"
                ? "Scansione file..."
                : "Scanning files..."
              : fileIdentifications.length > 0
              ? language === "it"
                ? `${fileIdentifications.length} file da identificare`
                : `${fileIdentifications.length} file${fileIdentifications.length !== 1 ? "s" : ""} to identify`
              : language === "it"
              ? "Cerca su TVDB per identificare e rinominare i film"
              : "Search TVDB to identify and rename movies"}
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

        <div className="flex-1 min-h-0 flex flex-col space-y-2 sm:space-y-3 py-1 sm:py-2 overflow-y-auto">
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

          {/* Base folder selector */}
          {!isScanning && fileIdentifications.length > 0 && (
            <div className="space-y-1 shrink-0">
              <label className="text-xs sm:text-sm font-medium">
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
                  {moviesBaseFolders.map((folder) => (
                    <SelectItem key={folder.name} value={folder.name}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* File list */}
          {!isScanning && fileIdentifications.length > 0 && (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-1 sm:mb-2 shrink-0">
                <label className="text-xs sm:text-sm font-medium">
                  {language === "it" ? "Film" : "Movies"} ({fileIdentifications.length})
                </label>
                <div className="text-[10px] sm:text-xs text-muted-foreground space-x-1 sm:space-x-2">
                  {identifiedCount > 0 && (
                    <span className="text-green-600 dark:text-green-400">
                      ✓ {identifiedCount}
                    </span>
                  )}
                  {pendingCount > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      ? {pendingCount}
                    </span>
                  )}
                  {skippedCount > 0 && (
                    <span className="text-muted-foreground">✗ {skippedCount}</span>
                  )}
                </div>
              </div>

              <div className="flex-1 border rounded-md h-[50vh] sm:h-auto overflow-y-auto">
                <div className="divide-y">
                  {fileIdentifications.map((fi, index) => (
                    <div
                      key={fi.file.path}
                      className={`${fi.skipped ? "opacity-50 bg-muted/30" : ""}`}
                    >
                      {/* File header - collapsible */}
                      <div className="flex items-center gap-1 sm:gap-2 p-2 sm:p-3 hover:bg-muted/50 transition-colors">
                        {/* Expand/collapse button */}
                        <button
                          type="button"
                          onClick={() => toggleExpanded(index)}
                          className="shrink-0 p-1 cursor-pointer"
                        >
                          {fi.isExpanded ? (
                            <ChevronDown className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />
                          )}
                        </button>

                        {/* Status icon */}
                        <div className="shrink-0">
                          {fi.skipped ? (
                            <X className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground" />
                          ) : fi.selectedResult ? (
                            fi.existsAtDestination && !fi.overwrite ? (
                              <AlertCircle className="h-3 w-3 sm:h-4 sm:w-4 text-amber-500" />
                            ) : (
                              <Check className="h-3 w-3 sm:h-4 sm:w-4 text-green-500" />
                            )
                          ) : fi.isSearching ? (
                            <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground animate-spin" />
                          ) : (
                            <Search className="h-3 w-3 sm:h-4 sm:w-4 text-amber-500" />
                          )}
                        </div>

                        {/* File info */}
                        <div className="flex-1 min-w-0 overflow-hidden">
                          {isMobile ? (
                            // Mobile: tap to expand/collapse full filename
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={() => setExpandedFileName(expandedFileName === index ? null : index)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  setExpandedFileName(expandedFileName === index ? null : index);
                                }
                              }}
                              className={`text-xs font-medium text-left w-full cursor-pointer ${
                                fi.skipped ? "line-through text-muted-foreground" : ""
                              } ${expandedFileName === index ? "whitespace-normal break-all block" : "truncate block max-w-50"}`}
                            >
                              {fi.file.name}
                            </span>
                          ) : (
                            // Desktop: hover tooltip
                            <Tooltip delayDuration={0}>
                              <TooltipTrigger asChild>
                                <p
                                  className={`text-xs sm:text-sm font-medium truncate cursor-default ${
                                    fi.skipped ? "line-through text-muted-foreground" : ""
                                  }`}
                                >
                                  {fi.file.name}
                                </p>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-75 break-all">
                                {fi.file.name}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {fi.selectedResult && !fi.skipped && (
                            <>
                              <p className="text-[10px] sm:text-xs text-green-600 dark:text-green-400 truncate">
                                → {getDisplayName(fi.selectedResult)}
                                {fi.selectedResult.year && ` (${fi.selectedResult.year})`}
                              </p>
                              {fi.newPath && (
                                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                                  {fi.newPath}
                                </p>
                              )}
                            </>
                          )}
                          {fi.existsAtDestination && !fi.overwrite && !fi.skipped && (
                            <p className="text-[10px] sm:text-xs text-amber-600 dark:text-amber-400">
                              {language === "it" ? "File già esistente" : "File already exists"}
                            </p>
                          )}
                        </div>

                        {/* Skip button - separate from the expand button */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleSkipped(index)}
                          className="shrink-0 h-7 w-7 sm:h-8 sm:w-auto sm:px-2 p-0"
                        >
                          {fi.skipped ? (
                            <span className="hidden sm:inline">{language === "it" ? "Ripristina" : "Unskip"}</span>
                          ) : null}
                          {fi.skipped ? (
                            <span className="sm:hidden text-xs">↩</span>
                          ) : (
                            <X className="h-3 w-3 sm:h-4 sm:w-4" />
                          )}
                        </Button>
                      </div>

                      {/* Expanded content */}
                      {fi.isExpanded && !fi.skipped && (
                        <div className="px-2 pb-2 pl-6 sm:px-3 sm:pb-3 sm:pl-9 space-y-2 sm:space-y-3">
                          {/* Search input */}
                          <div className="flex gap-1 sm:gap-2">
                            <Input
                              value={fi.searchQuery}
                              onChange={(e) => updateSearchQuery(index, e.target.value)}
                              placeholder={
                                language === "it"
                                  ? "Cerca film..."
                                  : "Search movie..."
                              }
                              className="flex-1 h-8 sm:h-9 text-xs sm:text-sm"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  performSearch(index, fi.searchQuery);
                                }
                              }}
                              onFocus={(e) => {
                                // Scroll input into view when keyboard opens on mobile
                                if (isMobile) {
                                  setTimeout(() => {
                                    e.target.scrollIntoView({ behavior: "smooth", block: "center" });
                                  }, 300);
                                }
                              }}
                            />
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => performSearch(index, fi.searchQuery)}
                              disabled={fi.isSearching}
                              className="h-8 w-8 sm:h-9 sm:w-9"
                            >
                              {fi.isSearching ? (
                                <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 animate-spin" />
                              ) : (
                                <Search className="h-3 w-3 sm:h-4 sm:w-4" />
                              )}
                            </Button>
                          </div>

                          {/* Search results */}
                          {fi.searchError && (
                            <p className="text-xs text-destructive">{fi.searchError}</p>
                          )}

                          {fi.isSearching && fi.searchResults.length === 0 && (
                            <div className="p-3 flex items-center justify-center gap-2 text-muted-foreground border rounded-md">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="text-xs">{language === "it" ? "Ricerca in corso..." : "Searching..."}</span>
                            </div>
                          )}

                          {fi.searchResults.length > 0 && (
                            <div className="border rounded-md max-h-48 sm:max-h-40 overflow-y-auto overscroll-contain touch-pan-y">
                              <div className="divide-y">
                                {fi.searchResults.slice(0, 5).map((result) => (
                                  <button
                                    key={result.id}
                                    type="button"
                                    onClick={() => selectResult(index, result)}
                                    className={`w-full text-left p-2 sm:p-2 hover:bg-accent transition-colors ${
                                      fi.selectedResult?.id === result.id
                                        ? "bg-accent"
                                        : ""
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      {/* Poster thumbnail */}
                                      <div className="relative w-6 h-9 sm:w-8 sm:h-12 rounded overflow-hidden bg-muted shrink-0">
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
                                            <ImageIcon className="h-3 w-3 text-muted-foreground" />
                                          </div>
                                        )}
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <p className="text-xs sm:text-sm font-medium truncate">
                                          {result.name_translated || result.name}
                                          {result.year && (
                                            <span className="text-muted-foreground ml-1">
                                              ({result.year})
                                            </span>
                                          )}
                                        </p>
                                        {result.name_translated &&
                                          result.name_translated !== result.name && (
                                            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                                              {result.name}
                                            </p>
                                          )}
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {fi.searchResults.length === 0 &&
                            !fi.isSearching &&
                            fi.searchQuery && (
                              <p className="text-[10px] sm:text-xs text-muted-foreground">
                                {language === "it"
                                  ? "Nessun risultato trovato"
                                  : "No results found"}
                              </p>
                            )}

                          {/* Overwrite checkbox if file exists */}
                          {fi.existsAtDestination && fi.selectedResult && (
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`overwrite-${index}`}
                                checked={fi.overwrite || false}
                                onCheckedChange={(checked) =>
                                  toggleOverwrite(index, checked === true)
                                }
                                className="h-4 w-4"
                              />
                              <label
                                htmlFor={`overwrite-${index}`}
                                className="text-[10px] sm:text-xs text-amber-600 dark:text-amber-400 cursor-pointer"
                              >
                                {language === "it"
                                  ? "Sovrascrivi file esistente"
                                  : "Overwrite existing file"}
                              </label>
                            </div>
                          )}

                          {/* Preview path */}
                          {fi.newPath && (
                            isMobile ? (
                              <button
                                type="button"
                                onClick={() => setExpandedDestPath(expandedDestPath === index ? null : index)}
                                className={`text-[10px] sm:text-xs text-muted-foreground text-left w-full ${expandedDestPath === index ? "whitespace-normal break-all" : "truncate"}`}
                              >
                                → {fi.newPath}
                              </button>
                            ) : (
                              <Tooltip delayDuration={0}>
                                <TooltipTrigger asChild>
                                  <p className="text-[10px] sm:text-xs text-muted-foreground truncate cursor-default">
                                    → {fi.newPath}
                                  </p>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-100 break-all">
                                  {fi.newPath}
                                </TooltipContent>
                              </Tooltip>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Progress bar during operation - desktop only (mobile has fixed progress at top) */}
          {!isMobile && progress && (
            <div className="space-y-1 sm:space-y-2 py-1 sm:py-2 shrink-0">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="text-muted-foreground">
                  {operation === "copy"
                    ? language === "it"
                      ? "Copiando file..."
                      : "Copying files..."
                    : language === "it"
                    ? "Spostando file..."
                    : "Moving files..."}
                </span>
                <span className="font-medium">
                  {progress.current} / {progress.total}
                </span>
              </div>
              <Progress value={(progress.current / progress.total) * 100} className="h-1.5 sm:h-2" />
              <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                {progress.currentFile}
              </p>
              {/* Byte-level progress for current file */}
              {progress.bytesTotal !== undefined && progress.bytesTotal > 0 && (
                <div className="space-y-1">
                  <Progress
                    value={(progress.bytesCopied ?? 0) / progress.bytesTotal * 100}
                    className="h-1"
                  />
                  <p className="text-[10px] sm:text-xs text-muted-foreground">
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
                <p className="text-[10px] sm:text-xs text-destructive">
                  {progress.failed} {language === "it" ? "falliti" : "failed"}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 pt-2 flex-col-reverse sm:flex-row gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="w-full sm:w-auto"
          >
            {language === "it" ? "Annulla" : "Cancel"}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="w-full sm:w-auto text-xs sm:text-sm"
          >
            {isLoading
              ? operation === "copy"
                ? language === "it"
                  ? "Copia..."
                  : "Copying..."
                : language === "it"
                ? "Sposta..."
                : "Moving..."
              : `${operation === "copy" ? (language === "it" ? "Copia" : "Copy") : language === "it" ? "Sposta" : "Move"} ${processableCount} file${processableCount !== 1 ? "s" : ""}${existingNotConfirmedCount > 0 ? ` (${existingNotConfirmedCount} ${language === "it" ? "saltati" : "skip"})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
