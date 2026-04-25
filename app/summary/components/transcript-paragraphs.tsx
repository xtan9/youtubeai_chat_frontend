"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTheme } from "next-themes";
import type { YouTubePlayer } from "react-youtube";
import type { TranscriptSegment } from "@/lib/types";
import {
  formatTimestamp,
  groupSegments,
  type TranscriptParagraph,
} from "../utils/group-segments";

interface TranscriptParagraphsProps {
  segments: readonly TranscriptSegment[];
  playerRef: MutableRefObject<YouTubePlayer | null>;
}

// Long-paragraph threshold for the per-paragraph "Read More" toggle. Picked
// for the visual rhythm shown in the reference design — about two lines of
// text on a typical viewport.
const LONG_PARAGRAPH_CHAR_THRESHOLD = 280;

// Active-paragraph polling cadence. 250 ms is well below the 30s paragraph
// granularity so a click doesn't visibly lag the highlight.
const POLL_INTERVAL_MS = 250;

// Auto-scroll holds back this long after a manual scroll so the user can
// read past the active paragraph without the view fighting them. 2 s is
// enough to land a scroll gesture and not so long that a forgotten scroll
// permanently disables the follow-along.
const USER_SCROLL_GRACE_MS = 2000;

// Distinguish a transient teardown reject (1-2 ticks during unmount) from
// a permanently-broken player (every tick fails). 8 ticks ≈ 2 seconds.
// Below that, stay quiet; at the threshold, log once with a stable errorId
// so a YouTube IFrame API regression is alertable instead of silently
// freezing the highlight.
const POLL_FAILURE_LOG_THRESHOLD = 8;

