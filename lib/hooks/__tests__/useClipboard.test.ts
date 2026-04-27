// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useClipboard } from "../useClipboard";

describe("useClipboard", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts with copied=false", () => {
    const { result } = renderHook(() => useClipboard());
    expect(result.current.copied).toBe(false);
  });

  it("writes text to clipboard and flips copied to true", async () => {
    const { result } = renderHook(() => useClipboard());
    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.copyToClipboard("hello");
    });
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(returned).toBe(true);
    expect(result.current.copied).toBe(true);
  });

  it("auto-resets copied to false after 2s", async () => {
    const { result } = renderHook(() => useClipboard());
    await act(async () => {
      await result.current.copyToClipboard("hello");
    });
    expect(result.current.copied).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.copied).toBe(false);
  });

  it("returns false and leaves copied=false when clipboard write rejects", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useClipboard());
    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.copyToClipboard("hello");
    });
    expect(returned).toBe(false);
    expect(result.current.copied).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(
      "Failed to copy:",
      expect.any(Error)
    );
  });
});
