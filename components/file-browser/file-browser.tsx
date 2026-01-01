"use client";

import { useState, useRef, useCallback, memo } from "react";
import { showSuccessToast, showErrorToast } from "@/components/ui/toast";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";
import { useFileBrowser } from "@/hooks/use-file-browser";
import { useConfig } from "@/hooks/use-config";
import { CreateFolderDialog } from "./create-folder-dialog";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import { RenameDialog } from "./rename-dialog";
import { DestinationPicker } from "./destination-picker";
import { TransferConfirmDialog } from "./transfer-confirm-dialog";
import { OverwriteConfirmDialog } from "./overwrite-confirm-dialog";
import { TransferChoiceDialog } from "./transfer-choice-dialog";
import { TransferProgressDialog } from "./transfer-progress-dialog";
import { IdentifyDialog } from "./identify-dialog";
import { BatchIdentifyDialog } from "./batch-identify-dialog";
import { SettingsDialog } from "./settings-dialog";
import { RenameChoiceDialog } from "./rename-choice-dialog";
import type { PaneType, OperationResponse, FileEntry } from "@/types/files";

interface PaneRef {
  refresh: () => void;
  clearSelection: () => void;
  currentPath: string;
}

interface FileBrowserProps {
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}

export function FileBrowser({ settingsOpen, onSettingsOpenChange }: FileBrowserProps) {
  const isMobile = useIsMobile();
  const { config, setLanguage, updateConfig, isLoading: configLoading } = useConfig();
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderPath, setCreateFolderPath] = useState("/");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePane, setDeletePane] = useState<PaneType>("downloads");
  const [deletePaths, setDeletePaths] = useState<string[]>([]);
  const [destinationPickerOpen, setDestinationPickerOpen] = useState(false);
  const [transferConfirmOpen, setTransferConfirmOpen] = useState(false);
  const [transferOperation, setTransferOperation] = useState<"copy" | "move">("copy");
  const [transferPaths, setTransferPaths] = useState<string[]>([]);
  const [transferDestination, setTransferDestination] = useState("/");
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false);
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [transferChoiceOpen, setTransferChoiceOpen] = useState(false);
  const [transferProgressOpen, setTransferProgressOpen] = useState(false);
  const [transferProgressOverwrite, setTransferProgressOverwrite] = useState(false);
  const [identifyDialogOpen, setIdentifyDialogOpen] = useState(false);
  const [batchIdentifyDialogOpen, setBatchIdentifyDialogOpen] = useState(false);
  const [identifyFileName, setIdentifyFileName] = useState("");
  const [identifyFilePath, setIdentifyFilePath] = useState("");
  const [identifyFilePaths, setIdentifyFilePaths] = useState<string[]>([]);
  const [identifyOperation, setIdentifyOperation] = useState<"copy" | "move" | "rename">("move");

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renamePane, setRenamePane] = useState<PaneType>("downloads");
  const [renamePath, setRenamePath] = useState("");
  const [renameCurrentName, setRenameCurrentName] = useState("");

  // Rename choice dialog state (for choosing between normal rename and TVDB rename)
  const [renameChoiceOpen, setRenameChoiceOpen] = useState(false);
  const [renameChoicePaths, setRenameChoicePaths] = useState<string[]>([]);
  const [renameChoiceEntries, setRenameChoiceEntries] = useState<FileEntry[]>([]);

  // Mobile view state - which pane to show
  const [mobileActivePane, setMobileActivePane] = useState<PaneType>("downloads");

  // Loading states
  const [isOperationLoading, setIsOperationLoading] = useState(false);

  // Refs for refreshing panes and getting current path
  const downloadsPaneRef = useRef<PaneRef | null>(null);
  const mediaPaneRef = useRef<PaneRef | null>(null);

  // Handle copy from downloads - show choice dialog
  const handleCopy = useCallback((selectedPaths: string[], entries: FileEntry[]) => {
    const destinationPath = mediaPaneRef.current?.currentPath || "/";
    setTransferPaths(selectedPaths);
    setTransferOperation("copy");
    setTransferDestination(destinationPath);

    // Store file info for potential identify
    setIdentifyFilePaths(selectedPaths);
    if (selectedPaths.length === 1) {
      const entry = entries.find((e) => e.path === selectedPaths[0]);
      if (entry) {
        setIdentifyFileName(entry.name);
        setIdentifyFilePath(entry.path);
      }
    } else {
      // For multiple files, use first entry's name as display
      const firstEntry = entries.find((e) => e.path === selectedPaths[0]);
      setIdentifyFileName(firstEntry ? `${firstEntry.name} and ${selectedPaths.length - 1} more` : `${selectedPaths.length} items`);
      setIdentifyFilePath(selectedPaths[0]);
    }

    setTransferChoiceOpen(true);
  }, []);

  // Handle move from downloads - show choice dialog
  const handleMove = useCallback((selectedPaths: string[], entries: FileEntry[]) => {
    const destinationPath = mediaPaneRef.current?.currentPath || "/";
    setTransferPaths(selectedPaths);
    setTransferOperation("move");
    setTransferDestination(destinationPath);

    // Store file info for potential identify
    setIdentifyFilePaths(selectedPaths);
    if (selectedPaths.length === 1) {
      const entry = entries.find((e) => e.path === selectedPaths[0]);
      if (entry) {
        setIdentifyFileName(entry.name);
        setIdentifyFilePath(entry.path);
      }
    } else {
      // For multiple files, use first entry's name as display
      const firstEntry = entries.find((e) => e.path === selectedPaths[0]);
      setIdentifyFileName(firstEntry ? `${firstEntry.name} and ${selectedPaths.length - 1} more` : `${selectedPaths.length} items`);
      setIdentifyFilePath(selectedPaths[0]);
    }

    setTransferChoiceOpen(true);
  }, []);

  // Handle normal transfer choice (without identify)
  const handleNormalTransfer = useCallback(() => {
    setTransferChoiceOpen(false);
    if (isMobile) {
      setDestinationPickerOpen(true);
    } else {
      setTransferConfirmOpen(true);
    }
  }, [isMobile]);

  // Handle identify choice
  const handleIdentifyChoice = useCallback(() => {
    setTransferChoiceOpen(false);
    setIdentifyOperation(transferOperation);
    setIdentifyDialogOpen(true);
  }, [transferOperation]);

  // Handle batch identify choice (for multiple movies)
  const handleBatchIdentifyChoice = useCallback(() => {
    setTransferChoiceOpen(false);
    setIdentifyOperation(transferOperation);
    setBatchIdentifyDialogOpen(true);
  }, [transferOperation]);

  // Handle rename button click - show choice dialog
  const handleRenameWithChoice = useCallback((pane: PaneType, selectedPaths: string[], entries: FileEntry[]) => {
    setRenamePane(pane);
    setRenameChoicePaths(selectedPaths);
    setRenameChoiceEntries(entries);

    // Store file info for potential identify
    setIdentifyFilePaths(selectedPaths);
    if (selectedPaths.length === 1) {
      const entry = entries.find((e) => e.path === selectedPaths[0]);
      if (entry) {
        setIdentifyFileName(entry.name);
        setIdentifyFilePath(entry.path);
        setRenamePath(entry.path);
        setRenameCurrentName(entry.name);
      }
    } else {
      const firstEntry = entries.find((e) => e.path === selectedPaths[0]);
      setIdentifyFileName(firstEntry ? `${firstEntry.name} and ${selectedPaths.length - 1} more` : `${selectedPaths.length} items`);
      setIdentifyFilePath(selectedPaths[0]);
    }

    setRenameChoiceOpen(true);
  }, []);

  // Handle normal rename choice (classic rename dialog)
  const handleNormalRenameChoice = useCallback(() => {
    setRenameChoiceOpen(false);
    setRenameDialogOpen(true);
  }, []);

  // Handle TVDB rename choice (single item)
  const handleTvdbRenameChoice = useCallback(() => {
    setRenameChoiceOpen(false);
    setIdentifyOperation("rename");
    setIdentifyDialogOpen(true);
  }, []);

  // Handle batch TVDB rename choice (multiple items)
  const handleBatchTvdbRenameChoice = useCallback(() => {
    setRenameChoiceOpen(false);
    setIdentifyOperation("rename");
    setBatchIdentifyDialogOpen(true);
  }, []);

  // Handle batch identify confirm
  const handleBatchIdentifyConfirm = useCallback(() => {
    const actionText = identifyOperation === "copy" ? "copied" : identifyOperation === "move" ? "moved" : "renamed";
    showSuccessToast(`Files ${actionText} successfully`, "");
    setBatchIdentifyDialogOpen(false);
    downloadsPaneRef.current?.clearSelection();
    downloadsPaneRef.current?.refresh();
    if (identifyOperation !== "rename") {
      mediaPaneRef.current?.refresh();
    }
  }, [identifyOperation]);

  // Check for conflicts before transfer
  const checkConflicts = useCallback(async (
    sourcePaths: string[],
    destinationPath: string
  ): Promise<string[]> => {
    try {
      const response = await fetch("/api/files/check-exists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePaths, destinationPath }),
      });

      const data = await response.json();
      if (data.success && data.conflicts) {
        return data.conflicts;
      }
    } catch {
      // If check fails, proceed without conflict detection
    }
    return [];
  }, []);

  // Execute transfer (copy or move) - opens progress dialog
  const executeTransfer = useCallback((
    destinationPath: string,
    sourcePaths: string[],
    operation: "copy" | "move",
    overwrite: boolean = false
  ) => {
    // Store transfer info and open progress dialog
    setTransferPaths(sourcePaths);
    setTransferOperation(operation);
    setTransferDestination(destinationPath);
    setTransferProgressOverwrite(overwrite);
    setDestinationPickerOpen(false);
    setTransferConfirmOpen(false);
    setOverwriteConfirmOpen(false);
    setIsOperationLoading(false); // Reset loading state - progress dialog handles its own state
    setTransferProgressOpen(true);
  }, []);

  // Handle transfer progress complete
  const handleTransferProgressComplete = useCallback((success: boolean, message: string) => {
    if (success) {
      showSuccessToast(message, "");
      downloadsPaneRef.current?.clearSelection();
      downloadsPaneRef.current?.refresh();
      mediaPaneRef.current?.refresh();
    } else {
      showErrorToast(message, "");
    }
  }, []);

  // Confirm transfer (copy or move) - checks for conflicts first
  const handleConfirmTransfer = useCallback(async (
    destinationPath: string,
    sourcePaths?: string[],
    operation?: "copy" | "move"
  ) => {
    const paths = sourcePaths || transferPaths;
    const op = operation || transferOperation;

    // Store for later use if overwrite is confirmed
    setTransferPaths(paths);
    setTransferOperation(op);
    setTransferDestination(destinationPath);

    setIsOperationLoading(true);

    // Check for conflicts
    const conflicts = await checkConflicts(paths, destinationPath);

    if (conflicts.length > 0) {
      // Show overwrite dialog
      setConflictFiles(conflicts);
      setOverwriteConfirmOpen(true);
      setIsOperationLoading(false);
      return;
    }

    // No conflicts, proceed with transfer
    await executeTransfer(destinationPath, paths, op, false);
  }, [transferPaths, transferOperation, checkConflicts, executeTransfer]);

  // Handle overwrite confirmation
  const handleConfirmOverwrite = useCallback(async () => {
    await executeTransfer(transferDestination, transferPaths, transferOperation, true);
  }, [executeTransfer, transferDestination, transferPaths, transferOperation]);

  // Handle overwrite cancel
  const handleCancelOverwrite = useCallback(() => {
    setOverwriteConfirmOpen(false);
    setConflictFiles([]);
  }, []);

  // Handle identify confirm - batch operation is already done by the dialog
  // Just close the dialog and refresh both panes
  // hasErrors is passed when there were folder rename errors (files succeeded but folders failed)
  const handleIdentifyConfirm = useCallback((newPath: string, hasErrors?: boolean) => {
    // Only show success toast if there were no errors
    // (error toast is shown by the dialog itself)
    if (!hasErrors) {
      const actionText = identifyOperation === "copy" ? "copied" : identifyOperation === "move" ? "moved" : "renamed";
      showSuccessToast(`Files ${actionText} successfully`, "");
    }
    setIdentifyDialogOpen(false);

    if (identifyOperation === "rename") {
      // For rename, refresh the pane where the rename happened
      if (renamePane === "downloads") {
        downloadsPaneRef.current?.clearSelection();
        downloadsPaneRef.current?.refresh();
      } else {
        mediaPaneRef.current?.clearSelection();
        mediaPaneRef.current?.refresh();
      }
    } else {
      // For copy/move, refresh both panes
      downloadsPaneRef.current?.clearSelection();
      downloadsPaneRef.current?.refresh();
      mediaPaneRef.current?.refresh();
    }
  }, [identifyOperation, renamePane]);

  // Handle delete
  const handleDelete = useCallback((pane: PaneType, paths: string[]) => {
    setDeletePane(pane);
    setDeletePaths(paths);
    setIsOperationLoading(false); // Reset loading state when opening delete dialog
    setDeleteConfirmOpen(true);
  }, []);

  // Confirm delete
  const handleConfirmDelete = useCallback(async () => {
    setIsOperationLoading(true);

    try {
      const response = await fetch("/api/files/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pane: deletePane,
          paths: deletePaths,
        }),
      });

      const data: OperationResponse = await response.json();

      if (data.success) {
        showSuccessToast(data.message || "Deleted successfully", "");
        setDeleteConfirmOpen(false);
        if (deletePane === "downloads") {
          downloadsPaneRef.current?.clearSelection();
          downloadsPaneRef.current?.refresh();
        } else {
          mediaPaneRef.current?.clearSelection();
          mediaPaneRef.current?.refresh();
        }
      } else {
        showErrorToast(data.error || "Delete failed", "");
      }
    } catch {
      showErrorToast("Failed to delete items", "");
    } finally {
      setIsOperationLoading(false);
    }
  }, [deletePane, deletePaths]);

  // Handle create folder
  const handleCreateFolder = useCallback((path: string) => {
    setCreateFolderPath(path);
    setCreateFolderOpen(true);
  }, []);

  // Confirm rename
  const handleConfirmRename = useCallback(async (newName: string) => {
    setIsOperationLoading(true);

    try {
      const response = await fetch("/api/files/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pane: renamePane,
          oldPath: renamePath,
          newName,
        }),
      });

      const data: OperationResponse = await response.json();

      if (data.success) {
        showSuccessToast(data.message || "Renamed successfully", "");
        setRenameDialogOpen(false);
        if (renamePane === "downloads") {
          downloadsPaneRef.current?.clearSelection();
          downloadsPaneRef.current?.refresh();
        } else {
          mediaPaneRef.current?.clearSelection();
          mediaPaneRef.current?.refresh();
        }
      } else {
        showErrorToast(data.error || "Rename failed", "");
      }
    } catch {
      showErrorToast("Failed to rename", "");
    } finally {
      setIsOperationLoading(false);
    }
  }, [renamePane, renamePath]);

  // Confirm create folder
  const handleConfirmCreateFolder = useCallback(async (name: string) => {
    setIsOperationLoading(true);

    try {
      const response = await fetch("/api/files/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: createFolderPath,
          name,
        }),
      });

      const data: OperationResponse = await response.json();

      if (data.success) {
        showSuccessToast(data.message || "Folder created", "");
        setCreateFolderOpen(false);
        mediaPaneRef.current?.refresh();
      } else {
        showErrorToast(data.error || "Failed to create folder", "");
      }
    } catch {
      showErrorToast("Failed to create folder", "");
    } finally {
      setIsOperationLoading(false);
    }
  }, [createFolderPath]);

  // Ref setters
  const setDownloadsPaneRef = useCallback((ref: PaneRef | null) => {
    downloadsPaneRef.current = ref;
  }, []);

  const setMediaPaneRef = useCallback((ref: PaneRef | null) => {
    mediaPaneRef.current = ref;
  }, []);

  return (
    <div className="h-full flex flex-col">
      {isMobile ? (
        // Mobile: Show toggle and selected pane
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile pane toggle */}
          <div className="flex border-b bg-muted/30">
            <button
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                mobileActivePane === "downloads"
                  ? "bg-background border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMobileActivePane("downloads")}
            >
              Downloads
            </button>
            <button
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                mobileActivePane === "media"
                  ? "bg-background border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMobileActivePane("media")}
            >
              Media
            </button>
          </div>
          {/* Active pane content - both panes stay mounted to preserve state */}
          <div className={`flex-1 overflow-hidden ${mobileActivePane === "downloads" ? "" : "hidden"}`}>
            <FilePane
              pane="downloads"
              onCopy={handleCopy}
              onMove={handleMove}
              onDelete={handleDelete}
              onRename={handleRenameWithChoice}
              paneRef={setDownloadsPaneRef}
            />
          </div>
          <div className={`flex-1 overflow-hidden ${mobileActivePane === "media" ? "" : "hidden"}`}>
            <FilePane
              pane="media"
              onDelete={handleDelete}
              onRename={handleRenameWithChoice}
              onCreateFolder={handleCreateFolder}
              paneRef={setMediaPaneRef}
            />
          </div>
        </div>
      ) : (
        // Desktop: Show both panes with resizable split
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full border-r">
              <div className="bg-muted/50 px-3 py-2 border-b font-medium text-sm">
                Downloads
              </div>
              <div className="h-[calc(100%-37px)] overflow-hidden">
                <FilePane
                  pane="downloads"
                  onCopy={handleCopy}
                  onMove={handleMove}
                  onDelete={handleDelete}
                  onRename={handleRenameWithChoice}
                  paneRef={setDownloadsPaneRef}
                />
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full">
              <div className="bg-muted/50 px-3 py-2 border-b font-medium text-sm">
                Media
              </div>
              <div className="h-[calc(100%-37px)] overflow-hidden">
                <FilePane
                  pane="media"
                  onDelete={handleDelete}
                  onRename={handleRenameWithChoice}
                  onCreateFolder={handleCreateFolder}
                  paneRef={setMediaPaneRef}
                />
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {/* Dialogs */}
      <TransferChoiceDialog
        open={transferChoiceOpen}
        onOpenChange={setTransferChoiceOpen}
        operation={transferOperation}
        itemCount={transferPaths.length}
        onNormalTransfer={handleNormalTransfer}
        onIdentify={handleIdentifyChoice}
        onBatchIdentify={handleBatchIdentifyChoice}
      />

      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        onSubmit={handleConfirmCreateFolder}
        isLoading={isOperationLoading}
      />

      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        itemCount={deletePaths.length}
        onConfirm={handleConfirmDelete}
        isLoading={isOperationLoading}
      />

      <RenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        currentName={renameCurrentName}
        onSubmit={handleConfirmRename}
        isLoading={isOperationLoading}
      />

      <RenameChoiceDialog
        open={renameChoiceOpen}
        onOpenChange={setRenameChoiceOpen}
        itemCount={renameChoicePaths.length}
        onNormalRename={handleNormalRenameChoice}
        onIdentifyRename={handleTvdbRenameChoice}
        onBatchIdentifyRename={handleBatchTvdbRenameChoice}
      />

      <DestinationPicker
        open={destinationPickerOpen}
        onOpenChange={setDestinationPickerOpen}
        operation={transferOperation}
        selectedCount={transferPaths.length}
        onConfirm={handleConfirmTransfer}
        onCreateFolder={handleCreateFolder}
        isLoading={isOperationLoading}
        initialPath={transferDestination}
      />

      <TransferConfirmDialog
        open={transferConfirmOpen}
        onOpenChange={setTransferConfirmOpen}
        operation={transferOperation}
        itemCount={transferPaths.length}
        destinationPath={transferDestination}
        onConfirm={() => handleConfirmTransfer(transferDestination)}
        isLoading={isOperationLoading}
      />

      <OverwriteConfirmDialog
        open={overwriteConfirmOpen}
        onOpenChange={setOverwriteConfirmOpen}
        operation={transferOperation}
        conflicts={conflictFiles}
        onConfirm={handleConfirmOverwrite}
        onCancel={handleCancelOverwrite}
        isLoading={isOperationLoading}
      />

      <TransferProgressDialog
        open={transferProgressOpen}
        onOpenChange={setTransferProgressOpen}
        operation={transferOperation}
        files={transferPaths.map(sourcePath => ({
          sourcePath,
          destinationPath: `${transferDestination}/${sourcePath.split("/").pop() || sourcePath.split("\\").pop() || sourcePath}`.replace(/^\/+/, ""),
        }))}
        overwrite={transferProgressOverwrite}
        onComplete={handleTransferProgressComplete}
      />

      <IdentifyDialog
        open={identifyDialogOpen}
        onOpenChange={setIdentifyDialogOpen}
        fileName={identifyFileName}
        filePath={identifyFilePath}
        filePaths={identifyFilePaths}
        pane={identifyOperation === "rename" ? renamePane : "downloads"}
        operation={identifyOperation}
        onConfirm={handleIdentifyConfirm}
        isLoading={isOperationLoading}
        language={config.language}
        seriesBaseFolders={config.seriesBaseFolders}
        moviesBaseFolders={config.moviesBaseFolders}
        seriesNamingTemplate={config.seriesNamingTemplate}
        movieNamingTemplate={config.movieNamingTemplate}
      />

      <BatchIdentifyDialog
        open={batchIdentifyDialogOpen}
        onOpenChange={setBatchIdentifyDialogOpen}
        filePaths={identifyFilePaths}
        pane={identifyOperation === "rename" ? renamePane : "downloads"}
        operation={identifyOperation}
        onConfirm={handleBatchIdentifyConfirm}
        isLoading={isOperationLoading}
        language={config.language}
        moviesBaseFolders={config.moviesBaseFolders}
        movieNamingTemplate={config.movieNamingTemplate}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
        language={config.language}
        onLanguageChange={setLanguage}
        seriesBaseFolders={config.seriesBaseFolders}
        onSeriesBaseFoldersChange={(folders) => updateConfig({ seriesBaseFolders: folders })}
        moviesBaseFolders={config.moviesBaseFolders}
        onMoviesBaseFoldersChange={(folders) => updateConfig({ moviesBaseFolders: folders })}
        seriesNamingTemplate={config.seriesNamingTemplate}
        onSeriesNamingTemplateChange={(template) => updateConfig({ seriesNamingTemplate: template })}
        movieNamingTemplate={config.movieNamingTemplate}
        onMovieNamingTemplateChange={(template) => updateConfig({ movieNamingTemplate: template })}
        qualityValues={config.qualityValues}
        onQualityValuesChange={(values) => updateConfig({ qualityValues: values })}
        codecValues={config.codecValues}
        onCodecValuesChange={(values) => updateConfig({ codecValues: values })}
        extraTagValues={config.extraTagValues}
        onExtraTagValuesChange={(values) => updateConfig({ extraTagValues: values })}
        isLoading={configLoading}
      />
    </div>
  );
}

