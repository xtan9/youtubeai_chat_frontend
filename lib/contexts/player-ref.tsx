"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { YouTubePlayer } from "react-youtube";

export interface YouTubePlayerHandle {
  seekTo(seconds: number, allowSeekAhead?: boolean): void | Promise<void>;
  playVideo?(): void | Promise<void>;
  pauseVideo?(): void | Promise<void>;
  getCurrentTime?(): number | Promise<number>;
  getPlayerState?(): number | Promise<number>;
}

export function createYouTubePlayerHandle(
  player: YouTubePlayer,
): YouTubePlayerHandle {
  return {
    seekTo: (seconds, allowSeekAhead) =>
      player.seekTo(seconds, allowSeekAhead ?? true),
    playVideo: () => player.playVideo(),
    pauseVideo: () => player.pauseVideo(),
    getCurrentTime: () => player.getCurrentTime(),
    getPlayerState: () => player.getPlayerState(),
  };
}

interface PlayerRefValue {
  readonly registerPlayer: (handle: YouTubePlayerHandle | null) => void;
  readonly clearPlaybackBoundary: () => void;
  readonly seekTo: (seconds: number) => void;
  readonly playRange: (startSeconds: number, endSeconds: number) => void;
}

const PlayerRefContext = createContext<PlayerRefValue | null>(null);
const RANGE_PLAYBACK_POLL_MS = 250;
const RANGE_END_OFFSET_SECONDS = 1;
const RANGE_SEEK_CONFIRM_MAX_POLLS = 8;
const RANGE_PLAYBACK_START_MAX_POLLS = 8;
// A delayed timer/read can legitimately skip several seconds (background
// tabs throttle timers), so only treat a very large jump as an in-player seek.
const RANGE_MAX_NATURAL_PROGRESS_SECONDS = 10;
const YOUTUBE_PLAYER_STATE = {
  unstarted: -1,
  ended: 0,
  playing: 1,
  paused: 2,
  buffering: 3,
  cued: 5,
} as const;

function isStoppedPlayerState(state: number): boolean {
  return (
    state === YOUTUBE_PLAYER_STATE.ended ||
    state === YOUTUBE_PLAYER_STATE.paused ||
    state === YOUTUBE_PLAYER_STATE.cued
  );
}

/**
 * Lifts the YouTube player handle out of `youtube-video.tsx` so sibling
 * components (the chat tab's timestamp chips) can seek the player without
 * prop-drilling. Components that aren't wrapped in this provider see a
 * no-op fallback — keeps unit tests that don't mount the player from
 * crashing.
 */
