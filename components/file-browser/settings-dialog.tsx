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
import { Plus, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Language, MovieFolderStructure, BaseFolder } from "@/types/config";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  seriesBaseFolders: BaseFolder[];
  onSeriesBaseFoldersChange: (folders: BaseFolder[]) => void;
  moviesBaseFolders: BaseFolder[];
  onMoviesBaseFoldersChange: (folders: BaseFolder[]) => void;
  movieFolderStructure: MovieFolderStructure;
  onMovieFolderStructureChange: (structure: MovieFolderStructure) => void;
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
  movieFolderStructure,
  onMovieFolderStructureChange,
  isLoading,
}: SettingsDialogProps) {
  const [newSeriesFolder, setNewSeriesFolder] = useState("");
  const [newMoviesFolder, setNewMoviesFolder] = useState("");

  const addSeriesFolder = () => {
    const trimmed = newSeriesFolder.trim();
    if (trimmed && !seriesBaseFolders.some(f => f.name === trimmed)) {
      onSeriesBaseFoldersChange([...seriesBaseFolders, { name: trimmed, preserveQualityInfo: false }]);
      setNewSeriesFolder("");
    }
  };

  const removeSeriesFolder = (folderName: string) => {
    onSeriesBaseFoldersChange(seriesBaseFolders.filter(f => f.name !== folderName));
  };

  const toggleSeriesFolderQuality = (folderName: string, preserve: boolean) => {
    onSeriesBaseFoldersChange(
      seriesBaseFolders.map(f => f.name === folderName ? { ...f, preserveQualityInfo: preserve } : f)
    );
  };

  const toggleSeriesFolderFFprobe = (folderName: string, alwaysUse: boolean) => {
    onSeriesBaseFoldersChange(
      seriesBaseFolders.map(f => f.name === folderName ? { ...f, alwaysUseFFprobe: alwaysUse } : f)
    );
  };

  const addMoviesFolder = () => {
    const trimmed = newMoviesFolder.trim();
    if (trimmed && !moviesBaseFolders.some(f => f.name === trimmed)) {
      onMoviesBaseFoldersChange([...moviesBaseFolders, { name: trimmed, preserveQualityInfo: false }]);
      setNewMoviesFolder("");
    }
  };

  const removeMoviesFolder = (folderName: string) => {
    onMoviesBaseFoldersChange(moviesBaseFolders.filter(f => f.name !== folderName));
  };

  const toggleMoviesFolderQuality = (folderName: string, preserve: boolean) => {
    onMoviesBaseFoldersChange(
      moviesBaseFolders.map(f => f.name === folderName ? { ...f, preserveQualityInfo: preserve } : f)
    );
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
                      <button
                        type="button"
                        onClick={() => removeSeriesFolder(folder.name)}
                        className="hover:text-destructive shrink-0"
                        disabled={isLoading}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground">
                        <Checkbox
                          checked={folder.preserveQualityInfo}
                          onCheckedChange={(checked) => toggleSeriesFolderQuality(folder.name, checked === true)}
                          disabled={isLoading}
                          className="h-3.5 w-3.5"
                        />
                        <span>{language === "it" ? "Qualità" : "Quality"}</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground">
                        <Checkbox
                          checked={folder.alwaysUseFFprobe ?? false}
                          onCheckedChange={(checked) => toggleSeriesFolderFFprobe(folder.name, checked === true)}
                          disabled={isLoading || !folder.preserveQualityInfo}
                          className="h-3.5 w-3.5"
                        />
                        <span>{language === "it" ? "Usa FFprobe" : "Use FFprobe"}</span>
                      </label>
                    </div>
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
                      <button
                        type="button"
                        onClick={() => removeMoviesFolder(folder.name)}
                        className="hover:text-destructive shrink-0"
                        disabled={isLoading}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground">
                        <Checkbox
                          checked={folder.preserveQualityInfo}
                          onCheckedChange={(checked) => toggleMoviesFolderQuality(folder.name, checked === true)}
                          disabled={isLoading}
                          className="h-3.5 w-3.5"
                        />
                        <span>{language === "it" ? "Qualità" : "Quality"}</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground">
                        <Checkbox
                          checked={folder.alwaysUseFFprobe ?? false}
                          onCheckedChange={(checked) => toggleMoviesFolderFFprobe(folder.name, checked === true)}
                          disabled={isLoading || !folder.preserveQualityInfo}
                          className="h-3.5 w-3.5"
                        />
                        <span>{language === "it" ? "Usa FFprobe" : "Use FFprobe"}</span>
                      </label>
                    </div>
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

          {/* Movie folder structure */}
          <div className="space-y-2">
            <Label>
              {language === "it" ? "Struttura cartelle film" : "Movie Folder Structure"}
            </Label>
            <p className="text-xs text-muted-foreground">
              {language === "it"
                ? "Come organizzare i file dei film nella cartella di destinazione"
                : "How to organize movie files in the destination folder"}
            </p>
            <Select
              value={movieFolderStructure}
              onValueChange={(value) => onMovieFolderStructureChange(value as MovieFolderStructure)}
              disabled={isLoading}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">
                  <div className="flex flex-col items-start">
                    <span>{language === "it" ? "Per nome" : "By Name"}</span>
                    <span className="text-xs text-muted-foreground">
                      {language === "it"
                        ? "Film/Nome Film (2025)/Nome Film (2025).mkv"
                        : "Movies/Movie Name (2025)/Movie Name (2025).mkv"}
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="year">
                  <div className="flex flex-col items-start">
                    <span>{language === "it" ? "Per anno" : "By Year"}</span>
                    <span className="text-xs text-muted-foreground">
                      {language === "it"
                        ? "Film/2025/Nome Film (2025).mkv"
                        : "Movies/2025/Movie Name (2025).mkv"}
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="none">
                  <div className="flex flex-col items-start">
                    <span>{language === "it" ? "Senza cartella" : "No Folder"}</span>
                    <span className="text-xs text-muted-foreground">
                      {language === "it"
                        ? "Film/Nome Film (2025).mkv"
                        : "Movies/Movie Name (2025).mkv"}
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-col gap-2">
          <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            OK
          </Button>
          {process.env.NEXT_PUBLIC_VERSION && (
            <p className="text-xs text-muted-foreground text-center w-full">
              v{process.env.NEXT_PUBLIC_VERSION}
            </p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
