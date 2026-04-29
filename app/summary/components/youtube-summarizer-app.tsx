"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import { useYouTubeSummarizer } from "@/lib/hooks/useYouTubeSummarizer";
import { useClipboard } from "@/lib/hooks/useClipboard";
import { useStageTimers } from "@/lib/hooks/useStageTimers";
import { AuthErrorBanner } from "./auth-error-banner";
import { ResultsDisplay } from "./results-display";
import { StreamingProgressIndicator } from "./streaming-progress";
import { StreamErrorBanner } from "./stream-error-banner";
import { LanguagePicker } from "./language-picker";
import { SummaryTabs } from "./summary-tabs";
import { ChatTab } from "./chat-tab";
import { PlayerRefProvider } from "@/lib/contexts/player-ref";
import type { SummaryResult } from "@/lib/types";
import {
  SUPPORTED_LANGUAGE_CODES,
  type SupportedLanguageCode,
} from "@/lib/constants/languages";
import { pickDefaultLanguage } from "@/lib/utils/browser-locale";
import { parseStreamingData, type StreamingProgress } from "../utils";
import YoutubeVideo from "./youtube-video";

interface YouTubeSummarizerAppProps {
  initialUrl: string | undefined;
}

export function YouTubeSummarizerApp({
  initialUrl,
}: YouTubeSummarizerAppProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [url, setUrl] = useState(initialUrl || "");
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingComplete, setStreamingComplete] = useState(false);
  const firstRenderRef = useRef(true);

  // `null` until the user actively picks a translation. Null = "ask the
  // server for the video-native summary" which reuses the existing NULL
  // cache row — no double-billing on first load.
  const [outputLanguage, setOutputLanguage] =
    useState<SupportedLanguageCode | null>(null);

  // Browser locale only drives the "Your language" menu hint. Computed once
  // on mount so ref-stable across re-renders. SSR-safe: `navigator` isn't
  // available during server render, so guard + fall back to English (the
  // util also defaults to "en" for the same reason). React hydration will
  // re-run this effect on the client.
  const [browserLanguage, setBrowserLanguage] =
    useState<SupportedLanguageCode>("en");
  useEffect(() => {
    const langs =
      typeof navigator !== "undefined" && navigator.languages
        ? Array.from(navigator.languages)
        : [];
    // TODO(B-followup): replace this hydration-flag pattern with
    // `useSyncExternalStore` over `navigator.languages` so the locale
    // detection is push-driven, not pulled-once-on-mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrowserLanguage(pickDefaultLanguage(langs, SUPPORTED_LANGUAGE_CODES));
  }, []);

  // Use custom hooks for complex logic
  const { summarizationQuery } = useYouTubeSummarizer(
    url,
    true,
    outputLanguage
  );

  const {
    data: rawData,
    error: queryError,
    isLoading,
    isFetching,
    fetchStatus,
  } = summarizationQuery;

  // Handle streaming data (array)
  // TODO(B-followup): split this useMemo into (a) a pure derivation
  // returning `{ data, streamingProgress, isCached, streamError }`
  // and (b) a separate `useEffect` keyed on the derivation that
  // owns the `setIsProcessing` / `setStreamingComplete` side
  // effects. The current shape interleaves derivation + state
  // mutation, which is what `react-hooks/set-state-in-render`
  // flags. Refactor is out of scope for B PR 6 (composites cluster).
  const { data, streamingProgress, isCached, streamError } = useMemo(() => {
    if ((isLoading || isFetching) && !rawData) {
      // eslint-disable-next-line react-hooks/set-state-in-render
      setIsProcessing(true);
      // eslint-disable-next-line react-hooks/set-state-in-render
      setStreamingComplete(false);
      return {
        data: undefined,
        streamingProgress: {
          stage: "preparing",
          message: "Initializing summary process...",
          progress: 5,
        } as StreamingProgress,
        isCached: false,
        streamError: null as string | null,
      };
    }

    if (Array.isArray(rawData) && rawData.length > 0) {
      const latestRawData = rawData[rawData.length - 1];

      if (latestRawData?.summary) {
        // eslint-disable-next-line react-hooks/set-state-in-render
        setIsProcessing(false);
        // Parse the streaming data to extract clean content and progress
        const parsed = parseStreamingData(latestRawData.summary);

        // Check if streaming is complete OR errored — either way the
        // stream has finished and the progress indicator should stop.
        if (
          parsed.streamError ||
          (parsed.progress?.stage === "complete" &&
            parsed.progress.progress === 100)
        ) {
          // eslint-disable-next-line react-hooks/set-state-in-render
          setStreamingComplete(true);
        }

        return {
          data: parsed.result,
          streamingProgress: parsed.progress,
          isCached: parsed.isCached,
          streamError: parsed.streamError,
        };
      }
      return {
        data: latestRawData,
        streamingProgress: null,
        isCached: false,
        streamError: null as string | null,
      };
    }

    return {
      data: rawData as SummaryResult | undefined,
      streamingProgress: null,
      isCached: false,
      streamError: null as string | null,
    };
  }, [rawData, isLoading, isFetching]);

  // data.transcriptionTime/summaryTime only land with the terminal
  // `summary` event; tick wall-clock until then.
  const { transcriptionTime, summaryTime } = useStageTimers(
    streamingProgress?.stage,
    {
      transcriptionTime: data?.transcriptionTime,
      summaryTime: data?.summaryTime,
    }
  );

  const dataWithLiveTimers = useMemo<SummaryResult | undefined>(
    () =>
      data ? { ...data, transcriptionTime, summaryTime } : undefined,
    [data, transcriptionTime, summaryTime]
  );

  // Detect if this is a cached result from query status.
  // TODO(B-followup): collapse the cache-detection effect into the
  // derivation above so React state stays in lockstep with the
  // streaming snapshot rather than being patched after-the-fact in
  // an effect.
  useEffect(() => {
    // If we already detected it's cached from metadata, don't change it
    if (isCached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStreamingComplete(true);
      return;
    }

    // Otherwise check the query status
    if (rawData && !isLoading && !isFetching && fetchStatus === "idle") {
      setStreamingComplete(true);
    }
  }, [rawData, isLoading, isFetching, fetchStatus, isCached]);

  // Handle first render with cached results
  useEffect(() => {
    if (isCached && firstRenderRef.current) {
      firstRenderRef.current = false;
      setStreamingComplete(true);
    }
  }, [isCached]);

  const { copied, copyToClipboard } = useClipboard();

  // Fetch summary when component mounts or language changes. The hook uses
  // `enabled: false`, so a queryKey change alone doesn't auto-refetch —
  // depending on [url, outputLanguage] here gives us both the initial mount
  // fire and the language-switch re-run without a second effect.
  useEffect(() => {
    if (url) {
      firstRenderRef.current = true;
      summarizationQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, outputLanguage]);

  const handleCopySummary = async () => {
    if (!data) return;

    const textToCopy = `${data?.title}\n\n${data?.summary}`;
    await copyToClipboard(textToCopy);
  };

  const handleNewSummary = () => {
    setUrl("");
    router.push("/");
  };

  const handleLanguageSelect = (code: SupportedLanguageCode) => {
    // Picking the same code as the current state is a no-op — the effect
    // above would pointlessly refetch and cache-hit, but it also clears the
    // rendered content briefly. Short-circuit before that.
    if (code === outputLanguage) return;
    // Cancel the in-flight stream (if any) so a user rapidly switching
    // Spanish → French doesn't leave an orphan `es` LLM call streaming on
    // the backend that still writes its cache row. cancelQueries fires the
    // AbortSignal passed into fetchStreamingSummary, which the route
    // handler observes via request.signal.aborted and exits without
    // writing the cache.
    //
    // Fire-and-forget with an explicit catch: if React Query's internals
    // reject, an unhandled rejection would mask the "why did I get billed
    // twice" user report from debugging logs.
    queryClient
      .cancelQueries({
        queryKey: ["youtube-summary-stream", url],
        exact: false,
      })
      .catch((err) =>
        console.error("[language-switch] cancelQueries failed", { err })
      );
    setOutputLanguage(code);
  };

  // Chat unlocks once the summary is on the page (live stream finished
  // OR cached row resolved). Both produce `dataWithLiveTimers`, and a
  // hard error suppresses both, so this single condition covers both
  // paths without touching the streaming state machine.
  const chatLocked = !dataWithLiveTimers || !!streamError;
  // Suppress the auto-bounce-away-from-?tab=chat effect while we're
  // still in the *initial* cache lookup (`isLoading`, narrower than
  // `isFetching`). A reload of a cached summary then stays on the
  // Chat tab once the cache hits. We deliberately do NOT include
  // `isFetching` here: that flag stays true for the duration of an
  // active stream too, which would lock a fresh-URL `?tab=chat` deep
  // link onto a disabled tab for the whole 30–60s of streaming.
  const chatLockPending = isLoading && !rawData && !streamError;

  const summaryContent = (
    <>
      <AuthErrorBanner authError={queryError?.message} />
      {streamError && <StreamErrorBanner message={streamError} />}
      {!streamError && (streamingProgress || isProcessing) && (
        <>
          {!dataWithLiveTimers && (
            <div className="flex justify-end mb-3">
              <LanguagePicker
                currentLanguage={outputLanguage ?? null}
                browserLanguage={browserLanguage}
                onSelect={handleLanguageSelect}
                isDark={isDark}
              />
            </div>
          )}
          <StreamingProgressIndicator
            progress={
              streamingProgress || {
                stage: "preparing",
                message: "Starting summary process...",
                progress: 5,
              }
            }
          />
        </>
      )}
      {dataWithLiveTimers && !streamError && (
        <ResultsDisplay
          data={dataWithLiveTimers}
          copied={copied}
          onCopySummary={handleCopySummary}
          onNewSummary={handleNewSummary}
          outputLanguage={outputLanguage}
          browserLanguage={browserLanguage}
          onSelectLanguage={handleLanguageSelect}
          languageDisabled={false}
        />
      )}
    </>
  );

  const chatContent = <ChatTab youtubeUrl={url || null} active={!chatLocked} />;

  return (
    <PlayerRefProvider>
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <SummaryTabs
              chatLocked={chatLocked}
              chatLockPending={chatLockPending}
              summaryContent={summaryContent}
              chatContent={chatContent}
            />
          </div>
          <div className="sticky top-[138px] w-full">
            <YoutubeVideo
              url={url}
              width={600}
              segments={data?.segments}
              streamingComplete={streamingComplete}
            />
          </div>
        </div>
      </div>
    </PlayerRefProvider>
  );
}
