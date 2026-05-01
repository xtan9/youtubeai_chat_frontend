"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePostHog } from "posthog-js/react";

import { ChatTab } from "@/app/summary/components/chat-tab";
import { useAnonSession } from "@/lib/hooks/useAnonSession";
import { buildSummaryMarkdownComponents } from "@/app/summary/components/summary-markdown-renderer";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  SAMPLES,
  formatDuration,
  formatTimestamp,
  thumbnailUrlFor,
  youtubeUrlFor,
  type SampleData,
  type SampleMeta,
} from "./hero-demo-data";

/**
 * Interactive hero widget for the marketing homepage. Three columns:
 *
 * 1. Active video thumbnail + title/channel/duration + horizontal-scroll
 *    carousel of all samples.
 * 2. `Summary | Transcript` tabs rendering the active sample's real
 *    cached output.
 * 3. Live `<ChatTab>` against the active sample — visitor can actually
 *    chat with the AI; anon caps + paywall banners are handled by the
 *    underlying chat code.
 *
 * Bootstraps a Supabase anonymous session up-front so the embedded
 * <ChatTab> can authenticate without `/summary` being mounted first.
 *
 * Heavy per-sample data (full markdown summary + 30 transcript segments)
 * is dynamically imported on selection so the homepage initial chunk
 * stays small.
 */
export default function HeroDemo() {
  useAnonSession();
  const posthog = usePostHog();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const markdownComponents = buildSummaryMarkdownComponents({ isDark });

  const [activeId, setActiveId] = useState<string>(SAMPLES[0].id);
  const [tab, setTab] = useState<"summary" | "transcript">("summary");
  const [data, setData] = useState<SampleData | null>(null);
  const [fading, setFading] = useState(false);

  // Lazy-load the active sample's heavy data after the fade-out window.
  // `fading=true` is set synchronously by the click handler so the fade
  // paints before `import()` blocks the main thread; this effect waits
  // 250ms for the paint, fetches the chunk, and clears the fade.
  //
  // The `cancelled` flag protects against rapid sample switches: when
  // the user clicks A, then B before A's import resolves, A's `then`
  // would otherwise overwrite B's content with stale data. Cancelling
  // also recovers from a permanently-stuck fade if the chunk 404s on a
  // mid-deploy request — `setFading(false)` runs in both branches.
  useEffect(() => {
    const sample = SAMPLES.find((s) => s.id === activeId);
    if (!sample) return;
    let cancelled = false;
    const fadeDelay = setTimeout(() => {
      sample
        .loadFullData()
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setFading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error(`[hero-demo] failed to load sample ${sample.id}:`, err);
          // End the fade so the user isn't staring at an empty box.
          // We deliberately keep prior `data` so the previous sample's
          // content stays readable while we recover.
          setFading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(fadeDelay);
    };
  }, [activeId]);

  const sample = SAMPLES.find((s) => s.id === activeId)!;

  const handleSelect = (s: SampleMeta) => {
    if (s.id === activeId) return;
    setFading(true);
    setActiveId(s.id);
    posthog?.capture("hero_demo_sample_selected", {
      sample_id: s.id,
      sample_title: s.title,
    });
  };

  const sampleUrl = youtubeUrlFor(sample.id);
  const fullSummaryHref = `/summary?url=${encodeURIComponent(sampleUrl)}`;

  return (
    <section className="mx-auto max-w-page px-4 mb-16 w-full">
      <div className="grid gap-6 lg:grid-cols-[3fr_3.5fr_3.5fr]">
        {/* Col 1 — active video + carousel */}
        <div className="flex flex-col gap-4 min-w-0">
          <a
            href={sampleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block group relative overflow-hidden rounded-xl border border-border-subtle"
            aria-label={`Watch ${sample.title} on YouTube`}
          >
            <div className="relative aspect-video bg-surface-sunken">
              <Image
                src={thumbnailUrlFor(sample.id)}
                alt={`${sample.title} — thumbnail`}
                fill
                sizes="(min-width: 1024px) 30vw, 100vw"
                className="object-cover"
                priority
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-base" />
            </div>
          </a>
          <div>
            <h3 className="text-h5 text-text-primary line-clamp-2">
              {sample.title}
            </h3>
            <p className="text-body-sm text-text-muted mt-1">
              {sample.channel} · {formatDuration(sample.durationSec)}
            </p>
          </div>
          {/* A toggle-button group, not a listbox: each card is a button
              with `aria-pressed` so the press-state is announced to AT.
              Using `role="listbox"` here would require option/listbox
              semantics on the children (arrow-key nav, aria-selected),
              which fight the toggle-button pattern. */}
          <div
            role="group"
            aria-label="Sample videos"
            className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin"
          >
            {SAMPLES.map((s) => {
              const active = s.id === activeId;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={active}
                  aria-label={s.title}
                  onClick={() => handleSelect(s)}
                  className={`shrink-0 w-30 flex flex-col gap-1 rounded-lg p-1.5 border transition-colors duration-base cursor-pointer ${
                    active
                      ? "border-accent-brand ring-2 ring-accent-brand/30"
                      : "border-border-subtle hover:border-border-default"
                  }`}
                >
                  <div className="relative w-full aspect-video rounded overflow-hidden bg-surface-sunken">
                    <Image
                      src={thumbnailUrlFor(s.id)}
                      alt=""
                      fill
                      sizes="120px"
                      className="object-cover"
                    />
                  </div>
                  <span className="text-body-xs text-text-primary line-clamp-2 text-left leading-snug">
                    {s.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Col 2 — Summary / Transcript */}
        <div
          className={`flex flex-col min-w-0 ${
            fading ? "opacity-0" : "opacity-100"
          } motion-safe:transition-opacity duration-base`}
        >
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "summary" | "transcript")}
            className="flex flex-col gap-3"
          >
            <TabsList className="self-start">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
            </TabsList>
            <TabsContent value="summary" className="mt-0">
              <div className="bg-surface-raised border border-border-subtle rounded-xl p-6 max-h-[560px] overflow-auto">
                <div className="prose max-w-none dark:prose-invert">
                  {data ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {data.summary}
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
            <TabsContent value="transcript" className="mt-0">
              <div className="bg-surface-raised border border-border-subtle rounded-xl p-4 max-h-[560px] overflow-auto">
                {data ? (
                  <ul className="space-y-3">
                    {data.segments.map((seg, i) => (
                      <li
                        key={i}
                        className="flex gap-3 items-start"
                      >
                        <span className="shrink-0 inline-block bg-surface-sunken text-text-secondary text-caption font-mono rounded px-1.5 py-0.5 mt-0.5">
                          {formatTimestamp(seg.start)}
                        </span>
                        <span className="text-body-sm text-text-primary leading-relaxed">
                          {seg.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <TranscriptSkeleton />
                )}
                <div className="mt-4 pt-4 border-t border-border-subtle">
                  <a
                    href={fullSummaryHref}
                    className="text-body-sm text-accent-brand hover:underline"
                  >
                    View full transcript on /summary →
                  </a>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Col 3 — Chat */}
        <div className="min-w-0">
          <ChatTab
            youtubeUrl={sampleUrl}
            active={true}
            className="h-[480px] lg:h-[560px]"
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
    <div className="space-y-2 animate-pulse" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-4 bg-surface-sunken rounded w-full" />
      ))}
    </div>
  );
}
