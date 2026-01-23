import { NextResponse } from "next/server";

export async function GET() {
  try {
    const url = process.env.PLEX_URL;
    const token = process.env.PLEX_TOKEN;

    if (!url || !token) {
      return NextResponse.json(
        { success: false, error: "Plex not configured. Set PLEX_URL and PLEX_TOKEN environment variables.", configured: false },
        { status: 400 }
      );
    }

    // Normalize URL (remove trailing slash)
    const baseUrl = url.replace(/\/$/, "");

    // Fetch library sections from Plex
    const response = await fetch(`${baseUrl}/library/sections?X-Plex-Token=${token}`, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return NextResponse.json(
          { success: false, error: "Invalid Plex token", configured: true },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { success: false, error: `Plex API error: ${response.status}`, configured: true },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Extract sections from Plex response
    const sections = data.MediaContainer?.Directory?.map((dir: { key: string; title: string; type: string }) => ({
      key: dir.key,
      title: dir.title,
      type: dir.type,
    })) || [];

    return NextResponse.json({ success: true, sections, configured: true });
  } catch (error) {
    console.error("Failed to fetch Plex sections:", error);

    // Check if it's a connection error
    if (error instanceof TypeError && error.message.includes("fetch")) {
      return NextResponse.json(
        { success: false, error: "Cannot connect to Plex server. Check PLEX_URL and ensure Plex is running.", configured: true },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Failed to fetch Plex sections", configured: true },
      { status: 500 }
    );
  }
}