// Memoized FilePane component to prevent re-renders
interface FilePaneProps {
  pane: PaneType;
  onCopy?: (paths: string[], entries: FileEntry[]) => void;
  onMove?: (paths: string[], entries: FileEntry[]) => void;
  onDelete: (pane: PaneType, paths: string[]) => void;
  onRename: (pane: PaneType, paths: string[], entries: FileEntry[]) => void;
  onCreateFolder?: (path: string) => void;
  paneRef: (ref: PaneRef | null) => void;
}

const FilePane = memo(function FilePane({
  pane,
  onCopy,
  onMove,
  onDelete,
  onRename,
  onCreateFolder,
  paneRef,
}: FilePaneProps) {
  const {
    currentPath,
    entries,
    selectedPaths,
    isLoading,
    error,
    navigate,
    refresh,
    toggleSelection,
    selectAll,
    clearSelection,
  } = useFileBrowser(pane);

  // Update ref whenever currentPath or refresh changes
  paneRef({ refresh, clearSelection, currentPath });

  const handleSelectAll = useCallback(() => {
    if (selectedPaths.size === entries.length) {
      clearSelection();
    } else {
      selectAll();
    }
  }, [selectedPaths.size, entries.length, clearSelection, selectAll]);

  // Get selected entries for rename
  const handleRenameClick = useCallback(() => {
    if (selectedPaths.size > 0) {
      const selectedPathsArray = Array.from(selectedPaths);
      const selectedEntries = entries.filter(e => selectedPaths.has(e.path));
      onRename(pane, selectedPathsArray, selectedEntries);
    }
  }, [selectedPaths, entries, onRename, pane]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b shrink-0 overflow-x-auto">
        {pane === "downloads" && (
          <>
            <button
              className="inline-flex items-center justify-center gap-1 whitespace-nowrap text-xs sm:text-sm font-medium h-8 px-2 sm:px-3 rounded-md hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
              disabled={selectedPaths.size === 0 || isLoading}
              onClick={() => onCopy?.(Array.from(selectedPaths), entries)}
            >
              Copy
            </button>
            <button
              className="inline-flex items-center justify-center gap-1 whitespace-nowrap text-xs sm:text-sm font-medium h-8 px-2 sm:px-3 rounded-md hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
              disabled={selectedPaths.size === 0 || isLoading}
              onClick={() => onMove?.(Array.from(selectedPaths), entries)}
            >
              Move
            </button>
          </>
        )}
        {pane === "media" && (
          <button
            className="inline-flex items-center justify-center gap-1 whitespace-nowrap text-xs sm:text-sm font-medium h-8 px-2 sm:px-3 rounded-md hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
            disabled={isLoading}
            onClick={() => onCreateFolder?.(currentPath)}
          >
            New Folder
          </button>
        )}
        <button
          className="inline-flex items-center justify-center gap-1 whitespace-nowrap text-xs sm:text-sm font-medium h-8 px-2 sm:px-3 rounded-md hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
          disabled={selectedPaths.size === 0 || isLoading}
          onClick={handleRenameClick}
          title="Rename"
        >
          Rename
        </button>
        <button
          className="inline-flex items-center justify-center gap-1 whitespace-nowrap text-xs sm:text-sm font-medium h-8 px-2 sm:px-3 rounded-md hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
          disabled={selectedPaths.size === 0 || isLoading}
          onClick={() => onDelete(pane, Array.from(selectedPaths))}
        >
          Delete
        </button>
        <div className="flex-1 min-w-2" />
        <button
          className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 shrink-0 cursor-pointer"
          disabled={isLoading}
          onClick={refresh}
        >
          <svg
            className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
        {selectedPaths.size > 0 && (
          <span className="text-xs text-muted-foreground ml-1 shrink-0">
            {selectedPaths.size}
          </span>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="px-2 sm:px-3 py-1.5 sm:py-2 border-b bg-muted/30 text-xs sm:text-sm shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          <button
            onClick={() => navigate("/")}
            className="hover:text-primary transition-colors shrink-0 cursor-pointer"
          >
            {pane === "downloads" ? "Downloads" : "Media"}
          </button>
          {currentPath !== "/" &&
            currentPath
              .split("/")
              .filter(Boolean)
              .map((segment, index, arr) => (
                <span key={index} className="flex items-center gap-1 shrink-0">
                  <span className="text-muted-foreground">/</span>
                  <button
                    onClick={() =>
                      navigate("/" + arr.slice(0, index + 1).join("/"))
                    }
                    className="hover:text-primary transition-colors max-w-30 sm:max-w-none truncate cursor-pointer"
                  >
                    {segment}
                  </button>
                </span>
              ))}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 min-h-0 overflow-auto">
        {error ? (
          <div className="flex items-center justify-center h-32 text-destructive">
            {error}
          </div>
        ) : isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-4 w-4 bg-muted rounded animate-pulse" />
                <div className="h-4 w-4 bg-muted rounded animate-pulse" />
                <div className="h-4 flex-1 bg-muted rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            This folder is empty
          </div>
        ) : (
          <FileList
            entries={entries}
            selectedPaths={selectedPaths}
            onToggleSelection={toggleSelection}
            onSelectAll={handleSelectAll}
            onNavigate={navigate}
          />
        )}
      </div>
    </div>
  );
});

// Memoized FileList component
interface FileListProps {
  entries: FileEntry[];
  selectedPaths: Set<string>;
  onToggleSelection: (path: string) => void;
  onSelectAll: () => void;
  onNavigate: (path: string) => void;
}

const FileList = memo(function FileList({
  entries,
  selectedPaths,
  onToggleSelection,
  onSelectAll,
  onNavigate,
}: FileListProps) {
  return (
    <table className="w-full">
      <thead className="sticky top-0 bg-background border-b">
        <tr>
          <th className="w-10 p-2">
            <input
              type="checkbox"
              checked={entries.length > 0 && selectedPaths.size === entries.length}
              onChange={onSelectAll}
              className="h-4 w-4"
            />
          </th>
          <th className="text-left p-2 text-sm font-medium">Name</th>
          <th className="text-right p-2 text-sm font-medium hidden sm:table-cell">
            Size
          </th>
          <th className="text-right p-2 text-sm font-medium hidden md:table-cell">
            Modified
          </th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <FileRow
            key={entry.path}
            entry={entry}
            isSelected={selectedPaths.has(entry.path)}
            onToggleSelection={onToggleSelection}
            onNavigate={onNavigate}
          />
        ))}
      </tbody>
    </table>
  );
});

