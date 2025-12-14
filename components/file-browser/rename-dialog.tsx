"use client";

import { useState, useEffect } from "react";
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

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onSubmit: (newName: string) => void;
  isLoading?: boolean;
}

// Validate file/folder name client-side for immediate feedback
function validateFileName(name: string): { valid: boolean; error?: string } {
  if (!name || typeof name !== "string") {
    return { valid: false, error: "Name is required" };
  }

  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    return { valid: false, error: "Name cannot be empty" };
  }

  // Check for illegal characters
  const illegalChars = /[<>:"/\\|?*\x00-\x1f]/;
  if (illegalChars.test(trimmedName)) {
    return {
      valid: false,
      error: "Name contains illegal characters: < > : \" / \\ | ? *",
    };
  }

  // Check for reserved names on Windows
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
  if (reservedNames.test(trimmedName)) {
    return {
      valid: false,
      error: "This name is reserved by the system",
    };
  }

  // Check if name is just a dot
  if (trimmedName === ".") {
    return { valid: false, error: "Name cannot be just a dot" };
  }

  // Check if name ends with space or dot
  if (trimmedName.endsWith(" ") || trimmedName.endsWith(".")) {
    return { valid: false, error: "Name cannot end with a space or dot" };
  }

  // Check length
  if (trimmedName.length > 255) {
    return { valid: false, error: "Name is too long (max 255 characters)" };
  }

  return { valid: true };
}

export function RenameDialog({
  open,
  onOpenChange,
  currentName,
  onSubmit,
  isLoading,
}: RenameDialogProps) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState("");

  // Reset name when dialog opens with new currentName
  useEffect(() => {
    if (open) {
      setName(currentName);
      setError("");
    }
  }, [open, currentName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();

    // Check if name changed
    if (trimmedName === currentName) {
      setError("Name is the same as before");
      return;
    }

    // Validate the name
    const validation = validateFileName(trimmedName);
    if (!validation.valid) {
      setError(validation.error || "Invalid name");
      return;
    }

    onSubmit(trimmedName);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setName(currentName);
      setError("");
    }
    onOpenChange(newOpen);
  };

  const handleNameChange = (value: string) => {
    setName(value);
    // Clear error on change, but show validation errors in real-time for illegal chars
    const validation = validateFileName(value);
    if (!validation.valid && value.trim().length > 0) {
      setError(validation.error || "");
    } else {
      setError("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription>
              Enter a new name for &quot;{currentName}&quot;
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="new-name" className="sr-only">
              New name
            </Label>
            <Input
              id="new-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Enter new name"
              autoFocus
              disabled={isLoading}
              onFocus={(e) => {
                // Select filename without extension for files
                const lastDot = e.target.value.lastIndexOf(".");
                if (lastDot > 0) {
                  e.target.setSelectionRange(0, lastDot);
                } else {
                  e.target.select();
                }
              }}
            />
            {error && <p className="text-sm text-destructive mt-2">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !!error}>
              {isLoading ? "Renaming..." : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
