"use client";

import { useState, useEffect, useMemo } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { RotateCcw, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  Language,
  SeriesNamingTemplate,
  MovieNamingTemplate,
  MovieFolderStructure,
} from "@/types/config";
import {
  defaultSeriesNamingTemplate,
  defaultMovieNamingTemplate,
} from "@/types/config";

interface NamingTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: Language;
  // For editing global templates
  seriesTemplate?: SeriesNamingTemplate;
  movieTemplate?: MovieNamingTemplate;
  onSeriesTemplateChange?: (template: SeriesNamingTemplate) => Promise<boolean> | void;
  onMovieTemplateChange?: (template: MovieNamingTemplate) => Promise<boolean> | void;
  // For editing a specific folder (shows which type)
  folderType?: "series" | "movies";
  folderName?: string;
  // If true, we're editing a per-folder override
  isPerFolderOverride?: boolean;
  // Callback to clear per-folder override (revert to global)
  onClearOverride?: () => void;
  // Global templates (for resetting per-folder overrides to match global)
  globalSeriesTemplate?: SeriesNamingTemplate;
  globalMovieTemplate?: MovieNamingTemplate;
}

// Token definitions with descriptions
const SERIES_TOKENS = [
  { token: "{seriesName}", description: "Series name", example: "Breaking Bad" },
  { token: "{seriesYear}", description: "Series year", example: "2008" },
  { token: "{season}", description: "Season number (padded)", example: "01" },
  { token: "{episode}", description: "Episode number (padded)", example: "05" },
  { token: "{episodeTitle}", description: "Episode title", example: "Pilot" },
  { token: "{quality}", description: "Resolution", example: "1080p" },
  { token: "{codec}", description: "Video codec", example: "H264" },
  { token: "{extraTags}", description: "Extra tags (HDR, 10bit, ITA...)", example: "10bit.HDR" },
] as const;

const MOVIE_TOKENS = [
  { token: "{movieName}", description: "Movie name", example: "Inception" },
  { token: "{year}", description: "Movie year", example: "2010" },
  { token: "{quality}", description: "Resolution", example: "1080p" },
  { token: "{codec}", description: "Video codec", example: "H264" },
  { token: "{extraTags}", description: "Extra tags (HDR, 10bit, ITA...)", example: "10bit.HDR" },
] as const;

// Example data for preview
const EXAMPLE_SERIES = {
  seriesName: "Breaking Bad",
  seriesYear: "2008",
  season: 1,
  episode: 5,
  episodeTitle: "Gray Matter",
  quality: "1080p",
  codec: "H264",
  extraTags: "10bit.HDR",
  ext: "mkv",
};

const EXAMPLE_MOVIE = {
  movieName: "Inception",
  year: "2010",
  quality: "1080p",
  codec: "H264",
  extraTags: "10bit.HDR",
  ext: "mkv",
};

// Apply template with example data
function applySeriesTemplate(
  template: SeriesNamingTemplate,
  data: typeof EXAMPLE_SERIES
): { folder: string; file: string; full: string } {
  const padNumber = (n: number, padding: number) =>
    n.toString().padStart(padding, "0");

  const seasonPadded = padNumber(data.season, template.seasonPadding);
  const episodePadded = padNumber(data.episode, template.episodePadding);

  const seasonFolder =
    data.season === 0
      ? template.specialsFolderTemplate
      : template.seasonFolderTemplate.replace("{season}", seasonPadded);

  const replaceTokens = (str: string): string => {
    return str
      .replace(/\{seriesName\}/g, data.seriesName)
      .replace(/\{seriesYear\}/g, data.seriesYear)
      .replace(/\{season\}/g, seasonPadded)
      .replace(/\{episode\}/g, episodePadded)
      .replace(/\{episodeTitle\}/g, data.episodeTitle)
      .replace(/\{quality\}/g, data.quality)
      .replace(/\{codec\}/g, data.codec)
      .replace(/\{extraTags\}/g, data.extraTags)
      // Clean up empty parentheses/brackets from missing values
      .replace(/\s*\(\s*\)/g, "")
      .replace(/\s*\[\s*\]/g, "")
      // Clean up trailing/leading separators
      .replace(/\s+-\s*$/g, "")
      .replace(/^\s*-\s+/g, "")
      // Clean up multiple consecutive spaces
      .replace(/\s+/g, " ")
      .trim();
  };

  const folder = replaceTokens(template.folderTemplate);
  const file = replaceTokens(template.fileTemplate).trim() + `.${data.ext}`;

  return {
    folder,
    file,
    full: `${folder}/${seasonFolder}/${file}`,
  };
}

