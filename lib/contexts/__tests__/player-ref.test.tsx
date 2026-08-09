// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
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

  it("pauses range playback at the end timestamp plus one second", async () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });
    const seekTo = vi.fn();
    const playVideo = vi.fn();
    const pauseVideo = vi.fn();
    const getCurrentTime = vi
      .fn()
      .mockResolvedValueOnce(5 * 60 + 10)
      .mockResolvedValueOnce(5 * 60 + 11);

    act(() =>
      result.current.registerPlayer({
        seekTo,
        playVideo,
        pauseVideo,
        getCurrentTime,
      }),
    );
    act(() => result.current.playRange(4 * 60 + 32, 5 * 60 + 10));

    expect(seekTo).toHaveBeenCalledWith(4 * 60 + 32, true);
    expect(playVideo).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pauseVideo).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pauseVideo).toHaveBeenCalledTimes(1);
  });

  it("waits for a new range seek before applying its boundary", async () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });
    const pauseVideo = vi.fn();
    const getCurrentTime = vi
      .fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(12)
      .mockReturnValueOnce(14)
      .mockReturnValueOnce(16)
      .mockReturnValueOnce(18)
      .mockReturnValueOnce(20)
      .mockReturnValue(21);

    act(() =>
      result.current.registerPlayer({
        seekTo: vi.fn(),
        playVideo: vi.fn(),
        pauseVideo,
        getCurrentTime,
      }),
    );
    act(() => result.current.playRange(10, 20));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pauseVideo).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pauseVideo).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pauseVideo).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pauseVideo).toHaveBeenCalledTimes(1);
  });

  it("retires a boundary when the range seek never settles", async () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });
    const pauseVideo = vi.fn();

    act(() =>
      result.current.registerPlayer({
        seekTo: vi.fn(),
        playVideo: vi.fn(),
        pauseVideo,
        getCurrentTime: vi.fn().mockReturnValue(100),
      }),
    );
    act(() => result.current.playRange(10, 20));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(pauseVideo).not.toHaveBeenCalled();
  });

  it("cancels the active range boundary when a single timestamp is played", async () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });
    let currentSeconds = 0;
    const seekTo = vi.fn();
    const pauseVideo = vi.fn();

    act(() =>
      result.current.registerPlayer({
        seekTo,
        playVideo: vi.fn(),
        pauseVideo,
        getCurrentTime: () => currentSeconds,
      }),
    );
    act(() => result.current.playRange(10, 20));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    act(() => result.current.seekTo(30));
    currentSeconds = 100;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(seekTo).toHaveBeenLastCalledWith(30, true);
    expect(pauseVideo).not.toHaveBeenCalled();
  });

  it("cancels a range when the playing time jumps from a user seek", async () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });
    const pauseVideo = vi.fn();
    const getCurrentTime = vi.fn().mockReturnValueOnce(10).mockReturnValue(100);

    act(() =>
      result.current.registerPlayer({
        seekTo: vi.fn(),
        playVideo: vi.fn(),
        pauseVideo,
        getCurrentTime,
        getPlayerState: vi.fn().mockReturnValue(1),
      }),
    );
    act(() => result.current.playRange(10, 20));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(pauseVideo).not.toHaveBeenCalled();
  });

  it("ignores an in-flight boundary check after another range replaces it", async () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });
    let resolveFirstCheck!: (seconds: number) => void;
    const firstCheck = new Promise<number>((resolve) => {
      resolveFirstCheck = resolve;
    });
    const pauseVideo = vi.fn();
    const getCurrentTime = vi
      .fn()
      .mockReturnValueOnce(firstCheck)
      .mockReturnValue(0);

    act(() =>
      result.current.registerPlayer({
        seekTo: vi.fn(),
        playVideo: vi.fn(),
        pauseVideo,
        getCurrentTime,
      }),
    );
    act(() => result.current.playRange(10, 20));
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(getCurrentTime).toHaveBeenCalledTimes(1);

    act(() => result.current.playRange(100, 200));
    await act(async () => {
      resolveFirstCheck(21);
      await Promise.resolve();
    });

    expect(pauseVideo).not.toHaveBeenCalled();
  });

  it("clears the active monitor when the player is unregistered", () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });

    act(() =>
      result.current.registerPlayer({
        seekTo: vi.fn(),
        playVideo: vi.fn(),
        pauseVideo: vi.fn(),
        getCurrentTime: vi.fn().mockReturnValue(0),
      }),
    );
    act(() => result.current.playRange(10, 20));
    expect(vi.getTimerCount()).toBe(1);

    act(() => result.current.registerPlayer(null));

    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the active monitor when the provider unmounts", () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result, unmount } = renderHook(() => usePlayerRef(), { wrapper });

    act(() =>
      result.current.registerPlayer({
        seekTo: vi.fn(),
        playVideo: vi.fn(),
        pauseVideo: vi.fn(),
        getCurrentTime: vi.fn().mockReturnValue(0),
      }),
    );
    act(() => result.current.playRange(10, 20));
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("abandons a range after playback is paused so a later session is not stopped", async () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });
    let playerState = 1;
    let currentSeconds = 10;
    const pauseVideo = vi.fn();

    act(() =>
      result.current.registerPlayer({
        seekTo: vi.fn(),
        playVideo: vi.fn(),
        pauseVideo,
        getCurrentTime: () => currentSeconds,
        getPlayerState: () => playerState,
      }),
    );
    act(() => result.current.playRange(10, 20));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(vi.getTimerCount()).toBe(1);

    playerState = 2;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(vi.getTimerCount()).toBe(0);

    playerState = 1;
    currentSeconds = 100;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(pauseVideo).not.toHaveBeenCalled();
  });

  it("does not leave a monitor behind when range playback never starts", async () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });

    act(() =>
      result.current.registerPlayer({
        seekTo: vi.fn(),
        playVideo: vi.fn(),
        pauseVideo: vi.fn(),
        getCurrentTime: vi.fn().mockReturnValue(10),
        getPlayerState: vi.fn().mockReturnValue(2),
      }),
    );
    act(() => result.current.playRange(10, 20));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows an unstarted player to transition into playback", async () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });
    const getPlayerState = vi.fn().mockReturnValueOnce(-1).mockReturnValue(1);

    act(() =>
      result.current.registerPlayer({
        seekTo: vi.fn(),
        playVideo: vi.fn(),
        pauseVideo: vi.fn(),
        getCurrentTime: vi.fn().mockReturnValue(10),
        getPlayerState,
      }),
    );
    act(() => result.current.playRange(10, 20));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("clears the monitor when the player remains unstarted", async () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });

    act(() =>
      result.current.registerPlayer({
        seekTo: vi.fn(),
        playVideo: vi.fn(),
        pauseVideo: vi.fn(),
        getCurrentTime: vi.fn().mockReturnValue(10),
        getPlayerState: vi.fn().mockReturnValue(-1),
      }),
    );
    act(() => result.current.playRange(10, 20));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("retires a range when buffering never reaches playback", async () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });

    act(() =>
      result.current.registerPlayer({
        seekTo: vi.fn(),
        playVideo: vi.fn(),
        pauseVideo: vi.fn(),
        getCurrentTime: vi.fn().mockReturnValue(10),
        getPlayerState: vi.fn().mockReturnValue(3),
      }),
    );
    act(() => result.current.playRange(10, 20));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps monitoring after a transient player read failure", async () => {
    vi.useFakeTimers();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlayerRefProvider>{children}</PlayerRefProvider>
    );
    const { result } = renderHook(() => usePlayerRef(), { wrapper });
    const pauseVideo = vi.fn();
    const getCurrentTime = vi
      .fn()
      .mockRejectedValueOnce(new Error("player is seeking"))
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(14)
      .mockResolvedValueOnce(16)
      .mockResolvedValueOnce(18)
      .mockResolvedValueOnce(20)
      .mockResolvedValue(21);

    act(() =>
      result.current.registerPlayer({
        seekTo: vi.fn(),
        playVideo: vi.fn(),
        pauseVideo,
        getCurrentTime,
      }),
    );
    act(() => result.current.playRange(10, 20));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pauseVideo).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pauseVideo).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(pauseVideo).toHaveBeenCalledTimes(1);
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
