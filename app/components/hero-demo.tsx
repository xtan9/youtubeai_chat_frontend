"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "next-themes";
import { usePostHog } from "posthog-js/react";
import type { YouTubePlayer } from "react-youtube";

import { ChatTab } from "@/app/summary/components/chat-tab";
import TranscriptParagraphs from "@/app/summary/components/transcript-paragraphs";
import { LanguagePicker } from "@/app/summary/components/language-picker";
import { useAnonSession } from "@/lib/hooks/useAnonSession";
import { buildSummaryMarkdownComponents } from "@/app/summary/components/summary-markdown-renderer";
import { PlayerRefProvider } from "@/lib/contexts/player-ref";
import { pickDefaultLanguage } from "@/lib/utils/browser-locale";
import {
  SUPPORTED_LANGUAGE_CODES,
  type SupportedLanguageCode,
} from "@/lib/constants/languages";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  SAMPLES,
  formatDuration,
  youtubeUrlFor,
  type HeroSampleBase,
  type HeroSampleSummary,
  type SampleMeta,
} from "./hero-demo-data";

// HeroPlayer pulls react-youtube which touches `window` at import time —
// next/dynamic keeps it out of the SSR bundle. HeroThumbnailGrid uses
// next/image which is server-safe but the surrounding component is
// client-only anyway, so dynamic-importing keeps both grid + player on
// their own chunks.
const HeroPlayer = dynamic(() => import("./hero-player"), { ssr: false });
const HeroThumbnailGrid = dynamic(() => import("./hero-thumbnail-grid"), {
  ssr: false,
});

/**
 * Interactive hero widget for the marketing homepage. Three columns
 * sharing a 600px lg height:
 *
 * 1. Playable react-youtube embed for the active sample, title +
 *    channel · duration line, and a 2×3 thumbnail grid of all six
 *    samples filling the remaining vertical space.
 * 2. Summary | Transcript tabs. Summary tab carries a live
 *    LanguagePicker (17 langs pre-cached) that swaps the rendered
 *    markdown without touching the network. Transcript tab uses the
 *    /summary `<TranscriptParagraphs>` component for paragraph-grouped
 *    click-to-seek timestamps that drive the embedded player.
 * 3. Live `<ChatTab>` against the active sample. Anonymous visitors
 *    can chat the demo videos without a sign-up wall (the API allowlist
 *    in app/api/chat/stream/route.ts is keyed off the same
 *    HERO_DEMO_VIDEO_IDS this registry uses). Chat answers' `[mm:ss]`
 *    chips seek the embedded player via the page-level
 *    PlayerRefProvider.
 */
export default function HeroDemo() {
  return (
    <PlayerRefProvider>
      <HeroDemoInner />
    </PlayerRefProvider>
  );
}

