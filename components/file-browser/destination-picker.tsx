"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronRight, Folder, FolderPlus, Home, ArrowLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { FileEntry, ListFilesResponse } from "@/types/files";

interface DestinationPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operation: "copy" | "move";
  selectedCount: number;
  onConfirm: (destinationPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  isLoading?: boolean;
  initialPath?: string; // Initial path to open the picker at (e.g., current media folder)
}

export function DestinationPicker({
  open,
  onOpenChange,
  operation,
  selectedCount,
  onConfirm,
  onCreateFolder,
  isLoading,
  initialPath = "/",
}: DestinationPickerProps) {
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = useCallback(async (path: string) => {
    setIsFetching(true);
    setError(null);

    try {
      const params = new URLSearchParams({ pane: "media", path });
      const response = await fetch(`/api/files?${params}`);
      const data: ListFilesResponse = await response.json();

      if (data.success && data.data) {
        // Only show directories
        setEntries(data.data.entries.filter((e) => e.type === "directory"));
        setCurrentPath(data.data.path);
      } else {
        setError(data.error || "Failed to load folders");
        setEntries([]);
      }
    } catch {
      setError("Failed to connect to server");
      setEntries([]);
    } finally {
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      // Start at the initial path (e.g., current media folder) instead of root
      fetchFiles(initialPath || "/");
    }
  }, [open, fetchFiles, initialPath]);

  const handleNavigate = (path: string) => {
    fetchFiles(path);
  };

  const handleNavigateUp = () => {
    if (currentPath === "/") return;
    const parentPath = currentPath.split("/").slice(0, -1).join("/") || "/";
    fetchFiles(parentPath);
  };

  const handleConfirm = () => {
    onConfirm(currentPath);
  };

  const pathSegments = currentPath.split("/").filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85dvh] flex flex-col p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base sm:text-lg">
            {operation === "copy" ? "Copy" : "Move"} {selectedCount} item
            {selectedCount !== 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription className="text-sm">
            Select a destination folder in Media.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground overflow-x-auto pb-2 shrink-0">
          <button
            onClick={() => handleNavigate("/")}
            className="flex items-center gap-1 hover:text-foreground transition-colors shrink-0"
          >
            <Home className="h-3 w-3" />
            <span>Media</span>
          </button>
          {pathSegments.map((segment, index) => (
            <span key={index} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="h-3 w-3" />
              <button
                onClick={() =>
                  handleNavigate("/" + pathSegments.slice(0, index + 1).join("/"))
                }
                className="hover:text-foreground transition-colors"
              >
                {segment}
              </button>
            </span>
          ))}
        </div>

        <div className="border rounded-md flex-1 min-h-0 flex flex-col overflow-hidden">
          {currentPath !== "/" && (
            <button
              onClick={handleNavigateUp}
              className="w-full flex items-center gap-2 p-2 hover:bg-accent transition-colors border-b shrink-0"
            >
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs sm:text-sm">Go back</span>
            </button>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {isFetching ? (
              <div className="p-2 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Skeleton className="h-4 w-4" />
                    <Skeleton className="h-4 flex-1" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-full text-destructive text-xs sm:text-sm p-4">
                {error}
              </div>
            ) : entries.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-xs sm:text-sm p-4">
                No subfolders
              </div>
            ) : (
              <div className="p-1">
                {entries.map((entry) => (
                  <button
                    key={entry.path}
                    onClick={() => handleNavigate(entry.path)}
                    className="w-full flex items-center gap-2 p-2 rounded hover:bg-accent transition-colors text-left"
                  >
                    <Folder className="h-4 w-4 text-blue-500 shrink-0" />
                    <span className="text-xs sm:text-sm truncate flex-1">{entry.name}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 shrink-0 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onCreateFolder(currentPath)}
            disabled={isLoading || isFetching}
            className="w-full sm:w-auto text-xs sm:text-sm"
          >
            <FolderPlus className="h-4 w-4 mr-1" />
            New Folder
          </Button>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
              className="flex-1 sm:flex-none text-xs sm:text-sm"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={isLoading || isFetching}
              className="flex-1 sm:flex-none text-xs sm:text-sm"
            >
              {isLoading
                ? operation === "copy"
                  ? "Copying..."
                  : "Moving..."
                : `${operation === "copy" ? "Copy" : "Move"} Here`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
