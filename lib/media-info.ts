import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface MediaInfo {
  videoCodec?: string; // e.g., "h264", "hevc", "av1"
  videoCodecTag?: string; // e.g., "x264", "x265"
  resolution?: string; // e.g., "1920x1080"
  width?: number;
  height?: number;
  interlaced?: boolean; // true if video is interlaced (e.g., 1080i)
  audioCodec?: string; // e.g., "aac", "ac3", "dts"
  audioBitrate?: number;
  duration?: number; // in seconds
  bitrate?: number; // overall bitrate
  hdr?: boolean;
  colorSpace?: string;
}

// Map codec names to common naming conventions
const VIDEO_CODEC_MAP: Record<string, string> = {
  h264: "H264",
  avc: "H264",
  avc1: "H264",
  hevc: "H265",
  h265: "H265",
  hev1: "H265",
  hvc1: "H265",
  av1: "AV1",
  vp9: "VP9",
  vp8: "VP8",
  mpeg4: "MPEG4",
  mpeg2video: "MPEG2",
  xvid: "XviD",
  divx: "DivX",
};

// Try to detect encoder from codec tag, writing library, or other metadata
function detectEncoder(
  codecName: string,
  codecTag: string | undefined,
  writingLibrary: string | undefined
): string | undefined {
  const tag = codecTag?.toLowerCase() || "";
  const codec = codecName.toLowerCase();
  const library = writingLibrary?.toLowerCase() || "";

  // x264/x265 detection from writing library (most reliable)
  if (library.includes("x264")) {
    return "x264";
  }
  if (library.includes("x265")) {
    return "x265";
  }

  // Check codec tag for encoder hints
  if (tag.includes("x264")) {
    return "x264";
  }
  if (tag.includes("x265")) {
    return "x265";
  }

  // Return normalized codec name (H264, H265, etc.)
  return VIDEO_CODEC_MAP[codec];
}

/**
 * Get media information using ffprobe
 * Returns undefined if ffprobe is not available or file cannot be probed
 */
export async function getMediaInfo(filePath: string): Promise<MediaInfo | undefined> {
  try {
    // Use ffprobe to get JSON output with stream info
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_streams -show_format "${filePath.replace(/"/g, '\\"')}"`,
      { timeout: 30000 } // 30 second timeout
    );

    const data = JSON.parse(stdout);
    const streams = data.streams || [];
    const format = data.format || {};

    // Find video and audio streams
    const videoStream = streams.find((s: { codec_type: string }) => s.codec_type === "video");
    const audioStream = streams.find((s: { codec_type: string }) => s.codec_type === "audio");

    if (!videoStream) {
      return undefined;
    }

    const result: MediaInfo = {};

    // Video codec
    const codecName = videoStream.codec_name?.toLowerCase();
    const codecTag = videoStream.codec_tag_string;
    // Writing library often contains encoder info like "x264" or "x265"
    const writingLibrary = videoStream.tags?.encoder || videoStream.tags?.ENCODER ||
                           format.tags?.encoder || format.tags?.ENCODER;

    result.videoCodec = VIDEO_CODEC_MAP[codecName] || codecName?.toUpperCase();
    result.videoCodecTag = detectEncoder(codecName, codecTag, writingLibrary);

    // Resolution
    if (videoStream.width && videoStream.height) {
      result.width = videoStream.width;
      result.height = videoStream.height;
      result.resolution = `${videoStream.width}x${videoStream.height}`;
    }

    // Interlaced detection
    const fieldOrder = videoStream.field_order?.toLowerCase() || "";
    result.interlaced = fieldOrder === "tt" || fieldOrder === "bb" ||
                        fieldOrder === "tb" || fieldOrder === "bt" ||
                        fieldOrder.includes("interlaced");

    // HDR detection
    const colorTransfer = videoStream.color_transfer?.toLowerCase() || "";
    const colorPrimaries = videoStream.color_primaries?.toLowerCase() || "";
    result.hdr = colorTransfer.includes("smpte2084") ||
                 colorTransfer.includes("arib-std-b67") ||
                 colorPrimaries.includes("bt2020");
    result.colorSpace = videoStream.color_space;

    // Audio codec
    if (audioStream) {
      result.audioCodec = audioStream.codec_name?.toUpperCase();
      if (audioStream.bit_rate) {
        result.audioBitrate = parseInt(audioStream.bit_rate, 10);
      }
    }

    // Duration and bitrate
    if (format.duration) {
      result.duration = parseFloat(format.duration);
    }
    if (format.bit_rate) {
      result.bitrate = parseInt(format.bit_rate, 10);
    }

    return result;
  } catch {
    // ffprobe not available or failed to parse
    return undefined;
  }
}

/**
 * Get a quality info string from media info
 * Returns something like "1080p.H265" or "4K.x265.HDR"
 */
export function buildQualityInfoFromMedia(mediaInfo: MediaInfo): string {
  const parts: string[] = [];

  // Add resolution with interlaced suffix (i) or progressive (p)
  // Check both width and height to handle cropped content
  // (e.g., 1920x960 is still 1080p source, 1920x800 ultrawide is 1080p)
  const suffix = mediaInfo.interlaced ? "i" : "p";
  const width = mediaInfo.width || 0;
  const height = mediaInfo.height || 0;

  if (width >= 3600 || height >= 2000) {
    parts.push(`2160${suffix}`);
  } else if (width >= 1800 || height >= 1000) {
    parts.push(`1080${suffix}`);
  } else if (width >= 1200 || height >= 700) {
    parts.push(`720${suffix}`);
  } else if (width >= 1000 || height >= 560) {
    parts.push(`576${suffix}`);
  } else if (width >= 640 || height >= 460) {
    parts.push(`480${suffix}`);
  }

  // Add codec (prefer encoder tag like x264/x265 over generic H264/H265)
  if (mediaInfo.videoCodecTag) {
    parts.push(mediaInfo.videoCodecTag);
  } else if (mediaInfo.videoCodec) {
    parts.push(mediaInfo.videoCodec);
  }

  // Add HDR if detected
  if (mediaInfo.hdr) {
    parts.push("HDR");
  }

  return parts.join(".");
}

/**
 * Check if ffprobe is available on the system
 */
export async function isFFprobeAvailable(): Promise<boolean> {
  try {
    await execAsync("ffprobe -version", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
