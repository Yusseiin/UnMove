import { NextRequest, NextResponse } from "next/server";

interface RefreshRequest {
  sectionKey?: string; // If provided, refresh only this section. If not, refresh all.
}

export async function POST(request: NextRequest) {
  try {
    const url = process.env.PLEX_URL;
    const token = process.env.PLEX_TOKEN;

    if (!url || !token) {
      return NextResponse.json(
        { success: false, error: "Plex not configured. Set PLEX_URL and PLEX_TOKEN environment variables." },
        { status: 400 }
      );
    }

    const body: RefreshRequest = await request.json();
    const { sectionKey } = body;

    // Normalize URL (remove trailing slash)
    const baseUrl = url.replace(/\/$/, "");

    // Determine which endpoint to call
    const refreshPath = sectionKey
      ? `/library/sections/${sectionKey}/refresh`
      : "/library/sections/all/refresh";

    const response = await fetch(`${baseUrl}${refreshPath}?X-Plex-Token=${token}`, {
      method: "GET", // Plex uses GET for refresh
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return NextResponse.json(
          { success: false, error: "Invalid Plex token" },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { success: false, error: `Plex API error: ${response.status}` },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      message: sectionKey
        ? `Library section ${sectionKey} refresh triggered`
        : "All libraries refresh triggered",
    });
  } catch (error) {
    console.error("Failed to refresh Plex library:", error);

    // Check if it's a connection error
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return NextResponse.json(
        { success: false, error: "Cannot connect to Plex server. Check PLEX_URL and ensure Plex is running." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Failed to refresh Plex library" },
      { status: 500 }
    );
  }
}
