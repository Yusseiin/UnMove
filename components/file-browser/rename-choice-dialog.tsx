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

interface RenameChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemCount: number;
  onNormalRename: () => void;
  onIdentifyRename: () => void;
  onBatchIdentifyRename?: () => void; // For identifying multiple movies separately
}

export function RenameChoiceDialog({
  open,
  onOpenChange,
  itemCount,
  onNormalRename,
  onIdentifyRename,
  onBatchIdentifyRename,
}: RenameChoiceDialogProps) {
  const itemText = itemCount === 1 ? "item" : "items";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Rename Options</DialogTitle>
          <DialogDescription className="text-sm">
            How would you like to rename {itemCount} {itemText}?
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
                Enter a new name for the file
              </span>
            </Button>
          )}

          <Button
            variant="outline"
            className="h-auto py-3 sm:py-4 flex flex-col items-start gap-1"
            onClick={onIdentifyRename}
          >
            <span className="font-semibold text-sm sm:text-base">Identify with TVDB</span>
            <span className="text-xs sm:text-sm text-muted-foreground text-left">
              Search TVDB to identify and rename {itemCount} {itemText}
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
                Search each file independently (for multiple movies)
              </span>
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
