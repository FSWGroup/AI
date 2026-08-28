import "server-only";
import type { VideoProvider } from "@/lib/ai/types";
import { ffmpegVideoProvider } from "@/lib/video/providers/ffmpeg";
import { heygenVideoProvider } from "@/lib/video/providers/heygen";
import { synthesiaVideoProvider } from "@/lib/video/providers/synthesia";

/**
 * Video provider resolution.
 *
 * AVATAR mode prefers a real avatar provider (HeyGen first, then Synthesia)
 * when one is configured; every other mode — and AVATAR itself when neither
 * is configured — renders locally through ffmpeg. A missing avatar API key
 * never breaks Video Studio: it just narrows AVATAR mode down to the local
 * renderer, which is exactly what the capability registry advertises.
 */
export function getVideoProvider(mode: string): VideoProvider {
  if (mode === "AVATAR") {
    if (heygenVideoProvider.isAvailable()) return heygenVideoProvider;
    if (synthesiaVideoProvider.isAvailable()) return synthesiaVideoProvider;
  }
  return ffmpegVideoProvider;
}

/** All providers, for the admin Integrations screen to report availability. */
export function getAllVideoProviders(): VideoProvider[] {
  return [ffmpegVideoProvider, heygenVideoProvider, synthesiaVideoProvider];
}
