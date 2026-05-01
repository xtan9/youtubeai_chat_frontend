/**
 * Hero demo widget — sample registry. Each entry carries lightweight
 * metadata that ships with the homepage chunk; the heavy summary +
 * transcript data lives in the per-video modules and is dynamically
 * imported on first selection so we don't bloat homepage LCP.
 *
 * Adding a sample: cache it via `/summary?url=...`, then run
 * `pnpm tsx scripts/build-hero-demo-data.ts` to regenerate the per-
 * video file, then add a row here.
 */

/**
 * One transcript line with playback timing. Same shape used by the
 * production cache (`lib/types.ts:TranscriptSegment`); kept locally so
 * the demo data files have zero runtime dependency on the live
 * summarize pipeline. If the shapes diverge later, switch this alias to
 * a re-export.
 */
export interface TranscriptSegment {
  readonly text: string;
  readonly start: number;
  readonly duration: number;
}

export interface SampleData {
  readonly id: string;
  readonly summary: string;
  readonly segments: ReadonlyArray<TranscriptSegment>;
  readonly model: string;
}

/**
 * Lightweight per-sample registry entry. `youtubeUrl` and
 * `thumbnailUrl` are NOT stored here — they're derived from `id` via
 * the helpers below so the id↔url and id↔thumbnail invariants are
 * structurally impossible to violate.
 */
export interface SampleMeta {
  readonly id: string;
  readonly title: string;
  readonly channel: string;
  readonly durationSec: number;
  /**
   * Each `loadFullData` is a thunk so its dynamic `import()` stays a
   * code-split signal to the bundler — flattening to a top-level
   * `import` would eagerly bundle every sample's data and defeat the
   * lazy-load.
   */
  readonly loadFullData: () => Promise<SampleData>;
}

export function youtubeUrlFor(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function thumbnailUrlFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
}

export const SAMPLES: ReadonlyArray<SampleMeta> = [
  {
    id: "Hrbq66XqtCo",
    title: "Jensen Huang – Will Nvidia’s moat persist?",
    channel: "Dwarkesh Patel",
    durationSec: 6191,
    loadFullData: () => import("./Hrbq66XqtCo").then((m) => m.default),
  },
  {
    id: "nm1TxQj9IsQ",
    title: "Master Your Sleep & Be More Alert When Awake",
    channel: "Andrew Huberman",
    durationSec: 4923,
    loadFullData: () => import("./nm1TxQj9IsQ").then((m) => m.default),
  },
  {
    id: "Mde2q7GFCrw",
    title:
      "Yuval Noah Harari: Human Nature, Intelligence, Power & Conspiracies #390",
    channel: "Lex Fridman",
    durationSec: 9881,
    loadFullData: () => import("./Mde2q7GFCrw").then((m) => m.default),
  },
  {
    id: "csA9YhzYvmk",
    title:
      "The Happiness Expert That Made 51 Million People Happier: Mo Gawdat | E101",
    channel: "The Diary Of A CEO",
    durationSec: 7054,
    loadFullData: () => import("./csA9YhzYvmk").then((m) => m.default),
  },
  {
    id: "BWJ4vnXIvts",
    title:
      "12 Laws Of Power For Life — Robert Greene | Modern Wisdom Podcast 383",
    channel: "Chris Williamson",
    durationSec: 3930,
    loadFullData: () => import("./BWJ4vnXIvts").then((m) => m.default),
  },
];

export function formatDuration(seconds: number): string {
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
