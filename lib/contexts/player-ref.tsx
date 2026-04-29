"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from "react";

export interface YouTubePlayerHandle {
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  playVideo?(): void;
}

interface PlayerRefValue {
  readonly registerPlayer: (handle: YouTubePlayerHandle | null) => void;
  readonly seekTo: (seconds: number) => void;
}

const PlayerRefContext = createContext<PlayerRefValue | null>(null);

/**
 * Lifts the YouTube player handle out of `youtube-video.tsx` so sibling
 * components (the chat tab's timestamp chips) can seek the player without
 * prop-drilling. Components that aren't wrapped in this provider see a
 * no-op fallback — keeps unit tests that don't mount the player from
 * crashing.
 */
export function PlayerRefProvider({ children }: { children: ReactNode }) {
  const handleRef = useRef<YouTubePlayerHandle | null>(null);
  const registerPlayer = useCallback(
    (handle: YouTubePlayerHandle | null) => {
      handleRef.current = handle;
    },
    []
  );
  const seekTo = useCallback((seconds: number) => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.seekTo(seconds, true);
    // Some browsers pause the iframe when seeking from a UI click while
    // the video isn't yet playing. Resume so a click on a timestamp chip
    // always lands on a *playing* moment, matching the existing
    // transcript-paragraphs UX.
    handle.playVideo?.();
  }, []);
  return (
    <PlayerRefContext.Provider value={{ registerPlayer, seekTo }}>
      {children}
    </PlayerRefContext.Provider>
  );
}

export function usePlayerRef(): PlayerRefValue {
  const ctx = useContext(PlayerRefContext);
  if (!ctx) {
    return {
      registerPlayer: () => {},
      seekTo: () => {},
    };
  }
  return ctx;
}