export function PlayerRefProvider({ children }: { children: ReactNode }) {
  const handleRef = useRef<YouTubePlayerHandle | null>(null);
  const monitorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackSessionRef = useRef(0);
  const clearPlaybackBoundary = useCallback(() => {
    playbackSessionRef.current += 1;
    if (monitorTimerRef.current !== null) {
      clearTimeout(monitorTimerRef.current);
      monitorTimerRef.current = null;
    }
  }, []);
  const registerPlayer = useCallback(
    (handle: YouTubePlayerHandle | null) => {
      clearPlaybackBoundary();
      handleRef.current = handle;
    },
    [clearPlaybackBoundary],
  );
  const seekTo = useCallback(
    (seconds: number) => {
      clearPlaybackBoundary();
      const handle = handleRef.current;
      if (!handle) return;
      handle.seekTo(seconds, true);
      // Some browsers pause the iframe when seeking from a UI click while
      // the video isn't yet playing. Resume so a click on a timestamp chip
      // always lands on a *playing* moment, matching the existing
      // transcript-paragraphs UX.
      handle.playVideo?.();
    },
    [clearPlaybackBoundary],
  );
  const playRange = useCallback((startSeconds: number, endSeconds: number) => {
    clearPlaybackBoundary();
    const handle = handleRef.current;
    if (!handle) return;

    handle.seekTo(startSeconds, true);
    handle.playVideo?.();

    const getCurrentTime = handle.getCurrentTime;
    const pauseVideo = handle.pauseVideo;
    if (!getCurrentTime || !pauseVideo) return;
    const boundarySeconds = endSeconds + RANGE_END_OFFSET_SECONDS;
    const playbackSession = playbackSessionRef.current;
    let hasStartedPlaying = false;
    let seekConfirmed = false;
    let seekConfirmationPolls = 0;
    let playbackStartPolls = 0;
    let lastObservedSeconds: number | null = null;
    const monitor = async () => {
      monitorTimerRef.current = null;
      if (
        playbackSessionRef.current !== playbackSession ||
        handleRef.current !== handle
      ) {
        return;
      }
      try {
        if (handle.getPlayerState) {
          const playerState = await handle.getPlayerState();
          if (
            playbackSessionRef.current !== playbackSession ||
            handleRef.current !== handle
          ) {
            return;
          }
          if (playerState === YOUTUBE_PLAYER_STATE.playing) {
            hasStartedPlaying = true;
          } else if (
            isStoppedPlayerState(playerState) ||
            (playerState === YOUTUBE_PLAYER_STATE.unstarted &&
              hasStartedPlaying) ||
            (playerState === YOUTUBE_PLAYER_STATE.buffering &&
              hasStartedPlaying)
          ) {
            clearPlaybackBoundary();
            return;
          } else if (!hasStartedPlaying) {
            playbackStartPolls += 1;
            if (playbackStartPolls >= RANGE_PLAYBACK_START_MAX_POLLS) {
              clearPlaybackBoundary();
              return;
            }
          }
        }
        const currentSeconds = await getCurrentTime();
        if (
          !Number.isFinite(currentSeconds) ||
          playbackSessionRef.current !== playbackSession ||
          handleRef.current !== handle
        ) {
          return;
        }
        if (!seekConfirmed) {
          if (
            currentSeconds < startSeconds ||
            currentSeconds >= boundarySeconds
          ) {
            seekConfirmationPolls += 1;
            if (seekConfirmationPolls >= RANGE_SEEK_CONFIRM_MAX_POLLS) {
              clearPlaybackBoundary();
              return;
            }
            monitorTimerRef.current = setTimeout(
              monitor,
              RANGE_PLAYBACK_POLL_MS,
            );
            return;
          }
          seekConfirmed = true;
          lastObservedSeconds = currentSeconds;
        } else {
          const jumpedDuringPlayback =
            lastObservedSeconds !== null &&
            Math.abs(currentSeconds - lastObservedSeconds) >
              RANGE_MAX_NATURAL_PROGRESS_SECONDS;
          if (currentSeconds < startSeconds || jumpedDuringPlayback) {
            clearPlaybackBoundary();
            return;
          }
        }
        if (currentSeconds >= boundarySeconds) {
          clearPlaybackBoundary();
          await pauseVideo();
          return;
        }
        lastObservedSeconds = currentSeconds;
      } catch {
        if (
          playbackSessionRef.current !== playbackSession ||
          handleRef.current !== handle
        ) {
          return;
        }
      }
      monitorTimerRef.current = setTimeout(
        monitor,
        RANGE_PLAYBACK_POLL_MS,
      );
    };
    monitorTimerRef.current = setTimeout(monitor, RANGE_PLAYBACK_POLL_MS);
  }, [clearPlaybackBoundary]);
  useEffect(
    () => () => {
      clearPlaybackBoundary();
      handleRef.current = null;
    },
    [clearPlaybackBoundary],
  );
  return (
    <PlayerRefContext.Provider
      value={{
        registerPlayer,
        clearPlaybackBoundary,
        seekTo,
        playRange,
      }}
    >
      {children}
    </PlayerRefContext.Provider>
  );
}

/**
 * Returns the page-level player handle. When called outside a
 * `PlayerRefProvider` (e.g. unit tests that mount a chat component
 * standalone), returns no-op functions instead of throwing — the chip
 * click is silent rather than crashing the test renderer.
 */
export function usePlayerRef(): PlayerRefValue {
  const ctx = useContext(PlayerRefContext);
  if (!ctx) {
    return {
      registerPlayer: () => {},
      clearPlaybackBoundary: () => {},
      seekTo: () => {},
      playRange: () => {},
    };
  }
  return ctx;
}
