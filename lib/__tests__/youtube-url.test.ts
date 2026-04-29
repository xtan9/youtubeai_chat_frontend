import { describe, it, expect } from "vitest";
import { extractYouTubeId, isYouTubeUrl } from "@/lib/youtube-url";

describe("extractYouTubeId", () => {
  it("extracts from /watch?v= URLs", () => {
    expect(
      extractYouTubeId("https://www.youtube.com/watch?v=cdiD-9MMpb0"),
    ).toBe("cdiD-9MMpb0");
  });

  it("extracts when v= is not the first query parameter", () => {
    expect(
      extractYouTubeId(
        "https://www.youtube.com/watch?feature=share&v=cdiD-9MMpb0&t=30s",
      ),
    ).toBe("cdiD-9MMpb0");
  });

  it("extracts from youtu.be short links", () => {
    expect(extractYouTubeId("https://youtu.be/cdiD-9MMpb0")).toBe(
      "cdiD-9MMpb0",
    );
  });

  it("extracts from /shorts/ URLs", () => {
    expect(
      extractYouTubeId("https://www.youtube.com/shorts/cdiD-9MMpb0"),
    ).toBe("cdiD-9MMpb0");
  });

  it("extracts from /embed/ URLs", () => {
    expect(
      extractYouTubeId("https://www.youtube.com/embed/cdiD-9MMpb0"),
    ).toBe("cdiD-9MMpb0");
  });

  it("returns null for non-YouTube hosts that have no v= or shorts/embed token", () => {
    expect(extractYouTubeId("https://vimeo.com/12345")).toBeNull();
  });

  it("matches ?v= host-agnostically (documented limitation)", () => {
    // The pattern is host-agnostic by design — heroVideo's
    // z.string().url() + the test corpus running everything through
    // youtube.com makes a host check more complexity than it's worth.
    // Tighten the regex if a non-YouTube host with ?v= becomes a real
    // failure mode.
    expect(extractYouTubeId("https://example.com/watch?v=cdiD-9MMpb0")).toBe(
      "cdiD-9MMpb0",
    );
  });

  it("returns null for malformed YouTube URLs (no 11-char id)", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(extractYouTubeId("https://www.youtube.com/watch")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(extractYouTubeId("")).toBeNull();
  });
});

describe("isYouTubeUrl", () => {
  it("returns true for valid forms", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=cdiD-9MMpb0")).toBe(
      true,
    );
    expect(isYouTubeUrl("https://youtu.be/cdiD-9MMpb0")).toBe(true);
  });

  it("returns false for non-YouTube URLs", () => {
    expect(isYouTubeUrl("https://vimeo.com/12345")).toBe(false);
    expect(isYouTubeUrl("not-a-url")).toBe(false);
  });
});