const TranscriptParagraphs = ({
  segments,
  playerRef,
}: TranscriptParagraphsProps) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const paragraphs = useMemo<TranscriptParagraph[]>(
    () => groupSegments(segments),
    [segments]
  );

  // Active paragraph index drives both the highlight ring and the
  // auto-scroll target. `-1` until the first poll so we don't highlight
  // paragraph 0 before playback starts (which would be a lie about where
  // the user is in the video).
  const [activeIndex, setActiveIndex] = useState(-1);

  // Per-paragraph expanded state so the user's "Read More" choice survives
  // until they explicitly collapse it. Active paragraphs get auto-expanded
  // for readability but stay user-controllable on the inactive ones.
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const paragraphRefs = useRef<Array<HTMLDivElement | null>>([]);
  const lastUserScrollAt = useRef<number>(0);
  // Counts consecutive getCurrentTime() rejects so we can distinguish a
  // transient teardown blip from a permanently-broken player and only log
  // once when it tips into "really broken."
  const consecutivePollFailures = useRef<number>(0);
  const stuckLogged = useRef<boolean>(false);

  // Poll the player time and resolve which paragraph contains it. The
  // YouTube Player API is async/promise-based so we coerce both the
  // happy and rejected paths into a no-op to keep the loop simple.
  useEffect(() => {
    if (paragraphs.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      const player = playerRef.current;
      if (!player) return;
      let now: number;
      try {
        now = await player.getCurrentTime();
        consecutivePollFailures.current = 0;
        stuckLogged.current = false;
      } catch (err) {
        // The player can transiently throw during teardown — treat as
        // "no update this tick" rather than poisoning the highlight.
        // But a permanent failure (YouTube IFrame API regression, player
        // crash) would otherwise burn silently forever; surface that
        // case once so it's alertable in Sentry.
        consecutivePollFailures.current += 1;
        if (
          consecutivePollFailures.current >= POLL_FAILURE_LOG_THRESHOLD &&
          !stuckLogged.current
        ) {
          stuckLogged.current = true;
          console.error("[transcript] TRANSCRIPT_POLL_STUCK", {
            errorId: "TRANSCRIPT_POLL_STUCK",
            consecutiveFailures: consecutivePollFailures.current,
            err,
          });
        }
        return;
      }
      if (cancelled) return;
      // Find the paragraph whose [start, end) window covers `now`. The
      // active paragraph from the previous tick is checked first because
      // it's almost always still correct — a hot path optimization that
      // avoids walking the array each tick during normal playback.
      let next = activeIndex;
      const stillActive =
        next >= 0 &&
        next < paragraphs.length &&
        now >= paragraphs[next].start &&
        now < paragraphs[next].end;
      if (!stillActive) {
        next = paragraphs.findIndex(
          (p) => now >= p.start && now < p.end
        );
      }
      if (next !== activeIndex) setActiveIndex(next);
    };
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [paragraphs, playerRef, activeIndex]);

  // Auto-scroll the active paragraph into view, but yield to manual scrolls
  // for a grace window — a user reading ahead shouldn't have the view yanked
  // back to the playhead every tick.
  useEffect(() => {
    if (activeIndex < 0) return;
    const sinceUserScroll = Date.now() - lastUserScrollAt.current;
    if (sinceUserScroll < USER_SCROLL_GRACE_MS) return;
    const node = paragraphRefs.current[activeIndex];
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex]);

  // Manual-scroll detection. Stamping in a ref instead of state avoids the
  // re-render firestorm a 60Hz scroll event would cause.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      lastUserScrollAt.current = Date.now();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  if (paragraphs.length === 0) return null;

  // Legacy backfill rows arrive as `{start: 0, duration: 0}`. The active-
  // paragraph picker uses `[start, end)` which is empty when start === end,
  // so the highlight never fires. Detect that case and surface the reason
  // inline — better than letting the user think the timestamps are broken.
  const hasNoTimingData = paragraphs.every((p) => p.end === p.start);

  const onTimestampClick = async (start: number) => {
    const player = playerRef.current;
    if (!player) return;
    // Split into two stages so the failure modes don't blur:
    //   - seekTo failure means the click felt inert (cursor unchanged) —
    //     promote to errorId-tagged error so it's alertable.
    //   - playVideo failure (typically autoplay-policy denial) means the
    //     cursor moved but playback is paused — recoverable, the user
    //     can hit play themselves; warn at console-info level only.
    try {
      await player.seekTo(start, true);
    } catch (err) {
      console.error("[transcript] TRANSCRIPT_SEEK_FAILED", {
        errorId: "TRANSCRIPT_SEEK_FAILED",
        start,
        err,
      });
      return;
    }
    try {
      await player.playVideo();
    } catch (err) {
      console.warn("[transcript] playVideo rejected (autoplay policy?)", {
        err,
      });
    }
  };

  return (
    <Card
      className={`p-4 w-full ${
        isDark
          ? "bg-slate-800/80 border-slate-700"
          : "bg-white border-slate-200"
      }`}
    >
      <h3
        className={`text-sm font-semibold mb-3 ${
          isDark ? "text-cyan-300/80" : "text-cyan-700/80"
        }`}
      >
        Video Transcript
      </h3>
      {hasNoTimingData && (
        <p
          className={`text-xs mb-3 italic ${
            isDark ? "text-slate-400" : "text-slate-500"
          }`}
        >
          Timestamps not available for this transcript — click won&apos;t seek.
        </p>
      )}
      <div
        ref={containerRef}
        className="overflow-y-auto max-h-[600px] pr-2 space-y-4"
      >
        {paragraphs.map((p, i) => {
          const isLong = p.text.length > LONG_PARAGRAPH_CHAR_THRESHOLD;
          const isActive = i === activeIndex;
          const isExpanded = isActive || expanded[i] === true;
          return (
            <div
              key={`${p.start}-${i}`}
              ref={(el) => {
                paragraphRefs.current[i] = el;
              }}
              className={`pl-3 border-l-4 transition-colors ${
                isActive
                  ? isDark
                    ? "border-cyan-400 bg-slate-700/40"
                    : "border-cyan-500 bg-cyan-50"
                  : "border-transparent"
              }`}
            >
              <button
                type="button"
                onClick={() => onTimestampClick(p.start)}
                className={`text-sm font-semibold mb-1 hover:underline focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  isDark
                    ? "text-rose-300 focus:ring-rose-400"
                    : "text-rose-600 focus:ring-rose-500"
                }`}
                aria-label={`Jump to ${formatTimestamp(p.start)}`}
              >
                {formatTimestamp(p.start)}
              </button>
              <p
                className={`text-sm leading-relaxed ${
                  isDark ? "text-slate-300" : "text-slate-700"
                } ${isExpanded || !isLong ? "" : "line-clamp-2"}`}
              >
                {p.text}
              </p>
              {isLong && !isActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [i]: !prev[i] }))
                  }
                  className={`mt-1 px-0 h-auto text-xs ${
                    isDark
                      ? "text-slate-400 hover:text-slate-200"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {expanded[i] ? "Show less" : "Read More"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export default TranscriptParagraphs;
