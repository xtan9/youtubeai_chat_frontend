import { afterEach, describe, it, expect, vi } from "vitest";
import {
  buildTranscribeUrl,
  transcribeViaVps,
  VpsTranscribeError,
} from "../vps-client";

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
        JSON.stringify({
          segments: [{ text: "t", start: 0, duration: 1 }],
          language: "en",
          source: "whisper",
        }),
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
    // Use `mockImplementation` (not `mockResolvedValue`) so each call
    // gets a fresh Response — Response bodies are single-use streams,
    // and a shared instance would have its body consumed by the first
    // call and surface as an empty string on the second.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("boom", { status: 502 })))
    );
    await expect(transcribeViaVps("https://youtu.be/abc")).rejects.toThrow(
      /VPS transcription failed \(502\): boom/
    );
    // Also pin the typed shape — a regression to bare `Error` would still
    // satisfy the message regex above, but would silently strip the
    // structured `.status` field the route's catch site logs as
    // `status`.
    const error = await transcribeViaVps("https://youtu.be/abc").catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(VpsTranscribeError);
    expect(error.status).toBe(502);
    expect(error.bodyExcerpt).toBe("boom");
    expect(error.message).toMatch(/VPS transcription failed \(502\): boom/);
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
    // Schema-failure path uses the synthetic "schema" status so log-search
    // alerts can branch on the structured field rather than substring-matching
    // the freeform .message.
    const error = await transcribeViaVps("https://youtu.be/abc").catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(VpsTranscribeError);
    expect(error.status).toBe("schema");
    expect(error.message).toMatch(/VPS transcription failed \(schema\)/);
    expect(error.bodyExcerpt).toBeDefined();
  });

  it("throws VpsTranscribeError (not bare Error) so the route can fingerprint upstream status", async () => {
    // Pinning the typed shape: a regression that returned to bare
    // `throw new Error(...)` would silently strip the structured
    // .status field that the route's catch site logs as `status`,
    // and Sentry / log-alert fingerprinting on 503 (Groq quota
    // exhaustion) would silently break.
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("rate limited", { status: 503 }))
    );
    const error = await transcribeViaVps("https://youtu.be/abc").catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(VpsTranscribeError);
    expect(error.status).toBe(503);
    expect(error.bodyExcerpt).toBe("rate limited");
    // The constructor shape is also preserved in .message for
    // operators reading raw container logs.
    expect(error.message).toBe("VPS transcription failed (503): rate limited");
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
        JSON.stringify({
          segments: [{ text: "t", start: 0, duration: 1 }],
          language: "en",
          source: "whisper",
        }),
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
        JSON.stringify({
          segments: [{ text: "bonjour", start: 0, duration: 1 }],
          language: "fr",
          source: "whisper",
        }),
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
            segments: [
              { text: "hello", start: 0, duration: 1 },
              { text: "world", start: 1, duration: 1 },
            ],
            language: "en",
            source: "whisper",
          }),
          { status: 200 }
        )
      )
    );
    const result = await transcribeViaVps("https://youtu.be/abc");
    expect(result).toEqual({
      segments: [
        { text: "hello", start: 0, duration: 1 },
        { text: "world", start: 1, duration: 1 },
      ],
      language: "en",
      source: "whisper",
    });
  });

  it("accepts the legacy `transcript` field alongside segments (rollout window)", async () => {
    // The VPS still emits `transcript` next to `segments` for one rollout
    // window so an old frontend deployment keeps working. The new schema
    // accepts the legacy field and ignores it.
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            segments: [{ text: "hi", start: 0, duration: 1 }],
            transcript: "hi",
            language: "en",
            source: "whisper",
          }),
          { status: 200 }
        )
      )
    );
    const result = await transcribeViaVps("https://youtu.be/abc");
    expect(result.segments).toEqual([
      { text: "hi", start: 0, duration: 1 },
    ]);
  });

  it("falls back to a single segment when only legacy `transcript` is present (forward-compat)", async () => {
    // Symmetric of the above: when the VPS hasn't deployed the new
    // contract yet, this client still works. The synthesized segment
    // gets start=0, duration=0 — a flag that timing data is absent —
    // so the transcript renders as one un-clickable paragraph at 00:00.
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            transcript: "legacy whisper output",
            language: "en",
            source: "whisper",
          }),
          { status: 200 }
        )
      )
    );
    const result = await transcribeViaVps("https://youtu.be/abc");
    expect(result.segments).toEqual([
      { text: "legacy whisper output", start: 0, duration: 0 },
    ]);
  });

  it("forwards the caller signal to fetch (composed with internal timeout)", async () => {
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          segments: [{ text: "t", start: 0, duration: 1 }],
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
    const error = await transcribeViaVps(
      "https://youtu.be/abc",
      callerController.signal
    ).catch((e) => e);
    // Crucially: the caller's own signal was NOT aborted — the internal
    // timeout fired. A route that classifies this as a caller abort would
    // silently close the stream instead of logging.
    expect(callerController.signal.aborted).toBe(false);
    // Internal-timeout is translated to a typed `VpsTranscribeError`
    // with status === "timeout", so the route's logStageError can
    // stamp `errorId: VPS_TRANSCRIBE_FAILED_timeout` and operators can
    // distinguish frontend-side timeouts from upstream-side 504s.
    expect(error).toBeInstanceOf(VpsTranscribeError);
    expect((error as VpsTranscribeError).status).toBe("timeout");
  });

  it("re-throws the original AbortError (untranslated) when the caller signal aborts", async () => {
    // Caller-abort safety: the route's catch checks
    // `isCallerAbort(request.signal)` BEFORE looking at the error
    // type. If we translated AbortError → VpsTranscribeError("network")
    // even on caller-abort, the existing check still works (it inspects
    // the signal, not the error), but downstream alerting that
    // disambiguates by error type would falsely flag every user-cancel
    // as a network failure. Pin the original-error re-throw.
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    const callerController = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_, reject) => {
            const signal = init.signal!;
            signal.addEventListener("abort", () => {
              const abortErr = new Error("aborted");
              abortErr.name = "AbortError";
              reject(abortErr);
            });
          })
      )
    );
    const promise = transcribeViaVps(
      "https://youtu.be/abc",
      callerController.signal
    );
    callerController.abort();
    const error = await promise.catch((e) => e);
    // Untranslated — it's the raw AbortError fetch threw, not a
    // VpsTranscribeError. The route's isCallerAbort gate handles
    // this branch by the caller signal being aborted.
    expect(error).not.toBeInstanceOf(VpsTranscribeError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("AbortError");
    expect(callerController.signal.aborted).toBe(true);
  });

  it("translates a non-abort fetch failure (DNS / connection-reset) to VpsTranscribeError('network')", async () => {
    // Pre-HTTP failures used to propagate as raw fetch errors; the
    // route's catch then logged a bare TypeError with no `.status`.
    // Translation here means a DNS / connection-reset blip surfaces
    // with `status: "network"` so log-search alerts can tell it apart
    // from a 502 (the VPS replied) and a "timeout" (composed signal).
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed: ECONNRESET"))
    );
    const error = await transcribeViaVps("https://youtu.be/abc").catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(VpsTranscribeError);
    expect((error as VpsTranscribeError).status).toBe("network");
    expect((error as VpsTranscribeError).bodyExcerpt).toBe(
      "fetch failed: ECONNRESET"
    );
  });

  it("re-throws original (non-AbortError) error when caller signal is aborted", async () => {
    // Pins the order: signal-first gate runs BEFORE error-type translation.
    // A future refactor that tightened the gate to AbortError-only would
    // silently translate a caller-abort+TypeError race into VpsTranscribeError("network"),
    // mis-classifying user-cancels as phantom network failures in alerting.
    vi.stubEnv("VPS_API_URL", "https://vps.example.com");
    vi.stubEnv("VPS_API_KEY", "secret");

    const callerController = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        // Abort caller, then have fetch reject with a TypeError (not an AbortError).
        callerController.abort();
        const tErr = new TypeError("ECONNRESET during cancellation");
        return Promise.reject(tErr);
      })
    );

    await expect(
      transcribeViaVps("https://youtu.be/abc", callerController.signal)
    ).rejects.toBeInstanceOf(TypeError);
    // Most importantly: NOT instanceof VpsTranscribeError — the caller-abort
    // gate must re-throw the original.
    await expect(
      transcribeViaVps("https://youtu.be/abc", callerController.signal)
    ).rejects.not.toBeInstanceOf(VpsTranscribeError);
  });

  it.each([
    ["AbortError", new Error("timed out")],
    ["TimeoutError", new DOMException("timed out", "TimeoutError")],
  ])(
    "translates internal-timeout via err.name=%s to status:'timeout'",
    async (_name, err) => {
      // Both names are accepted because Node 18 emitted plain Error+AbortError
      // for AbortSignal.timeout while modern Node emits DOMException+TimeoutError.
      // A regression dropping one branch would silently mis-translate that flavor.
      vi.stubEnv("VPS_API_URL", "https://vps.example.com");
      vi.stubEnv("VPS_API_KEY", "secret");
      // Force the name we want
      if ((err as { name?: string }).name !== _name) {
        Object.defineProperty(err, "name", { value: _name });
      }
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(err))
      );

      try {
        await transcribeViaVps("https://youtu.be/abc");
        throw new Error("should have thrown");
      } catch (caught) {
        expect(caught).toBeInstanceOf(VpsTranscribeError);
        expect((caught as VpsTranscribeError).status).toBe("timeout");
      }
    }
  );

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
            segments: [{ text: "t", start: 0, duration: 1 }],
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
            segments: [{ text: "t", start: 0, duration: 1 }],
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
