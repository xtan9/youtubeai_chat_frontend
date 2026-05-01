/**
 * Hero demo widget — sample registry. Lightweight metadata ships with the
 * homepage chunk; per-sample base (transcript + meta) and per-language
 * summary modules are dynamically imported on selection / language pick.
 *
 * Adding a sample:
 *   1. Cache it in prod via /summary?url=URL&lang=<each of 17> (or use
 *      scripts/seed-hero-demo-translations.ts).
 *   2. Run `pnpm tsx scripts/build-hero-demo-data.ts` to regenerate the
 *      per-id directory.
 *   3. Add the id to lib/constants/hero-demo-ids.ts AND a row here, in
 *      the same order — the module-eval invariant below enforces this.
 */
import {
  type SupportedLanguageCode,
} from "@/lib/constants/languages";
import {
  HERO_DEMO_VIDEO_IDS,
  type HeroDemoVideoId,
} from "@/lib/constants/hero-demo-ids";

export interface TranscriptSegment {
  readonly text: string;
  readonly start: number;
  readonly duration: number;
}

export interface HeroSampleBase {
  readonly id: HeroDemoVideoId;
  readonly segments: ReadonlyArray<TranscriptSegment>;
  // Stays a free string in the registry surface so the `videos.language`
  // column (which can carry codes outside our 17-language picker set,
  // e.g. an auto-detected source-only locale) round-trips intact through
  // the dump → build pipeline. The picker itself is typed
  // SupportedLanguageCode separately.
  readonly nativeLanguage: string | null;
}

export interface HeroSampleSummary {
  readonly id: HeroDemoVideoId;
  readonly language: string;
  readonly summary: string;
  readonly model: string;
  /**
   * Three follow-up questions tailored to this (id, language) summary,
   * pre-generated at seed time by `scripts/seed-hero-demo-suggestions.ts`
   * and emitted by `scripts/build-hero-demo-data.ts`. Tuple-of-3 (not
   * `string[]`) so a mis-shaped regen fails `tsc` instead of rendering
   * one or two buttons in the empty state.
   */
  readonly suggestions: readonly [string, string, string];
}

export interface SampleMeta {
  readonly id: HeroDemoVideoId;
  readonly title: string;
  readonly channel: string;
  readonly durationSec: number;
  readonly loadBase: () => Promise<HeroSampleBase>;
  readonly loadSummary: (
    lang: SupportedLanguageCode,
  ) => Promise<HeroSampleSummary>;
}

