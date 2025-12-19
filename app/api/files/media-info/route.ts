import { NextRequest, NextResponse } from "next/server";
import { validatePath, getBasePath } from "@/lib/path-validator";
import { getMediaInfo, buildQualityInfoFromMedia, isFFprobeAvailable } from "@/lib/media-info";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filePath = searchParams.get("path");
  const pane = searchParams.get("pane") || "downloads";

  if (!filePath) {
    return NextResponse.json(
      { success: false, error: "path parameter is required" },
      { status: 400 }
    );
  }

  // Check if ffprobe is available
  const ffprobeAvailable = await isFFprobeAvailable();
  if (!ffprobeAvailable) {
    return NextResponse.json(
      { success: false, error: "ffprobe is not available on this system" },
      { status: 503 }
    );
  }

  try {
    const basePath = getBasePath(pane as "downloads" | "media");
    const validation = await validatePath(basePath, filePath);

    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    const mediaInfo = await getMediaInfo(validation.absolutePath);

    if (!mediaInfo) {
      return NextResponse.json(
        { success: false, error: "Could not extract media info from file" },
        { status: 400 }
      );
    }

    // Build quality string
    const qualityInfo = buildQualityInfoFromMedia(mediaInfo);

    return NextResponse.json({
      success: true,
      data: {
        ...mediaInfo,
        qualityInfo,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to get media info" },
      { status: 500 }
    );
  }
}
