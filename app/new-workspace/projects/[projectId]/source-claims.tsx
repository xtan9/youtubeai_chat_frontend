import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ClaimSpace } from "@/lib/video-space/claim-spaces";

type Props = {
  rooms: ClaimSpace[];
  selected?: string;
  ready: boolean;
  openClaim: (id: string) => void;
};

export function ClaimLinks({
  rooms,
  selected,
  ready,
  openClaim,
  offset = 0,
}: Props & { offset?: number }) {
  const listId = useId();
  return rooms.map((room, index) => (
    <button
      key={room.id}
      className="vs-claim-link"
      aria-label={room.title}
      title={room.title}
      aria-describedby={
        ready && !room.versions.length ? listId + index : undefined
      }
      aria-current={room.id === selected ? "page" : undefined}
      onClick={() => openClaim(room.id)}
    >
      <span className="vs-ordinal" aria-hidden="true">
        {String(offset + index + 1).padStart(2, "0")}
      </span>
      <span className="vs-claim-label">{room.title}</span>
      {ready && !room.versions.length && (
        <small id={listId + index}>待核查</small>
      )}
    </button>
  ));
}

export function SourceClaims({
  first = false,
  activeSource,
  ...props
}: Props & {
  first?: boolean;
  activeSource: boolean;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const [initiallyOpen] = useState(first);
  const more = useRef<HTMLDetailsElement>(null);
  const selectedIndex = props.rooms.findIndex(
    (room) => room.id === props.selected,
  );

  // Deep links, script citations and browser history can land in a closed group.
  // Run only when navigation changes, so manual expansion stays under user control.
  useLayoutEffect(() => {
    if (!activeSource || !details.current) return;
    details.current.open = true;
    if (selectedIndex >= 4 && more.current) more.current.open = true;

    const row = details.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    const tree = details.current?.closest<HTMLElement>("nav");
    if (!row || !tree?.clientHeight) return;
    const bounds = row.getBoundingClientRect(),
      viewport = tree.getBoundingClientRect();
    if (bounds.top >= viewport.bottom)
      tree.scrollTop += bounds.bottom - viewport.bottom;
    else if (bounds.bottom <= viewport.top)
      tree.scrollTop += bounds.top - viewport.top;
  }, [activeSource, selectedIndex, props.selected]);

  if (!props.rooms.length) return null;
  return (
    <details className="vs-source-claims" ref={details} open={initiallyOpen}>
      <summary>关键观点 · {props.rooms.length}</summary>
      <div className="vs-claim-branch">
        <ClaimLinks {...props} rooms={props.rooms.slice(0, 4)} />
        {props.rooms.length > 4 && (
          <details ref={more} className="vs-more-claims">
            <summary>
              <span>查看全部 {props.rooms.length} 条</span>
              <span>收起其余观点</span>
            </summary>
            <ClaimLinks {...props} offset={4} rooms={props.rooms.slice(4)} />
          </details>
        )}
      </div>
    </details>
  );
}
