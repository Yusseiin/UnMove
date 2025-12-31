"use client";

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X, Settings2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { NamingTemplateDialog } from "./naming-template-dialog";
import type {
  Language,
  BaseFolder,
  SeriesNamingTemplate,
  MovieNamingTemplate,
} from "@/types/config";

// Deep comparison helper for templates
function templatesEqual<T>(a: T | undefined, b: T | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  seriesBaseFolders: BaseFolder[];
  onSeriesBaseFoldersChange: (folders: BaseFolder[]) => void;
  moviesBaseFolders: BaseFolder[];
  onMoviesBaseFoldersChange: (folders: BaseFolder[]) => void;
  // Global naming templates
  seriesNamingTemplate?: SeriesNamingTemplate;
  onSeriesNamingTemplateChange?: (template: SeriesNamingTemplate) => Promise<boolean> | void;
  movieNamingTemplate?: MovieNamingTemplate;
  onMovieNamingTemplateChange?: (template: MovieNamingTemplate) => Promise<boolean> | void;
  isLoading?: boolean;
}

export function SettingsDialog({
  open,
  onOpenChange,
  language,
  onLanguageChange,
  seriesBaseFolders,
  onSeriesBaseFoldersChange,
  moviesBaseFolders,
  onMoviesBaseFoldersChange,
  seriesNamingTemplate,
  onSeriesNamingTemplateChange,
  movieNamingTemplate,
  onMovieNamingTemplateChange,
  isLoading,
}: SettingsDialogProps) {
  const [newSeriesFolder, setNewSeriesFolder] = useState("");
  const [newMoviesFolder, setNewMoviesFolder] = useState("");

  // Naming template dialog state
  const [namingDialogOpen, setNamingDialogOpen] = useState(false);
  const [editingFolderType, setEditingFolderType] = useState<"series" | "movies" | null>(null);
  const [editingFolderName, setEditingFolderName] = useState<string | null>(null);

  // Open global naming template dialog
  const openGlobalNamingDialog = () => {
    setEditingFolderType(null);
    setEditingFolderName(null);
    setNamingDialogOpen(true);
  };

  // Open per-folder naming template dialog
  const openFolderNamingDialog = (folderType: "series" | "movies", folderName: string) => {
    setEditingFolderType(folderType);
    setEditingFolderName(folderName);
    setNamingDialogOpen(true);
  };

  // Get the current folder being edited (for per-folder dialogs)
  const getEditingFolder = () => {
    if (!editingFolderName) return null;
    const folders = editingFolderType === "series" ? seriesBaseFolders : moviesBaseFolders;
    return folders.find(f => f.name === editingFolderName);
  };

  // Handle naming template changes for per-folder overrides
  // If the template is identical to the global template, remove the override
  const handleFolderSeriesTemplateChange = (template: SeriesNamingTemplate) => {
    if (editingFolderName && editingFolderType === "series") {
      // Compare with global template - if equal, remove the override
      const isEqualToGlobal = templatesEqual(template, seriesNamingTemplate);
      onSeriesBaseFoldersChange(
        seriesBaseFolders.map(f =>
          f.name === editingFolderName
            ? { ...f, seriesNamingTemplate: isEqualToGlobal ? undefined : template }
            : f
        )
      );
    }
  };

  const handleFolderMovieTemplateChange = (template: MovieNamingTemplate) => {
    if (editingFolderName && editingFolderType === "movies") {
      // Compare with global template - if equal, remove the override
      const isEqualToGlobal = templatesEqual(template, movieNamingTemplate);
      onMoviesBaseFoldersChange(
        moviesBaseFolders.map(f =>
          f.name === editingFolderName
            ? { ...f, movieNamingTemplate: isEqualToGlobal ? undefined : template }
            : f
        )
      );
    }
  };

  // Clear per-folder override (revert to global)
  const clearFolderOverride = () => {
    if (editingFolderName && editingFolderType === "series") {
      onSeriesBaseFoldersChange(
        seriesBaseFolders.map(f =>
          f.name === editingFolderName ? { ...f, seriesNamingTemplate: undefined } : f
        )
      );
    } else if (editingFolderName && editingFolderType === "movies") {
      onMoviesBaseFoldersChange(
        moviesBaseFolders.map(f =>
          f.name === editingFolderName ? { ...f, movieNamingTemplate: undefined } : f
        )
      );
    }
  };

  const addSeriesFolder = () => {
    const trimmed = newSeriesFolder.trim();
    if (trimmed && !seriesBaseFolders.some(f => f.name === trimmed)) {
      onSeriesBaseFoldersChange([...seriesBaseFolders, { name: trimmed }]);
      setNewSeriesFolder("");
    }
  };

  const removeSeriesFolder = (folderName: string) => {
    onSeriesBaseFoldersChange(seriesBaseFolders.filter(f => f.name !== folderName));
  };

  const toggleSeriesFolderFFprobe = (folderName: string, alwaysUse: boolean) => {
    onSeriesBaseFoldersChange(
      seriesBaseFolders.map(f => f.name === folderName ? { ...f, alwaysUseFFprobe: alwaysUse } : f)
    );
  };

  const addMoviesFolder = () => {
    const trimmed = newMoviesFolder.trim();
    if (trimmed && !moviesBaseFolders.some(f => f.name === trimmed)) {
      onMoviesBaseFoldersChange([...moviesBaseFolders, { name: trimmed }]);
      setNewMoviesFolder("");
    }
  };

  const removeMoviesFolder = (folderName: string) => {
    onMoviesBaseFoldersChange(moviesBaseFolders.filter(f => f.name !== folderName));
  };

  const toggleMoviesFolderFFprobe = (folderName: string, alwaysUse: boolean) => {
    onMoviesBaseFoldersChange(
      moviesBaseFolders.map(f => f.name === folderName ? { ...f, alwaysUseFFprobe: alwaysUse } : f)
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent, addFn: () => void) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addFn();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-4 sm:p-6 max-h-[85dvh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            {language === "it"
              ? "Configura le preferenze dell'applicazione"
              : "Configure application preferences"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 flex-1 overflow-y-auto">
          {/* Language setting */}
          <div className="space-y-2">
            <Label htmlFor="language">Language / Lingua</Label>
            <Select
              value={language}
              onValueChange={(value) => onLanguageChange(value as Language)}
              disabled={isLoading}
            >
              <SelectTrigger id="language" className="w-full">
                <SelectValue placeholder="Select language..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">
                  <span className="flex items-center gap-2">
                    🇬🇧 English
                  </span>
                </SelectItem>
                <SelectItem value="it">
                  <span className="flex items-center gap-2">
                    🇮🇹 Italiano
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Global naming templates */}
          <div className="space-y-2">
            <Label>
              {language === "it" ? "Template di denominazione" : "Naming Templates"}
            </Label>
            <p className="text-xs text-muted-foreground">
              {language === "it"
                ? "Configura come vengono rinominati i file"
                : "Configure how files are renamed"}
            </p>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={openGlobalNamingDialog}
              disabled={isLoading}
            >
              <Settings2 className="h-4 w-4" />
              {language === "it" ? "Configura template..." : "Configure templates..."}
            </Button>
          </div>

          {/* Series base folders */}
          <div className="space-y-2">
            <Label>
              {language === "it" ? "Cartelle base Serie TV" : "TV Series Base Folders"}
            </Label>
            <p className="text-xs text-muted-foreground">
              {language === "it"
                ? "Aggiungi cartelle come 'Serie TV', 'Anime', ecc."
                : "Add folders like 'TV Series', 'Anime', etc."}
            </p>

            {/* Existing folders */}
            {seriesBaseFolders.length > 0 && (
              <div className="space-y-2">
                {seriesBaseFolders.map((folder) => (
                  <div
                    key={folder.name}
                    className="bg-secondary text-secondary-foreground px-3 py-2 rounded-md text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate flex-1 min-w-0">{folder.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openFolderNamingDialog("series", folder.name)}
                          className="hover:text-primary p-0.5"
                          disabled={isLoading}
                          title={language === "it" ? "Template denominazione" : "Naming template"}
                        >
                          <Settings2 className={`h-3 w-3 ${folder.seriesNamingTemplate ? "text-primary" : ""}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSeriesFolder(folder.name)}
                          className="hover:text-destructive p-0.5"
                          disabled={isLoading}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground">
                        <Checkbox
                          checked={folder.alwaysUseFFprobe ?? false}
                          onCheckedChange={(checked) => toggleSeriesFolderFFprobe(folder.name, checked === true)}
                          disabled={isLoading}
                          className="h-3.5 w-3.5"
                        />
                        <span>{language === "it" ? "Usa FFprobe" : "Use FFprobe"}</span>
                      </label>
                    </div>
                    {folder.seriesNamingTemplate && (
                      <p className="text-[10px] text-primary mt-1">
                        {language === "it" ? "Template personalizzato" : "Custom template"}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add new folder */}
            <div className="flex gap-2">
              <Input
                value={newSeriesFolder}
                onChange={(e) => setNewSeriesFolder(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, addSeriesFolder)}
                placeholder={language === "it" ? "es. Anime" : "e.g. Anime"}
                disabled={isLoading}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={addSeriesFolder}
                disabled={isLoading || !newSeriesFolder.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Movies base folders */}
          <div className="space-y-2">
            <Label>
              {language === "it" ? "Cartelle base Film" : "Movies Base Folders"}
            </Label>
            <p className="text-xs text-muted-foreground">
              {language === "it"
                ? "Aggiungi cartelle come 'Film', 'Documentari', ecc."
                : "Add folders like 'Movies', 'Documentaries', etc."}
            </p>

            {/* Existing folders */}
            {moviesBaseFolders.length > 0 && (
              <div className="space-y-2">
                {moviesBaseFolders.map((folder) => (
                  <div
                    key={folder.name}
                    className="bg-secondary text-secondary-foreground px-3 py-2 rounded-md text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate flex-1 min-w-0">{folder.name}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => openFolderNamingDialog("movies", folder.name)}
                          className="hover:text-primary p-0.5"
                          disabled={isLoading}
                          title={language === "it" ? "Template denominazione" : "Naming template"}
                        >
                          <Settings2 className={`h-3 w-3 ${folder.movieNamingTemplate ? "text-primary" : ""}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMoviesFolder(folder.name)}
                          className="hover:text-destructive p-0.5"
                          disabled={isLoading}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground">
                        <Checkbox
                          checked={folder.alwaysUseFFprobe ?? false}
                          onCheckedChange={(checked) => toggleMoviesFolderFFprobe(folder.name, checked === true)}
                          disabled={isLoading}
                          className="h-3.5 w-3.5"
                        />
                        <span>{language === "it" ? "Usa FFprobe" : "Use FFprobe"}</span>
                      </label>
                    </div>
                    {folder.movieNamingTemplate && (
                      <p className="text-[10px] text-primary mt-1">
                        {language === "it" ? "Template personalizzato" : "Custom template"}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Add new folder */}
            <div className="flex gap-2">
              <Input
                value={newMoviesFolder}
                onChange={(e) => setNewMoviesFolder(e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, addMoviesFolder)}
                placeholder={language === "it" ? "es. Documentari" : "e.g. Documentaries"}
                disabled={isLoading}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={addMoviesFolder}
                disabled={isLoading || !newMoviesFolder.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

        </div>

        <DialogFooter className="shrink-0 gap-2">
          <div className="flex w-full items-center">
            <div className="flex-1" />
            {process.env.NEXT_PUBLIC_VERSION && (
              <p className="text-xs text-muted-foreground flex-1 text-center">
                v{process.env.NEXT_PUBLIC_VERSION}
              </p>
            )}
            <div className="flex-1 flex justify-end">
              <Button onClick={async () => {
                onOpenChange(false);
                // Small delay to ensure any pending config saves complete before reload
                await new Promise(resolve => setTimeout(resolve, 300));
                // Reload page to ensure all components pick up any config changes
                window.location.reload();
              }} className="w-full sm:w-auto">
                OK
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>

      {/* Naming Template Dialog */}
      <NamingTemplateDialog
        open={namingDialogOpen}
        onOpenChange={setNamingDialogOpen}
        language={language}
        // For global templates (when no folder is being edited)
        seriesTemplate={
          editingFolderName
            ? getEditingFolder()?.seriesNamingTemplate || seriesNamingTemplate
            : seriesNamingTemplate
        }
        movieTemplate={
          editingFolderName
            ? getEditingFolder()?.movieNamingTemplate || movieNamingTemplate
            : movieNamingTemplate
        }
        onSeriesTemplateChange={
          editingFolderName && editingFolderType === "series"
            ? handleFolderSeriesTemplateChange
            : onSeriesNamingTemplateChange
        }
        onMovieTemplateChange={
          editingFolderName && editingFolderType === "movies"
            ? handleFolderMovieTemplateChange
            : onMovieNamingTemplateChange
        }
        // Per-folder editing
        folderType={editingFolderType || undefined}
        folderName={editingFolderName || undefined}
        isPerFolderOverride={
          editingFolderName
            ? editingFolderType === "series"
              ? !!getEditingFolder()?.seriesNamingTemplate
              : !!getEditingFolder()?.movieNamingTemplate
            : false
        }
        onClearOverride={editingFolderName ? clearFolderOverride : undefined}
        // Pass global templates so reset button can use them for per-folder overrides
        globalSeriesTemplate={seriesNamingTemplate}
        globalMovieTemplate={movieNamingTemplate}
      />
    </Dialog>
  );
}
