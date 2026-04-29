// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

afterEach(() => cleanup());
import { PlayerRefProvider, usePlayerRef } from "../player-ref";
import type { ReactNode } from "react";

describe("PlayerRefProvider / usePlayerRef", () => {
  it("seekTo is a no-op when no provider is mounted (fallback)", () => {
    const { result } = renderHook(() => usePlayerRef());
    // Doesn't throw, doesn't crash — that's the contract.
    expect(() => result.current.seekTo(42)).not.toThrow();
  });

  it("forwards seekTo to the registered player and resumes playback", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });
    const seekTo = vi.fn();
    const playVideo = vi.fn();
    act(() => result.current.registerPlayer({ seekTo, playVideo }));
    act(() => result.current.seekTo(120));
    expect(seekTo).toHaveBeenCalledWith(120, true);
    expect(playVideo).toHaveBeenCalledTimes(1);
  });

  it("unregister with null nulls the handle without throwing", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });
    const seekTo = vi.fn();
    act(() => result.current.registerPlayer({ seekTo }));
    act(() => result.current.registerPlayer(null));
    act(() => result.current.seekTo(5));
    expect(seekTo).not.toHaveBeenCalled();
  });
});
