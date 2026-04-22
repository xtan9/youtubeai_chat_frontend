import { afterEach, describe, it, expect, vi } from "vitest";
import { buildTranscribeUrl, transcribeViaVps } from "../vps-client";

describe("buildTranscribeUrl", () => {
  it("builds correct URL from base", () => {
    expect(buildTranscribeUrl("https://vps.example.com")).toBe(
      "https://vps.example.com/transcribe"
    );
  });

  it("strips trailing slash from base URL", () => {
    expect(buildTranscribeUrl("https://vps.example.com/")).toBe(
      "https://vps.example.com/transcribe"
    );
  });
});

describe("transcribeViaVps", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("trims whitespace from VPS_API_URL and VPS_API_KEY", async () => {
    vi.stubEnv("VPS_API_URL", "  https://vps.example.com\n");
    vi.stubEnv("VPS_API_KEY", "\tsecret  ");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ transcript: "t", language: "en", source: "whisper" }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    await transcribeViaVps("https://youtu.be/abc");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://vps.example.com/transcribe");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret"
    );
  });

  it("treats whitespace-only VPS env vars as unset (throws 'must be configured')", async () => {
    vi.stubEnv("VPS_API_URL", "  \n  ");
    vi.stubEnv("VPS_API_KEY", "\t");
    await expect(transcribeViaVps("https://youtu.be/abc")).rejects.toThrow(
      /VPS_API_URL and VPS_API_KEY must be configured/
    );
  });

  it("throws when required env vars are missing", async () => {
    vi.stubEnv("VPS_API_URL", "");
    vi.stubEnv("VPS_API_KEY", "");
    await expect(transcribeViaVps("https://youtu.be/abc")).rejects.toThrow(
      /VPS_API_URL and VPS_API_KEY must be configured/
    );
  });

  it("throws with status + body when upstream returns non-ok", async () => {
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 502 }))
    );
    await expect(transcribeViaVps("https://youtu.be/abc")).rejects.toThrow(
      /VPS transcription failed \(502\): boom/
    );
  });

  it("throws when response JSON doesn't match schema", async () => {
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ transcript: "hi" }), { status: 200 })
      )
    );
    await expect(transcribeViaVps("https://youtu.be/abc")).rejects.toThrow(
      /unexpected shape/
    );
  });

  it("omits `lang` in body when no lang provided (back-compat)", async () => {
    // Pinning the pre-PR body shape: a future refactor to
    // `body.lang = lang` (which stringifies even for undefined via
    // explicit assignment) would silently break compat with clients
    // that sniff the exact body string.
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ transcript: "t", language: "en", source: "whisper" }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    await transcribeViaVps("https://youtu.be/abc");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ youtube_url: "https://youtu.be/abc" }));
  });

  it("forwards `lang` in body when provided (pins whisper --language)", async () => {
    // The feature's payoff on the whisper path: without this, lang is
    // accepted at the type boundary but silently dropped before the
    // network call, so whisper keeps auto-detecting.
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ transcript: "bonjour", language: "fr", source: "whisper" }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    await transcribeViaVps("https://youtu.be/abc", undefined, "fr");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(
      JSON.stringify({ youtube_url: "https://youtu.be/abc", lang: "fr" })
    );
  });

  it("returns parsed result on valid response", async () => {
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            transcript: "hello world",
            language: "en",
            source: "whisper",
          }),
          { status: 200 }
        )
      )
    );
    const result = await transcribeViaVps("https://youtu.be/abc");
    expect(result).toEqual({
      transcript: "hello world",
      language: "en",
      source: "whisper",
    });
  });

  it("forwards the caller signal to fetch (composed with internal timeout)", async () => {
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          transcript: "t",
          language: "en",
          source: "whisper",
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    await transcribeViaVps("https://youtu.be/abc", controller.signal);

    const initArg = fetchMock.mock.calls[0][1] as RequestInit;
    expect(initArg.signal).toBeInstanceOf(AbortSignal);
    // Aborting the caller must propagate through the composed signal.
    controller.abort();
    expect((initArg.signal as AbortSignal).aborted).toBe(true);
  });

  it("surfaces a timeout as a real error (not swallowed as caller abort)", async () => {
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    // 1ms internal timeout guarantees the composed signal fires before the
    // slow mock fetch resolves. The rejection should surface — the route's
    // `isCallerAbort` check only treats caller-signal aborts as silent drops.
    vi.stubEnv("VPS_TIMEOUT_MS", "1");

    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => {
            const signal = init.signal!;
            if (signal.aborted) {
              reject(signal.reason ?? new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => {
              reject(signal.reason ?? new Error("aborted"));
            });
          })
      )
    );

    const callerController = new AbortController();
    await expect(
      transcribeViaVps("https://youtu.be/abc", callerController.signal)
    ).rejects.toBeDefined();
    // Crucially: the caller's own signal was NOT aborted — the internal
    // timeout fired. A route that classifies this as a caller abort would
    // silently close the stream instead of logging.
    expect(callerController.signal.aborted).toBe(false);
  });

  it("passes VPS_TIMEOUT_MS override through to AbortSignal.timeout", async () => {
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubEnv("VPS_TIMEOUT_MS", "500");
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            transcript: "t",
            language: "en",
            source: "whisper",
          }),
          { status: 200 }
        )
      )
    );
    await transcribeViaVps("https://youtu.be/abc");
    expect(timeoutSpy).toHaveBeenCalledWith(500);
  });

  it("falls back to the default timeout when VPS_TIMEOUT_MS is missing or non-numeric", async () => {
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubEnv("VPS_TIMEOUT_MS", "nonsense");
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            transcript: "t",
            language: "en",
            source: "whisper",
          }),
          { status: 200 }
        )
      )
    );
    await transcribeViaVps("https://youtu.be/abc");
    expect(timeoutSpy).toHaveBeenCalledWith(240_000);
  });
});
