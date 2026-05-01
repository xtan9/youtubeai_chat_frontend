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

export interface SampleData {
  readonly id: string;
  readonly summary: string;
  readonly segments: ReadonlyArray<{
    readonly text: string;
    readonly start: number;
    readonly duration: number;
  }>;
  readonly model: string;
}

export interface SampleMeta {
  readonly id: string;
  readonly youtubeUrl: string;
  readonly title: string;
  readonly channel: string;
  readonly durationSec: number;
  readonly thumbnailUrl: string;
  readonly loadFullData: () => Promise<SampleData>;
}

function ytThumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
}

function ytUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export const SAMPLES: ReadonlyArray<SampleMeta> = [
  {
    id: "Hrbq66XqtCo",
    youtubeUrl: ytUrl("Hrbq66XqtCo"),
    title: "Jensen Huang – Will Nvidia’s moat persist?",
    channel: "Dwarkesh Patel",
    durationSec: 6191,
    thumbnailUrl: ytThumb("Hrbq66XqtCo"),
    loadFullData: () => import("./Hrbq66XqtCo").then((m) => m.default),
  },
  {
    id: "nm1TxQj9IsQ",
    youtubeUrl: ytUrl("nm1TxQj9IsQ"),
    title: "Master Your Sleep & Be More Alert When Awake",
    channel: "Andrew Huberman",
    durationSec: 4923,
    thumbnailUrl: ytThumb("nm1TxQj9IsQ"),
    loadFullData: () => import("./nm1TxQj9IsQ").then((m) => m.default),
  },
  {
    id: "Mde2q7GFCrw",
    youtubeUrl: ytUrl("Mde2q7GFCrw"),
    title:
      "Yuval Noah Harari: Human Nature, Intelligence, Power & Conspiracies #390",
    channel: "Lex Fridman",
    durationSec: 9881,
    thumbnailUrl: ytThumb("Mde2q7GFCrw"),
    loadFullData: () => import("./Mde2q7GFCrw").then((m) => m.default),
  },
  {
    id: "csA9YhzYvmk",
    youtubeUrl: ytUrl("csA9YhzYvmk"),
    title:
      "The Happiness Expert That Made 51 Million People Happier: Mo Gawdat | E101",
    channel: "The Diary Of A CEO",
    durationSec: 7054,
    thumbnailUrl: ytThumb("csA9YhzYvmk"),
    loadFullData: () => import("./csA9YhzYvmk").then((m) => m.default),
  },
  {
    id: "BWJ4vnXIvts",
    youtubeUrl: ytUrl("BWJ4vnXIvts"),
    title:
      "12 Laws Of Power For Life — Robert Greene | Modern Wisdom Podcast 383",
    channel: "Chris Williamson",
    durationSec: 3930,
    thumbnailUrl: ytThumb("BWJ4vnXIvts"),
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
