"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { FileEntry, PaneType, ListFilesResponse } from "@/types/files";

interface UseFileBrowserReturn {
  currentPath: string;
  entries: FileEntry[];
  selectedPaths: Set<string>;
  isLoading: boolean;
  error: string | null;
  navigate: (path: string) => void;
  navigateUp: () => void;
  refresh: () => void;
  toggleSelection: (path: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setSelectedPaths: (paths: Set<string>) => void;
}

// Module-level cache for return path (to survive React re-renders/strict mode)
let cachedReturnPane: string | null = null;
let cachedReturnPath: string | null = null;
// Track which panes have already received their return path for this navigation
let pathConsumedByPane: Set<string> = new Set();

function getReturnPathOnce(pane: PaneType): string {
  if (typeof window === "undefined") return "/";

  // Always check sessionStorage first - if there's a value, use it (fresh navigation)
  const freshPane = sessionStorage.getItem("returnToPane");
  const freshPath = sessionStorage.getItem("returnToPath");

  if (freshPane && freshPath) {
    // Fresh values from sessionStorage - store in cache and clear storage
    cachedReturnPane = freshPane;
    cachedReturnPath = freshPath;
    // Reset consumed tracking for new navigation
    pathConsumedByPane = new Set();
    sessionStorage.removeItem("returnToPane");
    sessionStorage.removeItem("returnToPath");
  }

  // Check if this pane matches the cached return pane AND hasn't already consumed it
  if (cachedReturnPane === pane && cachedReturnPath && !pathConsumedByPane.has(pane)) {
    const path = cachedReturnPath;
    // Mark as consumed but keep the cache for subsequent renders of the same pane
    pathConsumedByPane.add(pane);
    return path;
  }

  // If this pane already consumed its path, return that path again (for re-renders)
  if (pathConsumedByPane.has(pane) && cachedReturnPane === pane && cachedReturnPath) {
    return cachedReturnPath;
  }

  return "/";
}

export function useFileBrowser(pane: PaneType): UseFileBrowserReturn {
  // Track if this is the first mount
  const isFirstMount = useRef(true);

  // Get initial path - only use cached return path on first mount
  const getInitialPath = () => {
    if (isFirstMount.current) {
      return getReturnPathOnce(pane);
    }
    return "/";
  };

  const [currentPath, setCurrentPath] = useState(getInitialPath);

  // Mark as no longer first mount after initial render
  useEffect(() => {
    isFirstMount.current = false;
  }, [pane]);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = useCallback(
    async (path: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ pane, path });
        const response = await fetch(`/api/files?${params}`);
        const data: ListFilesResponse = await response.json();

        if (data.success && data.data) {
          setEntries(data.data.entries);
          setCurrentPath(data.data.path);
        } else {
          setError(data.error || "Failed to load files");
          setEntries([]);
        }
      } catch {
        setError("Failed to connect to server");
        setEntries([]);
      } finally {
        setIsLoading(false);
      }
    },
    [pane]
  );

  useEffect(() => {
    fetchFiles(currentPath);
  }, []);

  const navigate = useCallback(
    (path: string) => {
      setSelectedPaths(new Set());
      fetchFiles(path);
    },
    [fetchFiles]
  );

  const navigateUp = useCallback(() => {
    if (currentPath === "/") return;
    const parentPath = currentPath.split("/").slice(0, -1).join("/") || "/";
    navigate(parentPath);
  }, [currentPath, navigate]);

  const refresh = useCallback(() => {
    fetchFiles(currentPath);
  }, [currentPath, fetchFiles]);

  const toggleSelection = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedPaths(new Set(entries.map((e) => e.path)));
  }, [entries]);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  return {
    currentPath,
    entries,
    selectedPaths,
    isLoading,
    error,
    navigate,
    navigateUp,
    refresh,
    toggleSelection,
    selectAll,
    clearSelection,
    setSelectedPaths,
  };
}
