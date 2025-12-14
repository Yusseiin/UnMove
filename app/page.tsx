"use client";

import { useState } from "react";
import { FileBrowser } from "@/components/file-browser/file-browser";
import { Toaster } from "@/components/ui/sonner";
import Image from "next/image";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  const [settingsOpen, setSettingsOpen] = useState(false);

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
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          className="cursor-pointer"
        >
          <Settings className="h-5 w-5" />
        </Button>
      </header>
      <main className="flex-1 min-h-0 overflow-hidden">
        <FileBrowser settingsOpen={settingsOpen} onSettingsOpenChange={setSettingsOpen} />
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}
