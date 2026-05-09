import "server-only";
import {
  SAMPLES,
  type HeroSampleSummary,
} from "@/app/components/hero-demo-data";
import { isHeroDemoVideoId } from "@/lib/constants/hero-demo-ids";
import { getYoutubeVideoId } from "@/app/summary/utils";
import {
  SUPPORTED_LANGUAGE_CODES,
  type SupportedLanguageCode,
} from "@/lib/constants/languages";
import type {
  CachedSummary,
  CachedTranscript,
} from "./summarize-cache";

// The hero-demo registry stores per-(id, language) summaries as static
// modules under app/components/hero-demo-data/. Anonymous visitors on the
// marketing homepage chat about these six videos without ever populating
// the DB cache, so /api/chat/stream's DB-backed `getCachedSummary` /
// `getCachedTranscript` return null and the route would 404 with
// "Generate the summary first." This helper fills that gap by serving
// the same shapes from the file registry.
//
// Demo chat is intentionally stateless: no rate-limit, no entitlement,
// no chat_messages persist (the FK to videos(id) wouldn't resolve for a
// non-DB id anyway). The route enforces those skips; this module only
// owns the data load.

function isSupportedLanguageCode(
  code: string | null | undefined,
): code is SupportedLanguageCode {
  if (code === null || code === undefined) return false;
  return (SUPPORTED_LANGUAGE_CODES as readonly string[]).includes(code);
}

async function loadSampleData(youtubeUrl: string) {
  const id = getYoutubeVideoId(youtubeUrl);
  if (!isHeroDemoVideoId(id)) return null;
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) return null;
  return { id, sample };
}

export async function loadHeroDemoSummary(
  youtubeUrl: string,
): Promise<CachedSummary | null> {
  const resolved = await loadSampleData(youtubeUrl);
  if (!resolved) return null;
  const { id, sample } = resolved;

  let base;
  let summary: HeroSampleSummary;
  try {
    base = await sample.loadBase();
    // Mirror /summary chat (output_language IS NULL = native row): load
    // the video's native-language summary. Fall back to "en" if the
    // registry's nativeLanguage is outside the picker set, which keeps
    // the path resilient to a future non-English demo whose native
    // locale isn't one of the 17 we ship summaries for.
    const lang: SupportedLanguageCode = isSupportedLanguageCode(
      base.nativeLanguage,
    )
      ? base.nativeLanguage
      : "en";
    summary = await sample.loadSummary(lang);
  } catch (err) {
    console.error("[hero-demo-chat] sample summary load failed", {
      errorId: "HERO_DEMO_SUMMARY_LOAD_FAILED",
      videoId: id,
      err,
    });
    return null;
  }

  return {
    videoId: id,
    title: sample.title,
    channelName: sample.channel,
    language: "en",
    transcript: "",
    summary: summary.summary,
    transcriptSource: "auto_captions",
    model: summary.model,
    processingTimeSeconds: 0,
    transcribeTimeSeconds: 0,
    summarizeTimeSeconds: 0,
    outputLanguage: null,
  };
}

export async function loadHeroDemoTranscript(
  youtubeUrl: string,
): Promise<CachedTranscript | null> {
  const resolved = await loadSampleData(youtubeUrl);
  if (!resolved) return null;
  const { id, sample } = resolved;

  try {
    const base = await sample.loadBase();
    return {
      videoId: id,
      title: sample.title,
      channelName: sample.channel,
      segments: base.segments,
      transcriptSource: "auto_captions",
      language: "en",
    };
  } catch (err) {
    console.error("[hero-demo-chat] sample transcript load failed", {
      errorId: "HERO_DEMO_TRANSCRIPT_LOAD_FAILED",
      videoId: id,
      err,
    });
    return null;
  }
}
