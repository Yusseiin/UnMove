"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RefreshCw, ExternalLink, Loader2, Check, AlertCircle } from "lucide-react";
import type { PlexSection, Language } from "@/types/config";
import { getTranslations } from "@/lib/translations";

interface PlexPopoverProps {
  children: React.ReactNode;
  language: Language;
}

export function PlexPopover({
  children,
  language,
}: PlexPopoverProps) {
  const t = useMemo(() => getTranslations(language), [language]);

  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<PlexSection[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshSuccess, setRefreshSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);

  // Fetch sections when popover opens
  const fetchSections = useCallback(async () => {
    setIsLoadingSections(true);
    setError(null);

    try {
      const response = await fetch("/api/plex/sections");
      const data = await response.json();

      setIsConfigured(data.configured !== false);

      if (data.success) {
        setSections(data.sections);
      } else {
        setError(data.error || t.plex.failedToFetchSections);
        setSections([]);
      }
    } catch {
      setError(t.plex.failedToConnect);
      setSections([]);
    } finally {
      setIsLoadingSections(false);
    }
  }, [t.plex]);

  // Fetch sections when popover opens
  useEffect(() => {
    if (open) {
      fetchSections();
    }
  }, [open, fetchSections]);

  const handleRefresh = async (sectionKey?: string) => {
    setIsRefreshing(true);
    setError(null);
    setRefreshSuccess(false);

    try {
      const response = await fetch("/api/plex/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionKey }),
      });
      const data = await response.json();

      if (data.success) {
        setRefreshSuccess(true);
        // Clear success state after 2 seconds
        setTimeout(() => setRefreshSuccess(false), 2000);
      } else {
        setError(data.error || t.plex.failedToRefresh);
      }
    } catch {
      setError(t.plex.failedToRefresh);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)]" align="center" collisionPadding={16}>
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">{t.plex.title}</h4>
            <p className="text-sm text-muted-foreground">
              {t.plex.description}
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Not Configured Message */}
          {isConfigured === false && (
            <div className="space-y-3 pt-2 border-t">
              <p className="text-sm text-muted-foreground">
                {t.plex.notConfigured}
              </p>
              <a
                href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                {t.plex.howToGetToken}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

          {/* Loading State */}
          {isLoadingSections && isConfigured === null && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Library Sections */}
          {isConfigured && (
            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between">
                <Label>{t.plex.libraries}</Label>
                {isLoadingSections && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>

              {sections.length > 0 ? (
                <div className="space-y-1">
                  {sections.map((section) => (
                    <div
                      key={section.key}
                      className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-muted"
                    >
                      <span>
                        {section.title}{" "}
                        <span className="text-muted-foreground">
                          ({section.type})
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleRefresh(section.key)}
                        disabled={isRefreshing}
                        title={t.plex.refreshLibrary}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : !isLoadingSections ? (
                <p className="text-sm text-muted-foreground">
                  {t.plex.noLibraries}
                </p>
              ) : null}

              {/* Refresh All Button */}
              <Button
                onClick={() => handleRefresh()}
                disabled={isRefreshing}
                className="w-full"
                variant="outline"
                size="sm"
              >
                {isRefreshing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t.plex.refreshing}
                  </>
                ) : refreshSuccess ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    {t.plex.refreshTriggered}
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {t.plex.refreshAll}
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