// Memoized FileRow component
interface FileRowProps {
  entry: FileEntry;
  isSelected: boolean;
  onToggleSelection: (path: string) => void;
  onNavigate: (path: string) => void;
}

const FileRow = memo(function FileRow({
  entry,
  isSelected,
  onToggleSelection,
  onNavigate,
}: FileRowProps) {
  const handleClick = useCallback(() => {
    onToggleSelection(entry.path);
  }, [onToggleSelection, entry.path]);

  const handleDoubleClick = useCallback(() => {
    if (entry.type === "directory") {
      onNavigate(entry.path);
    }
  }, [onNavigate, entry.path, entry.type]);

  const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleCheckboxChange = useCallback(() => {
    onToggleSelection(entry.path);
  }, [onToggleSelection, entry.path]);

  return (
    <tr
      className={`cursor-pointer hover:bg-accent/50 transition-colors ${
        isSelected ? "bg-accent" : ""
      }`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <td className="w-10 p-2">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={handleCheckboxChange}
          onClick={handleCheckboxClick}
          className="h-4 w-4"
        />
      </td>
      <td className="p-2">
        <div className="flex items-center gap-2">
          <span
            className={
              entry.type === "directory"
                ? "text-blue-500"
                : "text-muted-foreground"
            }
          >
            {entry.type === "directory" ? "📁" : "📄"}
          </span>
          <span className="truncate">{entry.name}</span>
        </div>
      </td>
      <td className="text-right p-2 text-muted-foreground text-sm hidden sm:table-cell">
        {entry.type === "file" ? formatSize(entry.size) : "—"}
      </td>
      <td className="text-right p-2 text-muted-foreground text-sm hidden md:table-cell">
        {new Date(entry.modifiedAt).toLocaleDateString()}
      </td>
    </tr>
  );
});

function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}
