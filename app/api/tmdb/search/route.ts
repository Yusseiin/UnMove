import { NextRequest, NextResponse } from "next/server";
import { searchTMDB } from "@/lib/tmdb";
import type { TVDBSearchRequest, TVDBApiResponse, TVDBSearchResult } from "@/types/tvdb";

export async function POST(request: NextRequest) {
  try {
    const body: TVDBSearchRequest = await request.json();
    const { query, type, lang, year } = body;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json<TVDBApiResponse<null>>(
        { success: false, error: "Search query is required" },
        { status: 400 }
      );
    }

    if (type && type !== "series" && type !== "movie") {
      return NextResponse.json<TVDBApiResponse<null>>(
        { success: false, error: "Type must be 'series' or 'movie'" },
        { status: 400 }
      );
    }

    const results = await searchTMDB(query.trim(), type, lang, year);

    // Filter to only series and movies (should already be filtered, but double-check)
    const filteredResults = results.filter(
      (r) => r.type === "series" || r.type === "movie"
    );

    return NextResponse.json<TVDBApiResponse<TVDBSearchResult[]>>({
      success: true,
      data: filteredResults,
    });
  } catch (error) {
    return NextResponse.json<TVDBApiResponse<null>>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to search TMDB",
      },
      { status: 500 }
    );
  }
}
