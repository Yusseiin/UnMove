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

interface TransferChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operation: "copy" | "move";
  itemCount: number;
  onNormalTransfer: () => void;
  onIdentify: () => void;
  onBatchIdentify?: () => void; // For identifying multiple movies separately
}

export function TransferChoiceDialog({
  open,
  onOpenChange,
  operation,
  itemCount,
  onNormalTransfer,
  onIdentify,
  onBatchIdentify,
}: TransferChoiceDialogProps) {
  const operationText = operation === "copy" ? "Copy" : "Move";
  const itemText = itemCount === 1 ? "item" : "items";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{operationText} Options</DialogTitle>
          <DialogDescription className="text-sm">
            How would you like to {operation} {itemCount} {itemText}?
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:gap-3 py-2 sm:py-4">
          <Button
            variant="outline"
            className="h-auto py-3 sm:py-4 flex flex-col items-start gap-1"
            onClick={onNormalTransfer}
          >
            <span className="font-semibold text-sm sm:text-base">{operationText} Normally</span>
            <span className="text-xs sm:text-sm text-muted-foreground text-left">
              Transfer to current Media folder
            </span>
          </Button>

          <Button
            variant="outline"
            className="h-auto py-3 sm:py-4 flex flex-col items-start gap-1"
            onClick={onIdentify}
          >
            <span className="font-semibold text-sm sm:text-base">
              {itemCount === 1 ? "Identify File with TVDB" : "Identify TV Series with TVDB"}
            </span>
            <span className="text-xs sm:text-sm text-muted-foreground text-left">
              Search TVDB to identify and rename as TV series episodes
            </span>
          </Button>

          {onBatchIdentify && itemCount > 1 && (
            <Button
              variant="outline"
              className="h-auto py-3 sm:py-4 flex flex-col items-start gap-1"
              onClick={onBatchIdentify}
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
