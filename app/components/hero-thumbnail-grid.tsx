"use client";

import Image from "next/image";

interface ThumbnailItem {
  readonly id: string;
  readonly title: string;
  readonly channel: string;
  readonly durationSec: number;
}

interface HeroThumbnailGridProps {
  readonly samples: ReadonlyArray<ThumbnailItem>;
  readonly activeId: string;
  readonly onSelect: (id: string) => void;
}

function thumbnailUrlFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
}

/**
 * 2x3 toggle-button grid for the hero demo's column 1. Replaces the v1
 * horizontal-scroll carousel — a fixed grid uses the column real-estate
 * better and reads as "pick one of these to demo." Each cell is a
 * button with `aria-pressed` so the press state is announced to AT.
 */
export default function HeroThumbnailGrid({
  samples,
  activeId,
  onSelect,
}: HeroThumbnailGridProps) {
  return (
    <div
      role="group"
      aria-label="Sample videos"
      className="grid grid-cols-3 gap-3 h-full content-start"
    >
      {samples.map((s) => {
        const active = s.id === activeId;
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={active}
            aria-label={s.title}
            onClick={() => onSelect(s.id)}
            className={`flex flex-col gap-1 rounded-lg p-1.5 border transition-colors duration-base cursor-pointer min-w-0 ${
              active
                ? "border-accent-brand ring-2 ring-accent-brand/30"
                : "border-border-subtle hover:border-border-default"
            }`}
          >
            <div className="relative w-full aspect-video rounded overflow-hidden bg-surface-sunken">
              <Image
                src={thumbnailUrlFor(s.id)}
                alt=""
                fill
                sizes="(min-width: 1024px) 100px, 33vw"
                className="object-cover"
              />
            </div>
            <span className="text-body-xs text-text-primary line-clamp-2 text-left leading-snug">
              {s.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}
