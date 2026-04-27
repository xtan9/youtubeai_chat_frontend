// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePersistedUrl } from "../usePersistedUrl";

const KEY = "pending-youtube-data";

describe("usePersistedUrl", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts unhydrated and hydrates with null when storage is empty", async () => {
    const { result } = renderHook(() => usePersistedUrl());
    // First render: not yet hydrated -> pendingUrl masked to null
    expect(result.current.pendingUrl).toBeNull();
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.pendingUrl).toBeNull();
  });

  it("hydrates with the stored URL when present", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ url: "https://youtu.be/abc" })
    );
    const { result } = renderHook(() => usePersistedUrl());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.pendingUrl).toBe("https://youtu.be/abc");
  });

  it("savePendingUrl writes to localStorage and updates state", async () => {
    const { result } = renderHook(() => usePersistedUrl());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() => {
      result.current.savePendingUrl("https://youtu.be/xyz");
    });
    expect(result.current.pendingUrl).toBe("https://youtu.be/xyz");
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      url: "https://youtu.be/xyz",
    });
  });

  it("clearPendingUrl removes the entry and nulls state", async () => {
    localStorage.setItem(KEY, JSON.stringify({ url: "https://youtu.be/abc" }));
    const { result } = renderHook(() => usePersistedUrl());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() => {
      result.current.clearPendingUrl();
    });
    expect(result.current.pendingUrl).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("logs and continues when stored value is malformed JSON", async () => {
    localStorage.setItem(KEY, "not-json");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => usePersistedUrl());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.pendingUrl).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      "Error reading from localStorage:",
      expect.any(Error)
    );
  });

  it("logs and continues when localStorage.setItem throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const setItemSpy = vi
      .spyOn(localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    const { result } = renderHook(() => usePersistedUrl());
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    act(() => {
      result.current.savePendingUrl("https://youtu.be/xyz");
    });
    // In-memory state still updates so the UI isn't blocked
    expect(result.current.pendingUrl).toBe("https://youtu.be/xyz");
    expect(errSpy).toHaveBeenCalledWith(
      "Error saving to localStorage:",
      expect.any(Error)
    );
    void setItemSpy; // restored by afterEach vi.restoreAllMocks()
  });
});
