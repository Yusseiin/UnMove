"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { MetadataProvider } from "@/types/config";

interface RenameChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemCount: number;
  metadataProvider?: MetadataProvider;
  onNormalRename: () => void;
  onIdentifyRename: () => void;
  onBatchIdentifyRename?: () => void; // For identifying multiple movies separately
  onMultiSeriesRename?: () => void; // For identifying multiple different TV series
}

export function RenameChoiceDialog({
  open,
  onOpenChange,
  itemCount,
  metadataProvider = "tvdb",
  onNormalRename,
  onIdentifyRename,
  onBatchIdentifyRename,
  onMultiSeriesRename,
}: RenameChoiceDialogProps) {
  const providerName = metadataProvider === "tmdb" ? "TMDB" : "TVDB";
  const itemText = itemCount === 1 ? "item" : "items";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-3 sm:p-6 max-h-[85vh] overflow-y-auto">
        <DialogHeader className="pb-1 sm:pb-2">
          <DialogTitle className="text-base sm:text-lg">Rename Options</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Rename {itemCount} {itemText}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:gap-3 py-2 sm:py-4">
          {itemCount === 1 && (
            <Button
              variant="outline"
              className="h-auto py-3 sm:py-4 flex flex-col items-start gap-1"
              onClick={onNormalRename}
            >
              <span className="font-semibold text-sm sm:text-base">Rename Manually</span>
              <span className="text-xs sm:text-sm text-muted-foreground text-left">
                Enter a new name
              </span>
            </Button>
          )}

          <Button
            variant="outline"
            className="h-auto py-3 sm:py-4 flex flex-col items-start gap-1"
            onClick={onIdentifyRename}
          >
            <span className="font-semibold text-sm sm:text-base">
              {itemCount === 1 ? `Identify with ${providerName}` : "Identify TV Series"}
            </span>
            <span className="text-xs sm:text-sm text-muted-foreground text-left">
              Rename as TV series episodes
            </span>
          </Button>

          {onBatchIdentifyRename && itemCount > 1 && (
            <Button
              variant="outline"
              className="h-auto py-3 sm:py-4 flex flex-col items-start gap-1"
              onClick={onBatchIdentifyRename}
            >
              <span className="font-semibold text-sm sm:text-base">Identify Movies Separately</span>
              <span className="text-xs sm:text-sm text-muted-foreground text-left">
                Search each file independently
              </span>
            </Button>
          )}

          {onMultiSeriesRename && itemCount > 1 && (
            <Button
              variant="outline"
              className="h-auto py-3 sm:py-4 flex flex-col items-start gap-1"
              onClick={onMultiSeriesRename}
            >
              <span className="font-semibold text-sm sm:text-base">Multiple TV Series</span>
              <span className="text-xs sm:text-sm text-muted-foreground text-left">
                Episodes from different series
              </span>
            </Button>
          )}
        </div>

        <DialogFooter className="pt-1 sm:pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full sm:w-auto h-8 sm:h-10 text-xs sm:text-sm">
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
