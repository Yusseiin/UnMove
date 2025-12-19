"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";

// Helper function to format bytes as human-readable string
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

interface TransferProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operation: "copy" | "move";
  files: { sourcePath: string; destinationPath: string }[];
  overwrite?: boolean;
  onComplete: (success: boolean, message: string) => void;
}

interface ProgressState {
  current: number;
  total: number;
  currentFile: string;
  completed: number;
  failed: number;
  errors: string[];
  bytesCopied?: number;
  bytesTotal?: number;
  bytesPerSecond?: number;
}

export function TransferProgressDialog({
  open,
  onOpenChange,
  operation,
  files,
  overwrite = false,
  onComplete,
}: TransferProgressDialogProps) {
  const isMobile = useIsMobile();
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startTransfer = useCallback(async () => {
    if (files.length === 0) return;

    setProgress(null);
    setIsComplete(false);
    setError(null);

    try {
      const response = await fetch("/api/files/batch-rename-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, operation, overwrite }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to start transfer");
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
                  errors: data.errors || [],
                  bytesCopied: data.bytesCopied,
                  bytesTotal: data.bytesTotal,
                  bytesPerSecond: data.bytesPerSecond,
                });
              } else if (data.type === "complete") {
                setIsComplete(true);
                if (data.completed > 0) {
                  onComplete(true, data.message || "Transfer completed");
                } else {
                  setError(data.errors?.join(", ") || "All files failed");
                  onComplete(false, data.errors?.join(", ") || "All files failed");
                }
              } else if (data.type === "error") {
                setError(data.message || "Transfer failed");
                setIsComplete(true);
                onComplete(false, data.message || "Transfer failed");
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch {
      setError("Failed to transfer files");
      setIsComplete(true);
      onComplete(false, "Failed to transfer files");
    }
  }, [files, operation, overwrite, onComplete]);

  // Start transfer when dialog opens
  useEffect(() => {
    if (open && files.length > 0) {
      startTransfer();
    }
  }, [open, files, startTransfer]);

  // Don't allow closing while in progress
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && !isComplete) {
      // Don't allow closing while in progress
      return;
    }
    onOpenChange(newOpen);
  };

  // Auto-close on mobile after completion (with small delay for user to see result)
  useEffect(() => {
    if (isMobile && isComplete && !error) {
      const timer = setTimeout(() => {
        onOpenChange(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isMobile, isComplete, error, onOpenChange]);

  // Mobile: Show centered overlay in middle of screen
  if (isMobile) {
    if (!open) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-in fade-in duration-200">
        <div className="bg-background rounded-lg shadow-lg p-4 mx-4 w-full max-w-sm space-y-3 animate-in zoom-in-95 duration-200">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {!isComplete && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              <span className="text-sm font-medium">
                {isComplete
                  ? error
                    ? "Transfer failed"
                    : "Transfer complete!"
                  : `${operation === "copy" ? "Copying" : "Moving"}...`}
              </span>
            </div>
            {isComplete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => onOpenChange(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-xs">
              <AlertCircle className="h-3 w-3 shrink-0" />
              <span className="truncate">{error}</span>
            </div>
          )}

          {/* Progress info */}
          {progress && !error && (
            <div className="space-y-2">
              {/* Overall progress bar */}
              <Progress value={(progress.current / progress.total) * 100} className="h-2" />

              {/* Stats row */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate max-w-[50%]">{progress.currentFile}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span>{progress.current}/{progress.total}</span>
                  {progress.bytesPerSecond !== undefined && progress.bytesPerSecond > 0 && (
                    <span>{formatBytes(progress.bytesPerSecond)}/s</span>
                  )}
                </div>
              </div>

              {/* Byte progress */}
              {progress.bytesTotal !== undefined && progress.bytesTotal > 0 && (
                <div className="space-y-1">
                  <Progress
                    value={(progress.bytesCopied ?? 0) / progress.bytesTotal * 100}
                    className="h-1.5"
                  />
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{formatBytes(progress.bytesCopied ?? 0)} / {formatBytes(progress.bytesTotal)}</span>
                    <span>{Math.round((progress.bytesCopied ?? 0) / progress.bytesTotal * 100)}%</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Desktop: Show dialog
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => !isComplete && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {operation === "copy" ? "Copying" : "Moving"} Files
          </DialogTitle>
          <DialogDescription>
            {isComplete
              ? error
                ? "Transfer failed"
                : "Transfer complete"
              : `${operation === "copy" ? "Copying" : "Moving"} ${files.length} file${files.length !== 1 ? "s" : ""}...`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {progress && !error && (
            <div className="space-y-3">
              {/* Overall progress */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {operation === "copy" ? "Copying" : "Moving"} files...
                  </span>
                  <span className="font-medium">
                    {progress.current} / {progress.total}
                  </span>
                </div>
                <Progress value={(progress.current / progress.total) * 100} className="h-2" />
              </div>

              {/* Current file */}
              <p className="text-xs text-muted-foreground truncate">
                {progress.currentFile}
              </p>

              {/* Byte-level progress */}
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

              {/* Failed count */}
              {progress.failed > 0 && (
                <p className="text-xs text-destructive">
                  {progress.failed} failed
                </p>
              )}
            </div>
          )}

          {isComplete && !error && (
            <div className="flex justify-end">
              <Button onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
