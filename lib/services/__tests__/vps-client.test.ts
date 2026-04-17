import { describe, it, expect } from "vitest";
import { buildTranscribeUrl } from "../vps-client";

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
