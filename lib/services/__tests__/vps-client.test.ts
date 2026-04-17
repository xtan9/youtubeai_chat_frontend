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
});