export function youtubeUrlFor(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function thumbnailUrlFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Static (id, lang) → loader map. Verbose but unambiguous: every
// dynamic import string is a literal, so both vite (test) and webpack
// (production) emit one chunk per (id, lang) without warnings or
// fall-through to a directory context. 6 ids × 17 langs = 102 entries.
//
// Typed as `Record<HeroDemoVideoId, Record<SupportedLanguageCode, ...>>`
// — adding a 7th id to HERO_DEMO_VIDEO_IDS or a new language code
// without filling this map fails `tsc`, replacing what would otherwise
// be a runtime throw on first import with a compile-time guard.
const PICK = (m: { default: HeroSampleSummary }) => m.default;
const SUMMARY_LOADERS: Record<
  HeroDemoVideoId,
  Record<SupportedLanguageCode, () => Promise<HeroSampleSummary>>
> = {
  Hrbq66XqtCo: {
    en: () => import("./Hrbq66XqtCo/en").then(PICK),
    es: () => import("./Hrbq66XqtCo/es").then(PICK),
    pt: () => import("./Hrbq66XqtCo/pt").then(PICK),
    it: () => import("./Hrbq66XqtCo/it").then(PICK),
    fr: () => import("./Hrbq66XqtCo/fr").then(PICK),
    de: () => import("./Hrbq66XqtCo/de").then(PICK),
    id: () => import("./Hrbq66XqtCo/id").then(PICK),
    zh: () => import("./Hrbq66XqtCo/zh").then(PICK),
    "zh-TW": () => import("./Hrbq66XqtCo/zh-TW").then(PICK),
    ja: () => import("./Hrbq66XqtCo/ja").then(PICK),
    ko: () => import("./Hrbq66XqtCo/ko").then(PICK),
    ar: () => import("./Hrbq66XqtCo/ar").then(PICK),
    hi: () => import("./Hrbq66XqtCo/hi").then(PICK),
    bn: () => import("./Hrbq66XqtCo/bn").then(PICK),
    ru: () => import("./Hrbq66XqtCo/ru").then(PICK),
    vi: () => import("./Hrbq66XqtCo/vi").then(PICK),
    tr: () => import("./Hrbq66XqtCo/tr").then(PICK),
    th: () => import("./Hrbq66XqtCo/th").then(PICK),
  },
  nm1TxQj9IsQ: {
    en: () => import("./nm1TxQj9IsQ/en").then(PICK),
    es: () => import("./nm1TxQj9IsQ/es").then(PICK),
    pt: () => import("./nm1TxQj9IsQ/pt").then(PICK),
    it: () => import("./nm1TxQj9IsQ/it").then(PICK),
    fr: () => import("./nm1TxQj9IsQ/fr").then(PICK),
    de: () => import("./nm1TxQj9IsQ/de").then(PICK),
    id: () => import("./nm1TxQj9IsQ/id").then(PICK),
    zh: () => import("./nm1TxQj9IsQ/zh").then(PICK),
    "zh-TW": () => import("./nm1TxQj9IsQ/zh-TW").then(PICK),
    ja: () => import("./nm1TxQj9IsQ/ja").then(PICK),
    ko: () => import("./nm1TxQj9IsQ/ko").then(PICK),
    ar: () => import("./nm1TxQj9IsQ/ar").then(PICK),
    hi: () => import("./nm1TxQj9IsQ/hi").then(PICK),
    bn: () => import("./nm1TxQj9IsQ/bn").then(PICK),
    ru: () => import("./nm1TxQj9IsQ/ru").then(PICK),
    vi: () => import("./nm1TxQj9IsQ/vi").then(PICK),
    tr: () => import("./nm1TxQj9IsQ/tr").then(PICK),
    th: () => import("./nm1TxQj9IsQ/th").then(PICK),
  },
  Mde2q7GFCrw: {
    en: () => import("./Mde2q7GFCrw/en").then(PICK),
    es: () => import("./Mde2q7GFCrw/es").then(PICK),
    pt: () => import("./Mde2q7GFCrw/pt").then(PICK),
    it: () => import("./Mde2q7GFCrw/it").then(PICK),
    fr: () => import("./Mde2q7GFCrw/fr").then(PICK),
    de: () => import("./Mde2q7GFCrw/de").then(PICK),
    id: () => import("./Mde2q7GFCrw/id").then(PICK),
    zh: () => import("./Mde2q7GFCrw/zh").then(PICK),
    "zh-TW": () => import("./Mde2q7GFCrw/zh-TW").then(PICK),
    ja: () => import("./Mde2q7GFCrw/ja").then(PICK),
    ko: () => import("./Mde2q7GFCrw/ko").then(PICK),
    ar: () => import("./Mde2q7GFCrw/ar").then(PICK),
    hi: () => import("./Mde2q7GFCrw/hi").then(PICK),
    bn: () => import("./Mde2q7GFCrw/bn").then(PICK),
    ru: () => import("./Mde2q7GFCrw/ru").then(PICK),
    vi: () => import("./Mde2q7GFCrw/vi").then(PICK),
    tr: () => import("./Mde2q7GFCrw/tr").then(PICK),
    th: () => import("./Mde2q7GFCrw/th").then(PICK),
  },
  csA9YhzYvmk: {
    en: () => import("./csA9YhzYvmk/en").then(PICK),
    es: () => import("./csA9YhzYvmk/es").then(PICK),
    pt: () => import("./csA9YhzYvmk/pt").then(PICK),
    it: () => import("./csA9YhzYvmk/it").then(PICK),
    fr: () => import("./csA9YhzYvmk/fr").then(PICK),
    de: () => import("./csA9YhzYvmk/de").then(PICK),
    id: () => import("./csA9YhzYvmk/id").then(PICK),
    zh: () => import("./csA9YhzYvmk/zh").then(PICK),
    "zh-TW": () => import("./csA9YhzYvmk/zh-TW").then(PICK),
    ja: () => import("./csA9YhzYvmk/ja").then(PICK),
    ko: () => import("./csA9YhzYvmk/ko").then(PICK),
    ar: () => import("./csA9YhzYvmk/ar").then(PICK),
    hi: () => import("./csA9YhzYvmk/hi").then(PICK),
    bn: () => import("./csA9YhzYvmk/bn").then(PICK),
    ru: () => import("./csA9YhzYvmk/ru").then(PICK),
    vi: () => import("./csA9YhzYvmk/vi").then(PICK),
    tr: () => import("./csA9YhzYvmk/tr").then(PICK),
    th: () => import("./csA9YhzYvmk/th").then(PICK),
  },
  BWJ4vnXIvts: {
    en: () => import("./BWJ4vnXIvts/en").then(PICK),
    es: () => import("./BWJ4vnXIvts/es").then(PICK),
    pt: () => import("./BWJ4vnXIvts/pt").then(PICK),
    it: () => import("./BWJ4vnXIvts/it").then(PICK),
    fr: () => import("./BWJ4vnXIvts/fr").then(PICK),
    de: () => import("./BWJ4vnXIvts/de").then(PICK),
    id: () => import("./BWJ4vnXIvts/id").then(PICK),
    zh: () => import("./BWJ4vnXIvts/zh").then(PICK),
    "zh-TW": () => import("./BWJ4vnXIvts/zh-TW").then(PICK),
    ja: () => import("./BWJ4vnXIvts/ja").then(PICK),
    ko: () => import("./BWJ4vnXIvts/ko").then(PICK),
    ar: () => import("./BWJ4vnXIvts/ar").then(PICK),
    hi: () => import("./BWJ4vnXIvts/hi").then(PICK),
    bn: () => import("./BWJ4vnXIvts/bn").then(PICK),
    ru: () => import("./BWJ4vnXIvts/ru").then(PICK),
    vi: () => import("./BWJ4vnXIvts/vi").then(PICK),
    tr: () => import("./BWJ4vnXIvts/tr").then(PICK),
    th: () => import("./BWJ4vnXIvts/th").then(PICK),
  },
  "Yy-EC-BdoNY": {
    en: () => import("./Yy-EC-BdoNY/en").then(PICK),
    es: () => import("./Yy-EC-BdoNY/es").then(PICK),
    pt: () => import("./Yy-EC-BdoNY/pt").then(PICK),
    it: () => import("./Yy-EC-BdoNY/it").then(PICK),
    fr: () => import("./Yy-EC-BdoNY/fr").then(PICK),
    de: () => import("./Yy-EC-BdoNY/de").then(PICK),
    id: () => import("./Yy-EC-BdoNY/id").then(PICK),
    zh: () => import("./Yy-EC-BdoNY/zh").then(PICK),
    "zh-TW": () => import("./Yy-EC-BdoNY/zh-TW").then(PICK),
    ja: () => import("./Yy-EC-BdoNY/ja").then(PICK),
    ko: () => import("./Yy-EC-BdoNY/ko").then(PICK),
    ar: () => import("./Yy-EC-BdoNY/ar").then(PICK),
    hi: () => import("./Yy-EC-BdoNY/hi").then(PICK),
    bn: () => import("./Yy-EC-BdoNY/bn").then(PICK),
    ru: () => import("./Yy-EC-BdoNY/ru").then(PICK),
    vi: () => import("./Yy-EC-BdoNY/vi").then(PICK),
    tr: () => import("./Yy-EC-BdoNY/tr").then(PICK),
    th: () => import("./Yy-EC-BdoNY/th").then(PICK),
  },
};

function summaryLoaderFor(id: HeroDemoVideoId) {
  return (
    lang: SupportedLanguageCode,
  ): Promise<HeroSampleSummary> => SUMMARY_LOADERS[id][lang]();
}

export const SAMPLES: ReadonlyArray<SampleMeta> = [
  {
    id: "Hrbq66XqtCo",
    title: "Jensen Huang – Will Nvidia’s moat persist?",
    channel: "Dwarkesh Patel",
    durationSec: 6191,
    loadBase: () =>
      import("./Hrbq66XqtCo/base").then((m) => m.default),
    loadSummary: summaryLoaderFor("Hrbq66XqtCo"),
  },
  {
    id: "nm1TxQj9IsQ",
    title: "Master Your Sleep & Be More Alert When Awake",
    channel: "Andrew Huberman",
    durationSec: 4923,
    loadBase: () =>
      import("./nm1TxQj9IsQ/base").then((m) => m.default),
    loadSummary: summaryLoaderFor("nm1TxQj9IsQ"),
  },
  {
    id: "Mde2q7GFCrw",
    title:
      "Yuval Noah Harari: Human Nature, Intelligence, Power & Conspiracies #390",
    channel: "Lex Fridman",
    durationSec: 9881,
    loadBase: () =>
      import("./Mde2q7GFCrw/base").then((m) => m.default),
    loadSummary: summaryLoaderFor("Mde2q7GFCrw"),
  },
  {
    id: "csA9YhzYvmk",
    title:
      "The Happiness Expert That Made 51 Million People Happier: Mo Gawdat | E101",
    channel: "The Diary Of A CEO",
    durationSec: 7054,
    loadBase: () =>
      import("./csA9YhzYvmk/base").then((m) => m.default),
    loadSummary: summaryLoaderFor("csA9YhzYvmk"),
  },
  {
    id: "BWJ4vnXIvts",
    title:
      "12 Laws Of Power For Life — Robert Greene | Modern Wisdom Podcast 383",
    channel: "Chris Williamson",
    durationSec: 3930,
    loadBase: () =>
      import("./BWJ4vnXIvts/base").then((m) => m.default),
    loadSummary: summaryLoaderFor("BWJ4vnXIvts"),
  },
  {
    id: "Yy-EC-BdoNY",
    title: "Living With A $80,000 Ford Mustang Dark Horse!!",
    channel: "EddieX",
    durationSec: 2004,
    loadBase: () =>
      import("./Yy-EC-BdoNY/base").then((m) => m.default),
    loadSummary: summaryLoaderFor("Yy-EC-BdoNY"),
  },
];

const sampleIds = SAMPLES.map((s) => s.id);
if (
  sampleIds.length !== HERO_DEMO_VIDEO_IDS.length ||
  sampleIds.some((id, i) => id !== HERO_DEMO_VIDEO_IDS[i])
) {
  throw new Error(
    "HERO_DEMO_VIDEO_IDS and SAMPLES must stay in lockstep (same order, same ids).",
  );
}