function applyMovieTemplate(
  template: MovieNamingTemplate,
  data: typeof EXAMPLE_MOVIE
): { folder: string; file: string; full: string } {
  const replaceTokens = (str: string): string => {
    return str
      .replace(/\{movieName\}/g, data.movieName)
      .replace(/\{year\}/g, data.year)
      .replace(/\{quality\}/g, data.quality)
      .replace(/\{codec\}/g, data.codec)
      .replace(/\{extraTags\}/g, data.extraTags)
      // Clean up empty parentheses/brackets from missing values
      .replace(/\s*\(\s*\)/g, "")
      .replace(/\s*\[\s*\]/g, "")
      // Clean up trailing/leading separators
      .replace(/\s+-\s*$/g, "")
      .replace(/^\s*-\s+/g, "")
      // Clean up multiple consecutive spaces
      .replace(/\s+/g, " ")
      .trim();
  };

  const file = replaceTokens(template.fileTemplate).trim() + `.${data.ext}`;

  // Determine folder based on folderStructure
  let folder = "";
  switch (template.folderStructure) {
    case "year":
      folder = data.year;
      break;
    case "name":
      folder = replaceTokens(template.folderTemplate);
      break;
    case "none":
    default:
      folder = "";
      break;
  }

  return {
    folder,
    file,
    full: folder ? `${folder}/${file}` : file,
  };
}

