import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWithVpsKeyRotation,
  getVpsApiKeys,
} from "../vps-auth";

describe("VPS authentication rotation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns the trimmed current key followed by the previous key", () => {
    vi.stubEnv("VPS_API_KEY", "  current-secret  ");
    vi.stubEnv("VPS_API_KEY_PREVIOUS", " previous-secret\n");

    expect(getVpsApiKeys()).toEqual(["current-secret", "previous-secret"]);
  });

  it("does not treat a previous key as a valid current configuration", () => {
    vi.stubEnv("VPS_API_KEY", "");
    vi.stubEnv("VPS_API_KEY_PREVIOUS", "previous-secret");

    expect(getVpsApiKeys()).toEqual([]);
  });

  it("retries an auth rejection once with the previous key", async () => {
    vi.stubEnv("VPS_API_KEY", "current-secret");
    vi.stubEnv("VPS_API_KEY_PREVIOUS", "previous-secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("old key rejected", { status: 403 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithVpsKeyRotation(
      "https://vps.example.com/metadata",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": "request-148-example",
        },
        body: "{}",
      },
      getVpsApiKeys()
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      (fetchMock.mock.calls[0][1].headers as Record<string, string>)
        .Authorization
    ).toBe("Bearer current-secret");
    expect(
      (fetchMock.mock.calls[1][1].headers as Record<string, string>)
        .Authorization
    ).toBe("Bearer previous-secret");
    expect(
      (fetchMock.mock.calls[1][1].headers as Record<string, string>)[
        "X-Request-ID"
      ]
    ).toBe("request-148-example");
  });

  it("does not retry provider failures or expose keys through the response", async () => {
    vi.stubEnv("VPS_API_KEY", "current-secret");
    vi.stubEnv("VPS_API_KEY_PREVIOUS", "previous-secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("provider failed", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithVpsKeyRotation(
      "https://vps.example.com/transcribe",
      { method: "POST" },
      getVpsApiKeys()
    );

    expect(response.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe("provider failed");
  });

  it("does not rotate keys after the caller has cancelled", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(() => {
      controller.abort(new Error("caller cancelled"));
      return Promise.reject(new Error("caller cancelled"));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchWithVpsKeyRotation(
        "https://vps.example.com/transcribe",
        { method: "POST", signal: controller.signal },
        ["current-secret", "previous-secret"]
      )
    ).rejects.toThrow("caller cancelled");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
