import { NextRequest, NextResponse } from "next/server";
import { getTMDBSeriesEpisodes } from "@/lib/tmdb";
import type { TVDBApiResponse, TVDBEpisode } from "@/types/tvdb";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const seriesId = searchParams.get("seriesId");
    const seasonParam = searchParams.get("season");
    const lang = searchParams.get("lang"); // Optional: "it" for Italian

    if (!seriesId) {
      return NextResponse.json<TVDBApiResponse<null>>(
        { success: false, error: "seriesId is required" },
        { status: 400 }
      );
    }

    const season = seasonParam ? parseInt(seasonParam, 10) : undefined;

    if (seasonParam && isNaN(season!)) {
      return NextResponse.json<TVDBApiResponse<null>>(
        { success: false, error: "season must be a number" },
        { status: 400 }
      );
    }

    // TMDB handles translations in the main request via language param
    const episodes = await getTMDBSeriesEpisodes(seriesId, season, lang || undefined);

    return NextResponse.json<TVDBApiResponse<TVDBEpisode[]>>({
      success: true,
      data: episodes,
    });
  } catch (error) {
    return NextResponse.json<TVDBApiResponse<null>>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch episodes from TMDB",
      },
      { status: 500 }
    );
  }
}
