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

  it("handles supplementary-plane codepoints (emoji, > 0xFFFF)", () => {
    // U+1F600 GRINNING FACE = 128512
    expect(decodeCaptionEntities("hi &#128512;!")).toBe("hi 😀!");
    expect(decodeCaptionEntities("&#x1F600;")).toBe("😀");
  });

  it("does not throw on out-of-range numeric entities (returns original)", () => {
    // > 0x10FFFF: String.fromCodePoint would throw RangeError. The
    // decoder must return the raw entity unchanged so a single
    // malformed entity can't 500 an entire transcript fetch.
    expect(() => decodeCaptionEntities("bad &#999999999999;")).not.toThrow();
    expect(decodeCaptionEntities("bad &#999999999999;")).toBe(
      "bad &#999999999999;"
    );
    expect(decodeCaptionEntities("bad &#xFFFFFFFF;")).toBe("bad &#xFFFFFFFF;");
  });

  it("preserves malformed entity-like substrings unchanged", () => {
    // Missing semicolon, missing digits, named-but-unknown — all should
    // pass through as-is rather than partial-match into garbage.
    expect(decodeCaptionEntities("a &amp b")).toBe("a &amp b"); // no `;`
    expect(decodeCaptionEntities("a &; b")).toBe("a &; b");
    expect(decodeCaptionEntities("a &#; b")).toBe("a &#; b");
    expect(decodeCaptionEntities("a &foo; b")).toBe("a &foo; b");
  });

  it("handles mixed entities in one string", () => {
    expect(
      decodeCaptionEntities("Tom &amp; &#39;Jerry&#39; &#x2014; fin")
    ).toBe("Tom & 'Jerry' — fin");
  });
});