function HeroDemoInner() {
  useAnonSession();
  const posthog = usePostHog();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const markdownComponents = buildSummaryMarkdownComponents({ isDark });

  const playerRef = useRef<YouTubePlayer | null>(null);
  const [activeId, setActiveId] = useState<string>(SAMPLES[0].id);
  const [tab, setTab] = useState<"summary" | "transcript">("summary");
  const [base, setBase] = useState<HeroSampleBase | null>(null);
  const [language, setLanguage] = useState<SupportedLanguageCode>("en");
  const [browserLanguage, setBrowserLanguage] =
    useState<SupportedLanguageCode>("en");
  const [summary, setSummary] = useState<HeroSampleSummary | null>(null);
  const [fading, setFading] = useState(false);

  // Detect browser language post-mount to tag the picker entry. We do
  // NOT auto-switch the picker — first paint stays deterministic on
  // English; user-driven selection wins.
  useEffect(() => {
    const langs =
      typeof navigator !== "undefined" && navigator.languages
        ? Array.from(navigator.languages)
        : [];
    // navigator.languages is a one-time mount read here, not a
    // derived-state-in-effect anti-pattern. Same shape /summary uses
    // (youtube-summarizer-app.tsx:67) — see TODO(B-followup) there for
    // the eventual useSyncExternalStore migration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrowserLanguage(pickDefaultLanguage(langs, SUPPORTED_LANGUAGE_CODES));
  }, []);

  // Lazy-load the active sample's base (transcript + meta).
  useEffect(() => {
    const sample = SAMPLES.find((s) => s.id === activeId);
    if (!sample) return;
    let cancelled = false;
    sample
      .loadBase()
      .then((b) => {
        if (!cancelled) setBase(b);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(`[hero-demo] loadBase ${activeId}:`, err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Lazy-load the active (sample, language) summary; fade column 2 so
  // the swap reads as intentional rather than a layout flash.
  useEffect(() => {
    const sample = SAMPLES.find((s) => s.id === activeId);
    if (!sample) return;
    // setFading is the visible side-effect that gates the lazy-load.
    // The fade-out has to paint synchronously with the activeId/lang
    // change so the fadeDelay setTimeout has something to flip back
    // after the import lands. Restructuring this into a derived value
    // would lose the fade beat.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFading(true);
    let cancelled = false;
    const fadeDelay = setTimeout(() => {
      sample
        .loadSummary(language)
        .then((s) => {
          if (cancelled) return;
          setSummary(s);
          setFading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error(
            `[hero-demo] loadSummary ${activeId}/${language}:`,
            err,
          );
          setFading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(fadeDelay);
    };
  }, [activeId, language]);

  const sample = SAMPLES.find((s) => s.id === activeId)! as SampleMeta;
  const sampleUrl = youtubeUrlFor(sample.id);
  const fullSummaryHref = `/summary?url=${encodeURIComponent(sampleUrl)}`;

  const handleSelect = (id: string) => {
    if (id === activeId) return;
    const next = SAMPLES.find((s) => s.id === id);
    if (!next) return;
    setActiveId(id);
    posthog?.capture("hero_demo_sample_selected", {
      sample_id: next.id,
      sample_title: next.title,
    });
  };

  return (
    <section className="mx-auto max-w-page px-4 mb-16 w-full">
      <div className="grid gap-6 lg:grid-cols-[3fr_3.5fr_3.5fr] lg:items-stretch">
        {/* Col 1 — playable video + 2×3 thumbnail grid */}
        <div className="flex flex-col gap-4 min-w-0 lg:h-150">
          <HeroPlayer
            key={activeId}
            videoId={activeId}
            playerRef={playerRef}
          />
          <div>
            <h3 className="text-h5 text-text-primary line-clamp-2">
              {sample.title}
            </h3>
            <p className="text-body-sm text-text-muted mt-1">
              {sample.channel} · {formatDuration(sample.durationSec)}
            </p>
          </div>
          <div className="flex-1 min-h-0">
            <HeroThumbnailGrid
              samples={SAMPLES}
              activeId={activeId}
              onSelect={handleSelect}
            />
          </div>
        </div>

        {/* Col 2 — Summary | Transcript */}
        <div
          className={`flex flex-col min-w-0 lg:h-150 ${
            fading ? "opacity-0" : "opacity-100"
          } motion-safe:transition-opacity duration-base`}
        >
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "summary" | "transcript")}
            className="flex flex-col gap-3 h-full"
          >
            <div className="flex items-center justify-between gap-2">
              <TabsList className="self-start">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="transcript">Transcript</TabsTrigger>
              </TabsList>
              {tab === "summary" && (
                <LanguagePicker
                  currentLanguage={language}
                  browserLanguage={browserLanguage}
                  onSelect={(code) => setLanguage(code)}
                  isDark={isDark}
                />
              )}
            </div>

            <TabsContent value="summary" className="mt-0 flex-1 min-h-0">
              <div className="bg-surface-raised border border-border-subtle rounded-xl p-6 h-full overflow-auto">
                <div className="prose max-w-none dark:prose-invert">
                  {summary ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {summary.summary}
                    </ReactMarkdown>
                  ) : (
                    <SummarySkeleton />
                  )}
                </div>
                <div className="mt-4 pt-4 border-t border-border-subtle">
                  <a
                    href={fullSummaryHref}
                    className="text-body-sm text-accent-brand hover:underline"
                  >
                    View full summary on /summary →
                  </a>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="transcript" className="mt-0 flex-1 min-h-0">
              <div className="bg-surface-raised border border-border-subtle rounded-xl h-full overflow-hidden">
                {base ? (
                  <TranscriptParagraphs
                    segments={base.segments}
                    playerRef={playerRef}
                  />
                ) : (
                  <TranscriptSkeleton />
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Col 3 — Chat */}
        <div className="min-w-0 lg:h-150">
          <ChatTab
            youtubeUrl={sampleUrl}
            active={true}
            className="h-full"
            suggestionsOverride={summary?.suggestions}
          />
        </div>
      </div>
    </section>
  );
}

function SummarySkeleton() {
  return (
    <div className="space-y-3 animate-pulse" aria-hidden="true">
      <div className="h-4 bg-surface-sunken rounded w-3/4" />
      <div className="h-4 bg-surface-sunken rounded w-full" />
      <div className="h-4 bg-surface-sunken rounded w-5/6" />
      <div className="h-4 bg-surface-sunken rounded w-4/5" />
    </div>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="space-y-2 animate-pulse p-4" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-4 bg-surface-sunken rounded w-full" />
      ))}
    </div>
  );
}