export function NamingTemplateDialog({
  open,
  onOpenChange,
  language,
  seriesTemplate: initialSeriesTemplate,
  movieTemplate: initialMovieTemplate,
  onSeriesTemplateChange,
  onMovieTemplateChange,
  folderType,
  folderName,
  isPerFolderOverride,
  onClearOverride,
  globalSeriesTemplate,
  globalMovieTemplate,
}: NamingTemplateDialogProps) {
  // Local state for editing
  const [seriesTemplate, setSeriesTemplate] = useState<SeriesNamingTemplate>(
    initialSeriesTemplate || defaultSeriesNamingTemplate
  );
  const [movieTemplate, setMovieTemplate] = useState<MovieNamingTemplate>(
    initialMovieTemplate || defaultMovieNamingTemplate
  );
  const [activeTab, setActiveTab] = useState<"series" | "movies">(
    folderType || "series"
  );

  // Reset local state when dialog opens
  useEffect(() => {
    if (open) {
      if (folderType) {
        setActiveTab(folderType);
      }
    }
  }, [open, folderType]);

  // Always sync with initial values when they change (ensures latest config is used)
  // Use JSON.stringify for deep comparison since object references may not change
  const seriesTemplateJson = JSON.stringify(initialSeriesTemplate);
  const movieTemplateJson = JSON.stringify(initialMovieTemplate);

  useEffect(() => {
    setSeriesTemplate(initialSeriesTemplate || defaultSeriesNamingTemplate);
  }, [seriesTemplateJson]);

  useEffect(() => {
    setMovieTemplate(initialMovieTemplate || defaultMovieNamingTemplate);
  }, [movieTemplateJson]);

  // Preview results
  const seriesPreview = useMemo(
    () => applySeriesTemplate(seriesTemplate, EXAMPLE_SERIES),
    [seriesTemplate]
  );
  const moviePreview = useMemo(
    () => applyMovieTemplate(movieTemplate, EXAMPLE_MOVIE),
    [movieTemplate]
  );

  const handleSave = async () => {
    if (activeTab === "series" || !folderType) {
      await onSeriesTemplateChange?.(seriesTemplate);
    }
    if (activeTab === "movies" || !folderType) {
      await onMovieTemplateChange?.(movieTemplate);
    }
    onOpenChange(false);
  };

  const handleResetSeries = () => {
    // For per-folder overrides, reset to global template; otherwise reset to hardcoded default
    setSeriesTemplate(
      folderName && globalSeriesTemplate
        ? globalSeriesTemplate
        : defaultSeriesNamingTemplate
    );
  };

  const handleResetMovies = () => {
    // For per-folder overrides, reset to global template; otherwise reset to hardcoded default
    setMovieTemplate(
      folderName && globalMovieTemplate
        ? globalMovieTemplate
        : defaultMovieNamingTemplate
    );
  };

  const title = folderName
    ? language === "it"
      ? `Template di denominazione - ${folderName}`
      : `Naming Template - ${folderName}`
    : language === "it"
      ? "Template di denominazione"
      : "Naming Templates";

  const description = folderName
    ? language === "it"
      ? "Configura come vengono rinominati i file per questa cartella"
      : "Configure how files are renamed for this folder"
    : language === "it"
      ? "Configura i pattern di denominazione per serie TV e film"
      : "Configure naming patterns for TV series and movies";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90dvh] flex flex-col p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto py-4">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "series" | "movies")}
          >
            {/* Only show tabs if not editing a specific folder type */}
            {!folderType && (
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="series">
                  {language === "it" ? "Serie TV" : "TV Series"}
                </TabsTrigger>
                <TabsTrigger value="movies">
                  {language === "it" ? "Film" : "Movies"}
                </TabsTrigger>
              </TabsList>
            )}

            {/* Series Template */}
            <TabsContent value="series" className="space-y-4 mt-0">
              {/* Available tokens */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-medium">
                    {language === "it" ? "Token disponibili" : "Available Tokens"}
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      {language === "it"
                        ? "Clicca su un token per copiarlo. Usa questi token nei template per inserire informazioni dinamiche."
                        : "Click a token to copy it. Use these tokens in templates to insert dynamic information."}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SERIES_TOKENS.map(({ token, description, example }) => (
                    <Tooltip key={token}>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="secondary"
                          className="cursor-pointer hover:bg-secondary/80 text-xs"
                          onClick={() => navigator.clipboard.writeText(token)}
                        >
                          {token}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-medium">{description}</p>
                        <p className="text-xs text-muted-foreground">
                          {language === "it" ? "Esempio:" : "Example:"} {example}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>

              {/* Series Folder Template */}
              <div className="space-y-2">
                <Label htmlFor="series-folder">
                  {language === "it" ? "Cartella serie" : "Series Folder"}
                </Label>
                <Input
                  id="series-folder"
                  value={seriesTemplate.folderTemplate}
                  onChange={(e) =>
                    setSeriesTemplate({
                      ...seriesTemplate,
                      folderTemplate: e.target.value,
                    })
                  }
                  placeholder="{seriesName} ({seriesYear})"
                />
              </div>

              {/* Season Folder Template */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="season-folder">
                    {language === "it" ? "Cartella stagione" : "Season Folder"}
                  </Label>
                  <Input
                    id="season-folder"
                    value={seriesTemplate.seasonFolderTemplate}
                    onChange={(e) =>
                      setSeriesTemplate({
                        ...seriesTemplate,
                        seasonFolderTemplate: e.target.value,
                      })
                    }
                    placeholder="Season {season}"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="specials-folder">
                    {language === "it" ? "Cartella speciali" : "Specials Folder"}
                  </Label>
                  <Input
                    id="specials-folder"
                    value={seriesTemplate.specialsFolderTemplate}
                    onChange={(e) =>
                      setSeriesTemplate({
                        ...seriesTemplate,
                        specialsFolderTemplate: e.target.value,
                      })
                    }
                    placeholder="Specials"
                  />
                </div>
              </div>

              {/* File Template */}
              <div className="space-y-2">
                <Label htmlFor="series-file">
                  {language === "it" ? "Nome file" : "Filename"}
                </Label>
                <Input
                  id="series-file"
                  value={seriesTemplate.fileTemplate}
                  onChange={(e) =>
                    setSeriesTemplate({
                      ...seriesTemplate,
                      fileTemplate: e.target.value,
                    })
                  }
                  placeholder="{seriesName} - S{season}E{episode} - {episodeTitle}"
                />
                <p className="text-xs text-muted-foreground">
                  {language === "it"
                    ? "L'estensione viene aggiunta automaticamente"
                    : "Extension is added automatically"}
                </p>
              </div>

              {/* Padding Settings */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="season-padding">
                    {language === "it" ? "Cifre stagione" : "Season Digits"}
                  </Label>
                  <Select
                    value={seriesTemplate.seasonPadding.toString()}
                    onValueChange={(v) =>
                      setSeriesTemplate({
                        ...seriesTemplate,
                        seasonPadding: parseInt(v, 10),
                      })
                    }
                  >
                    <SelectTrigger id="season-padding">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 (1, 2, 10)</SelectItem>
                      <SelectItem value="2">2 (01, 02, 10)</SelectItem>
                      <SelectItem value="3">3 (001, 002, 010)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="episode-padding">
                    {language === "it" ? "Cifre episodio" : "Episode Digits"}
                  </Label>
                  <Select
                    value={seriesTemplate.episodePadding.toString()}
                    onValueChange={(v) =>
                      setSeriesTemplate({
                        ...seriesTemplate,
                        episodePadding: parseInt(v, 10),
                      })
                    }
                  >
                    <SelectTrigger id="episode-padding">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 (1, 2, 10)</SelectItem>
                      <SelectItem value="2">2 (01, 02, 10)</SelectItem>
                      <SelectItem value="3">3 (001, 002, 010)</SelectItem>
                      <SelectItem value="4">4 (0001, 0002)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Preview */}
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-sm font-medium">
                  {language === "it" ? "Anteprima" : "Preview"}
                </Label>
                <div className="bg-muted rounded-md p-3 font-mono text-xs break-all">
                  <span className="text-muted-foreground">
                    {folderName ? `${folderName}/` : ""}
                  </span>
                  {seriesPreview.full}
                </div>
              </div>

              {/* Reset button */}
              <div className="flex justify-end pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetSeries}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {language === "it" ? "Ripristina predefiniti" : "Reset to Default"}
                </Button>
              </div>
            </TabsContent>

            {/* Movies Template */}
            <TabsContent value="movies" className="space-y-4 mt-0">
              {/* Available tokens */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-medium">
                    {language === "it" ? "Token disponibili" : "Available Tokens"}
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      {language === "it"
                        ? "Clicca su un token per copiarlo. Usa questi token nei template per inserire informazioni dinamiche."
                        : "Click a token to copy it. Use these tokens in templates to insert dynamic information."}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {MOVIE_TOKENS.map(({ token, description, example }) => (
                    <Tooltip key={token}>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="secondary"
                          className="cursor-pointer hover:bg-secondary/80 text-xs"
                          onClick={() => navigator.clipboard.writeText(token)}
                        >
                          {token}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-medium">{description}</p>
                        <p className="text-xs text-muted-foreground">
                          {language === "it" ? "Esempio:" : "Example:"} {example}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>

              {/* Folder Structure */}
              <div className="space-y-2">
                <Label htmlFor="movie-folder-structure">
                  {language === "it" ? "Struttura cartelle" : "Folder Structure"}
                </Label>
                <Select
                  value={movieTemplate.folderStructure}
                  onValueChange={(value: MovieFolderStructure) =>
                    setMovieTemplate({
                      ...movieTemplate,
                      folderStructure: value,
                    })
                  }
                >
                  <SelectTrigger id="movie-folder-structure">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">
                      {language === "it" ? "Cartella per film" : "Folder per movie"}
                      <span className="text-xs text-muted-foreground ml-2">
                        (Film/Nome Film/file.mkv)
                      </span>
                    </SelectItem>
                    <SelectItem value="year">
                      {language === "it" ? "Cartella per anno" : "Folder per year"}
                      <span className="text-xs text-muted-foreground ml-2">
                        (Film/2024/file.mkv)
                      </span>
                    </SelectItem>
                    <SelectItem value="none">
                      {language === "it" ? "Nessuna sottocartella" : "No subfolder"}
                      <span className="text-xs text-muted-foreground ml-2">
                        (Film/file.mkv)
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Movie Folder Template - only show when folderStructure is "name" */}
              {movieTemplate.folderStructure === "name" && (
                <div className="space-y-2">
                  <Label htmlFor="movie-folder">
                    {language === "it" ? "Cartella film" : "Movie Folder"}
                  </Label>
                  <Input
                    id="movie-folder"
                    value={movieTemplate.folderTemplate}
                    onChange={(e) =>
                      setMovieTemplate({
                        ...movieTemplate,
                        folderTemplate: e.target.value,
                      })
                    }
                    placeholder="{movieName} ({year})"
                  />
                  <p className="text-xs text-muted-foreground">
                    {language === "it"
                      ? "Sottocartella all'interno della cartella base"
                      : "Subfolder within the base folder"}
                  </p>
                </div>
              )}

              {/* File Template */}
              <div className="space-y-2">
                <Label htmlFor="movie-file">
                  {language === "it" ? "Nome file" : "Filename"}
                </Label>
                <Input
                  id="movie-file"
                  value={movieTemplate.fileTemplate}
                  onChange={(e) =>
                    setMovieTemplate({
                      ...movieTemplate,
                      fileTemplate: e.target.value,
                    })
                  }
                  placeholder="{movieName} ({year})"
                />
                <p className="text-xs text-muted-foreground">
                  {language === "it"
                    ? "L'estensione viene aggiunta automaticamente"
                    : "Extension is added automatically"}
                </p>
              </div>

              {/* Preview */}
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-sm font-medium">
                  {language === "it" ? "Anteprima" : "Preview"}
                </Label>
                <div className="bg-muted rounded-md p-3 font-mono text-xs break-all">
                  <span className="text-muted-foreground">
                    {folderName ? `${folderName}/` : ""}
                  </span>
                  {moviePreview.full}
                </div>
              </div>

              {/* Reset button */}
              <div className="flex justify-end pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetMovies}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {language === "it" ? "Ripristina predefiniti" : "Reset to Default"}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="shrink-0 flex-row gap-2">
          {isPerFolderOverride && onClearOverride && (
            <Button
              variant="outline"
              onClick={() => {
                onClearOverride();
                onOpenChange(false);
              }}
              className="mr-auto"
            >
              {language === "it" ? "Usa globale" : "Use Global"}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {language === "it" ? "Annulla" : "Cancel"}
          </Button>
          <Button onClick={handleSave}>
            {language === "it" ? "Salva" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
