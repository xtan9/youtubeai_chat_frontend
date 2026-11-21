import {useTranslations} from "next-intl";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronRight } from "lucide-react";
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
  const tr = useTranslations("ui");
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
      onClick={(event) => {
        // Safari does not normally focus a button clicked with a pointer.
        event.currentTarget.focus({ preventScroll: true });
        openClaim(room.id);
      }}
    >
      <span className="vs-ordinal" aria-hidden="true">
        {String(offset + index + 1).padStart(2, "0")}
      </span>
      <span className="vs-claim-label">{room.title}</span>
      {ready && !room.versions.length && (
        <small id={listId + index}>{tr("unchecked")}</small>
      )}
    </button>
  ));
}

// A sticky source title occupies the first part of the directory's viewport.
export function revealDirectoryItem(row: HTMLElement) {
  const tree = row.closest("nav");
  if (!tree?.clientHeight) return;
  const heading = row
    .closest(".vs-source")
    ?.querySelector(".vs-source-heading");
  const viewport = tree.getBoundingClientRect();
  const stickyHeight =
    heading && !heading.contains(row)
      ? heading.getBoundingClientRect().height
      : 0;
  // Leave the focus outline inside the directory, including at fractional zoom.
  const top = viewport.top + stickyHeight + 4;
  const bottom = viewport.bottom - 4;
  const bounds = row.getBoundingClientRect();
  if (bounds.top < top) tree.scrollTop += bounds.top - top;
  else if (bounds.bottom > bottom) tree.scrollTop += bounds.bottom - bottom;
}

export function SourceClaims({
  first = false,
  activeSource,
  title,
  kind,
  summaryToggle,
  children,
  ...props
}: Props & {
  first?: boolean;
  activeSource: boolean;
  title: string;
  kind?: string;
  summaryToggle?: ReactNode;
  children?: ReactNode;
}) {
  const tr = useTranslations("ui");
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLDetailsElement>(null);
  const destination = activeSource ? (props.selected ?? "overview") : undefined;
  const [disclosure, setDisclosure] = useState<{
    destination?: string;
    open: boolean | null;
  }>({
    destination,
    open: activeSource ? true : null,
  });
  // Untouched groups follow the first source once its order has loaded.
  // Later navigation opens the destination without closing any other group.
  if (disclosure.destination !== destination) {
    setDisclosure({ destination, open: activeSource ? true : disclosure.open });
  }
  const open = disclosure.open ?? first;
  const selectedIndex = props.rooms.findIndex(
    (room) => room.id === props.selected,
  );

  useLayoutEffect(() => {
    if (!activeSource) return;
    if (selectedIndex >= 4 && more.current) more.current.open = true;
    const row = list.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    // Clicking a row already in the tree must leave the pointer and list in place.
    const target =
      row ??
      list.current
        ?.closest(".vs-source")
        ?.querySelector<HTMLElement>(".vs-source-toggle");
    if (target && target !== document.activeElement)
      revealDirectoryItem(target);
  }, [activeSource, selectedIndex, props.selected]);

  return (
    <div className="vs-source" data-active={activeSource || undefined}>
      <div className="vs-source-heading">
        {kind && <small>{kind}</small>}
        <div className="vs-row">
          <h3>
            {props.rooms.length ? (
              <button
                className="vs-source-toggle"
                aria-expanded={open}
                aria-controls={listId}
                aria-describedby={listId + "-count"}
                onClick={() => setDisclosure({ destination, open: !open })}
              >
                {title}
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            ) : (
              title
            )}
          </h3>
          {summaryToggle}
        </div>
        {!!props.rooms.length && (
          <small id={listId + "-count"}>{tr("keyClaims")} {props.rooms.length}</small>
        )}
      </div>
      {children}
      <div
        id={listId}
        ref={list}
        hidden={!open || !props.rooms.length}
        className="vs-source-claims vs-claim-branch"
      >
        <ClaimLinks {...props} rooms={props.rooms.slice(0, 4)} />
        {props.rooms.length > 4 && (
          <details ref={more} className="vs-more-claims">
            <summary>
              <span>{tr("allClaims", {count: props.rooms.length})}</span>
              <span>{tr("showFewerClaims")}</span>
            </summary>
            <ClaimLinks {...props} offset={4} rooms={props.rooms.slice(4)} />
          </details>
        )}
      </div>
    </div>
  );
}
