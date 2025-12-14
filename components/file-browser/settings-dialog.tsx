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
import type { Language, MovieFolderStructure } from "@/types/config";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  seriesBaseFolders: string[];
  onSeriesBaseFoldersChange: (folders: string[]) => void;
  moviesBaseFolders: string[];
  onMoviesBaseFoldersChange: (folders: string[]) => void;
  movieFolderStructure: MovieFolderStructure;
  onMovieFolderStructureChange: (structure: MovieFolderStructure) => void;
  preserveQualityInfo: boolean;
  onPreserveQualityInfoChange: (preserve: boolean) => void;
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
  preserveQualityInfo,
  onPreserveQualityInfoChange,
  isLoading,
}: SettingsDialogProps) {
  const [newSeriesFolder, setNewSeriesFolder] = useState("");
  const [newMoviesFolder, setNewMoviesFolder] = useState("");

  const addSeriesFolder = () => {
    const trimmed = newSeriesFolder.trim();
    if (trimmed && !seriesBaseFolders.includes(trimmed)) {
      onSeriesBaseFoldersChange([...seriesBaseFolders, trimmed]);
      setNewSeriesFolder("");
    }
  };

  const removeSeriesFolder = (folder: string) => {
    onSeriesBaseFoldersChange(seriesBaseFolders.filter(f => f !== folder));
  };

  const addMoviesFolder = () => {
    const trimmed = newMoviesFolder.trim();
    if (trimmed && !moviesBaseFolders.includes(trimmed)) {
      onMoviesBaseFoldersChange([...moviesBaseFolders, trimmed]);
      setNewMoviesFolder("");
    }
  };

  const removeMoviesFolder = (folder: string) => {
    onMoviesBaseFoldersChange(moviesBaseFolders.filter(f => f !== folder));
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
              <div className="flex flex-wrap gap-2">
                {seriesBaseFolders.map((folder) => (
                  <div
                    key={folder}
                    className="flex items-center gap-1 bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-sm"
                  >
                    <span>{folder}</span>
                    <button
                      type="button"
                      onClick={() => removeSeriesFolder(folder)}
                      className="hover:text-destructive"
                      disabled={isLoading}
                    >
                      <X className="h-3 w-3" />
                    </button>
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
              <div className="flex flex-wrap gap-2">
                {moviesBaseFolders.map((folder) => (
                  <div
                    key={folder}
                    className="flex items-center gap-1 bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-sm"
                  >
                    <span>{folder}</span>
                    <button
                      type="button"
                      onClick={() => removeMoviesFolder(folder)}
                      className="hover:text-destructive"
                      disabled={isLoading}
                    >
                      <X className="h-3 w-3" />
                    </button>
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
              </SelectContent>
            </Select>
          </div>

          {/* Preserve quality info */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Checkbox
                id="preserve-quality"
                checked={preserveQualityInfo}
                onCheckedChange={(checked) => onPreserveQualityInfoChange(checked === true)}
                disabled={isLoading}
              />
              <Label htmlFor="preserve-quality" className="cursor-pointer">
                {language === "it" ? "Mantieni info qualità" : "Preserve Quality Info"}
              </Label>
            </div>
            <p className="text-xs text-muted-foreground pl-7">
              {language === "it"
                ? "Mantiene qualità e codec nel nome del file (es. 1080p.H264)"
                : "Keep quality and codec in filename (e.g. 1080p.H264)"}
            </p>
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
