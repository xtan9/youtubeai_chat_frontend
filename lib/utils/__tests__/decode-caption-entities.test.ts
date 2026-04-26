import { describe, it, expect } from "vitest";
import { decodeCaptionEntities } from "../decode-caption-entities";

describe("decodeCaptionEntities", () => {
  it("decodes the named XML entities youtube-transcript-plus already covers", () => {
    expect(decodeCaptionEntities("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(decodeCaptionEntities("&lt;tag&gt;")).toBe("<tag>");
    expect(decodeCaptionEntities("&quot;hi&quot;")).toBe('"hi"');
    expect(decodeCaptionEntities("don&apos;t")).toBe("don't");
  });

  it("decodes the apostrophe forms the library skips", () => {
    expect(decodeCaptionEntities("I&#39;m here")).toBe("I'm here");
    expect(decodeCaptionEntities("can&#x27;t")).toBe("can't");
    expect(decodeCaptionEntities("hi &#8212; there")).toBe("hi — there");
  });

  it("unwraps double-encoded entities (the user-reported bug)", () => {
    // YouTube emits `&amp;#39;`; library's single pass leaves `&#39;`
    // which React renders verbatim. Second pass takes it to `'`.
    expect(decodeCaptionEntities("I&amp;#39;m here")).toBe("I'm here");
    expect(decodeCaptionEntities("&amp;amp;")).toBe("&");
  });

  it("is a no-op for plain text and bare ampersands", () => {
    expect(decodeCaptionEntities("plain text")).toBe("plain text");
    // "AT&T" mid-transcript: bare `&` not followed by entity shape stays.
    expect(decodeCaptionEntities("AT&T")).toBe("AT&T");
    expect(decodeCaptionEntities("café — naïve")).toBe("café — naïve");
  });
});
