"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getTranslations } from "@/lib/translations";
import type { Language, MetadataProvider } from "@/types/config";

interface RenameChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemCount: number;
  seriesMetadataProvider?: MetadataProvider;
  moviesMetadataProvider?: MetadataProvider;
  onNormalRename: () => void;
  onIdentifyRename: () => void;
  onIdentifyMovieRename?: () => void; // For identifying a single file as a movie
  onBatchIdentifyRename?: () => void; // For identifying multiple movies separately
  onMultiSeriesRename?: () => void; // For identifying multiple different TV series
  language?: Language;
}

export function RenameChoiceDialog({
  open,
  onOpenChange,
  itemCount,
  seriesMetadataProvider = "tvdb",
  moviesMetadataProvider = "tmdb",
  onNormalRename,
  onIdentifyRename,
  onIdentifyMovieRename,
  onBatchIdentifyRename,
  onMultiSeriesRename,
  language = "en",
}: RenameChoiceDialogProps) {
  const t = useMemo(() => getTranslations(language), [language]);
  const seriesProviderName = seriesMetadataProvider === "tmdb" ? "TMDB" : "TVDB";
  const moviesProviderName = moviesMetadataProvider === "tmdb" ? "TMDB" : "TVDB";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-3 sm:p-6 max-h-[85vh] overflow-y-auto">
        <DialogHeader className="pb-1 sm:pb-2">
          <DialogTitle className="text-base sm:text-lg">{t.renameChoice.title}</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {t.renameChoice.description}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:gap-3 py-2 sm:py-4">
          {itemCount === 1 && (
            <Button
              variant="outline"
              className="h-auto py-3 sm:py-4 flex flex-col items-start gap-1 whitespace-normal text-left w-full"
              onClick={onNormalRename}
            >
              <span className="font-semibold text-sm sm:text-base">{t.common.rename}</span>
              <span className="text-xs sm:text-sm text-muted-foreground text-left">
                {t.renameChoice.enterNewName}
              </span>
            </Button>
          )}

          <Button
            variant="outline"
            className="h-auto py-3 sm:py-4 flex flex-col items-start gap-1 whitespace-normal text-left w-full"
            onClick={onIdentifyRename}
          >
            <span className="font-semibold text-sm sm:text-base">
              {t.renameChoice.identifySeries} ({seriesProviderName})
            </span>
            <span className="text-xs sm:text-sm text-muted-foreground text-left">
              {t.renameChoice.identifySeriesDescription}
            </span>
          </Button>

          {onIdentifyMovieRename && itemCount === 1 && (
            <Button
              variant="outline"
              className="h-auto py-3 sm:py-4 flex flex-col items-start gap-1 whitespace-normal text-left w-full"
              onClick={onIdentifyMovieRename}
            >
              <span className="font-semibold text-sm sm:text-base">
                {t.renameChoice.identifyMovie} ({moviesProviderName})
              </span>
              <span className="text-xs sm:text-sm text-muted-foreground text-left">
                {t.renameChoice.identifyMovieDescription}
              </span>
            </Button>
          )}

          {onBatchIdentifyRename && itemCount > 1 && (
            <Button
              variant="outline"
              className="h-auto py-3 sm:py-4 flex flex-col items-start gap-1 whitespace-normal text-left w-full"
              onClick={onBatchIdentifyRename}
            >
              <span className="font-semibold text-sm sm:text-base">
                {t.renameChoice.identifyMoviesSeparately} ({moviesProviderName})
              </span>
              <span className="text-xs sm:text-sm text-muted-foreground text-left">
                {t.renameChoice.identifyMoviesSeparatelyDescription}
              </span>
            </Button>
          )}

          {onMultiSeriesRename && itemCount > 1 && (
            <Button
              variant="outline"
              className="h-auto py-3 sm:py-4 flex flex-col items-start gap-1 whitespace-normal text-left w-full"
              onClick={onMultiSeriesRename}
            >
              <span className="font-semibold text-sm sm:text-base">
                {t.renameChoice.multiSeries} ({seriesProviderName})
              </span>
              <span className="text-xs sm:text-sm text-muted-foreground text-left">
                {t.renameChoice.multiSeriesDescription}
              </span>
            </Button>
          )}
        </div>

        <DialogFooter className="pt-1 sm:pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full sm:w-auto h-8 sm:h-10 text-xs sm:text-sm">
            {t.common.cancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
