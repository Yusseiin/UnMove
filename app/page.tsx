"use client";

import { useState } from "react";
import { FileBrowser } from "@/components/file-browser/file-browser";
import { ChangelogDialog } from "@/components/changelog-dialog";
import { PlexPopover } from "@/components/plex-popover";
import { Toaster } from "@/components/ui/sonner";
import Image from "next/image";
import { Settings, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfig } from "@/hooks/use-config";

// Plex icon component
function PlexIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M11.643 0H4.68l7.679 12L4.68 24h6.963l7.677-12L11.643 0" />
    </svg>
  );
}

export default function Home() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const { config } = useConfig();

  return (
    <div className="h-dvh max-h-dvh flex flex-col overflow-hidden">
      <header className="border-b px-4 py-3 flex items-center justify-between shrink-0 bg-background">
        <div className="flex items-center gap-2">
          <Image
            src="/icon.png"
            alt="UnMove"
            width={28}
            height={28}
            className="rounded"
          />
          <h1 className="text-lg font-semibold">UnMove</h1>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setChangelogOpen(true)}
            title="Changelog"
            className="cursor-pointer"
          >
            <Info className="h-5 w-5" />
          </Button>
          <PlexPopover language={config.language}>
            <Button
              variant="ghost"
              size="icon"
              title="Plex"
              className="cursor-pointer"
            >
              <PlexIcon className="h-5 w-5" />
            </Button>
          </PlexPopover>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            className="cursor-pointer"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-hidden">
        <FileBrowser settingsOpen={settingsOpen} onSettingsOpenChange={setSettingsOpen} />
      </main>
      <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />
      <Toaster position="bottom-right" />
    </div>
  );
}
