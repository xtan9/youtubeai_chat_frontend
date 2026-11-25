"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {IntentShell} from "@/app/workspace/intent/shell";
import {IntentDesk} from "@/app/workspace/intent/desk";
import { useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ChevronLeft,
  Plus,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  ListTree,
  PanelRightClose,
} from "lucide-react";
import type { ResearchVersion } from "@/lib/projects/project-research-contract";
import type { ProjectSourceSet } from "@/lib/projects/project-source-set-contract";
import { requestJson, useSpace, SpaceRequestError } from "./use-space";
import { Script, Partner, useWriting } from "./writing";
import { ClaimLinks, revealDirectoryItem } from "./source-claims";
import { RoomToolbar, ClaimRoom, ClaimRoomHeader } from "./claim-room";
import {
  groupClaimSpaces,
  type ResearchAttempt,
} from "@/lib/video-space/claim-spaces";
import { HighlightTranslation } from "@/app/summary/components/highlight-translation";
import { pickDefaultLanguage } from "@/lib/utils/browser-locale";
import { SUPPORTED_LANGUAGE_CODES } from "@/lib/constants/languages";
import { Library } from "./library";
import "./workbench.css";

type Side = "research" | "partner";

type ProjectHeadingProps = { projectId: string; name: string };
type InitialData = {
  history: ResearchVersion[] | null;
  sources: ProjectSourceSet | null;
};

async function loadResearchHistory(api: string, signal: AbortSignal) {
  let cursor: string | null = null;
  const versions: ResearchVersion[] = [];
  do {
    const page: { versions: ResearchVersion[]; nextCursor?: string } =
      await requestJson(
        api +
          "/research" +
          (cursor ? "?before=" + encodeURIComponent(cursor) : ""),
        "GET",
        undefined,
        signal,
      );
    versions.push(...page.versions);
    cursor = page.nextCursor ?? null;
  } while (cursor);
  return versions;
}

function ProjectHeading({ projectId, name }: ProjectHeadingProps) {
  const tr = useTranslations("ui");
  return (
    <header className="vs-heading">
      <div>
        <nav aria-label={tr("currentLocation")}>
          <Link href="/new-workspace">
            <ChevronLeft size={14} /> {tr("newWorkspace")}
          </Link>
          <span aria-hidden="true">/</span>
          <span>{tr("videoProjectTitle")}</span>
        </nav>
        <h1>{name}</h1>
      </div>
      <Link href={"/workspace/projects/" + projectId+"/materials"}>{tr("originalProjectMaterials")}</Link>
    </header>
  );
}

export function Workbench({ projectId, name, legacy=false }: ProjectHeadingProps & {legacy?:boolean}) {
  const tr = useTranslations("ui");
  const api = "/api/projects/" + projectId;
  const store = useSpace(api + "/space");
  const params = useSearchParams();
  const [initial, setInitial] = useState<InitialData>();
  const inRoom = !!(
    params.get("claim") ||
    params.get("finding") ||
    params.has("source")
  );
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void Promise.allSettled([
      loadResearchHistory(api, signal),
      requestJson<{ sourceSet: ProjectSourceSet }>(
        api + "/source-set",
        "GET",
        undefined,
        signal,
      ),
    ]).then(([history, sources]) => {
      if (signal.aborted) return;
      setInitial({
        history: history.status === "fulfilled" ? history.value : null,
        sources: sources.status === "fulfilled" ? sources.value.sourceSet : null,
      });
    });
    return () => controller.abort();
  }, [api]);

  if(!legacy || store.space?.drafts.find(d => d.id === store.space?.activeDraft)?.outline) return <IntentShell><div id="work">{store.space && initial ?
    <IntentDesk name={name} projectId={projectId} initial={initial} store={store}/> :
    <p role={store.loadError?"alert":"status"}>{store.loadError || tr("loadingProject")} {store.loadError && <button onClick={()=>location.reload()}>{tr("reload")}</button>}</p>
  }</div></IntentShell>;
  return (
    <div className="vs ph-no-capture" data-ph-no-autocapture>
      <ProjectHeading projectId={projectId} name={name} />
      {store.space && initial ? (
        <Desk
          {...store}
          space={store.space}
          api={api}
          projectId={projectId}
          params={params}
          inRoom={inRoom}
          initial={initial}
        />
      ) : store.loadError ? (
        <p role="alert">
          {store.loadError}{" "}
          <button onClick={() => window.location.reload()}>{tr("reload")}</button>
        </p>
      ) : (
        <div className="vs-grid vs-loading" data-claim={inRoom || undefined}>
          <div
            id="vs-research"
            className="vs-panel"
            aria-hidden={inRoom || undefined}
          >
            {!inRoom && <p role="status">{tr("loadingProject")}</p>}
          </div>
          {inRoom && (
            <div className="vs-panel vs-claim-room">
              <p role="status">{tr("loadingProject")}</p>
            </div>
          )}
          <div className="vs-panel vs-script" aria-hidden="true" />
          {!inRoom && <div className="vs-panel" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}
function Desk({
  space,
  live,
  attachPdf,
  update,
  status,
  flush,
  ensureReadingSaved,
  api,
  projectId,
  params,
  inRoom,
  initial,
}: Omit<ReturnType<typeof useSpace>, "space" | "loadError"> &
  Pick<ProjectHeadingProps, "projectId"> & {
    space: NonNullable<ReturnType<typeof useSpace>["space"]>;
    api: string;
    params: ReadonlyURLSearchParams;
    inRoom: boolean;
    initial: InitialData;
  }) {
  const tr = useTranslations("ui");
  const [fold, setFold] = useState({ research: false, partner: false }),
    [max, setMax] = useState<Side | null>(null),
    [adding, setAdding] = useState(false);
  const ready = initial.history !== null;
  const [versions, setVersions] = useState<ResearchVersion[]>(initial.history ?? []);
  const historyError = ready ? "" : tr("researchHistoryCouldNotBeLoadedPleaseReload");
  const [pending, setPending] = useState<{
    claim: string;
    question: string;
  } | null>(null);
  const [questions, setQuestions] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<Record<string, string | undefined>>(
    {},
  );
  const [discussionBusy, setDiscussionBusy] = useState<string>();
  const [discussionErrors, setDiscussionErrors] = useState<
    Record<string, string>
  >({});
  const discussionLock = useRef(false);
  const roomRef = useRef<HTMLElement>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const tree = useRef<HTMLElement>(null);
  const deskPosition = useRef<{
    top: number;
    pageTop: number;
    trigger: HTMLElement | null;
  } | null>(null);
  const sourceId = params.get("source");
  const claimId = params.get("claim");
  const findingId = params.get("finding");
  const index = useMemo(
    () =>
      groupClaimSpaces(
        space.resources,
        space.customClaims,
        versions,
        space.researchAttempts,
      ),
    [space.resources, space.customClaims, versions, space.researchAttempts],
  );
  const active = claimId
    ? index.rooms.get(claimId)
    : findingId
      ? index.byFinding.get(findingId)
      : undefined;
  const overview = sourceId !== null && !claimId && !findingId;
  const parentId = overview ? sourceId : active && (active.origin?.id ?? "");
  const siblings =
    parentId !== undefined ? (index.bySource.get(parentId) ?? []) : [];
  const parentTitle = siblings[0]?.origin?.title ?? tr("projectClaims");

  const rememberDesk = useCallback(() => {
    if (!tree.current) return;
    const trigger = document.activeElement;
    deskPosition.current = {
      top: tree.current.scrollTop,
      pageTop: window.scrollY,
      trigger: trigger instanceof HTMLElement ? trigger : null,
    };
  }, []);
  useEffect(() => {
    if (inRoom) return;
    window.addEventListener("popstate", rememberDesk);
    return () => window.removeEventListener("popstate", rememberDesk);
  }, [inRoom, rememberDesk]);

  const route = params.toString();
  const previousRoute = useRef(route);
  useLayoutEffect(() => {
    if (previousRoute.current === route) return;
    if (!inRoom && deskPosition.current && tree.current) {
      const { top, pageTop, trigger } = deskPosition.current;
      tree.current.scrollTop = top;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      window.scrollTo({ top: pageTop, behavior: "instant" });
      deskPosition.current = null;
    } else {
      const heading = document.getElementById(
        findingId
          ? "finding-" + findingId
          : inRoom
            ? "vs-room-title"
            : "vs-desk-title",
      );
      if (!heading) return;
      if (inRoom && !findingId && roomRef.current)
        roomRef.current.scrollTop = 0;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    previousRoute.current = route;
  }, [route, inRoom, findingId, active]);
  const selected = active?.versions.find((v) => v.id === findingId);
  const visibleFinding = selected ?? active?.versions.at(-1);
  const writing = useWriting({ space, live, update, api, versions });
  const researchLock = useRef(false);
  const closeDirectory = useCallback(() => {
    setDirectoryOpen(false);
    document
      .getElementById("vs-toggle-directory")
      ?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!directoryOpen) return;
    const selected = tree.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    const target = selected?.getClientRects().length
      ? selected
      : tree.current?.querySelector<HTMLElement>(
          '.vs-source[data-active="true"] .vs-source-toggle',
        );
    if (target) {
      revealDirectoryItem(target);
      target.focus({ preventScroll: true });
    } else
      document
        .getElementById("vs-close-directory")
        ?.focus({ preventScroll: true });
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeDirectory();
    }
    const dismiss = () => setDirectoryOpen(false);
    const desktop = matchMedia("(min-width:761px)");
    desktop.addEventListener("change", dismiss);
    window.addEventListener("popstate", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      desktop.removeEventListener("change", dismiss);
      window.removeEventListener("popstate", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [directoryOpen, closeDirectory]);
  function open(side: Side) {
    setFold((v) => ({ ...v, [side]: false }));
    setMax((v) => (v === side ? v : null));
    requestAnimationFrame(() => {
      if (matchMedia("(max-width:760px)").matches)
        document
          .getElementById("vs-" + side)
          ?.scrollIntoView({ block: "start" });
    });
  }
  function navigate(claim?: string, finding?: string, source?: string) {
    if (!inRoom && (claim || finding || source !== undefined)) rememberDesk();
    const url = new URL(window.location.href);
    url.searchParams.delete("claim");
    url.searchParams.delete("finding");
    url.searchParams.delete("source");
    if (source !== undefined) url.searchParams.set("source", source);
    if (claim) url.searchParams.set("claim", claim);
    if (finding) url.searchParams.set("finding", finding);
    if (url.href !== window.location.href)
      window.history.pushState(null, "", url);
    else if (directoryOpen)
      document.getElementById("vs-room-title")?.focus({ preventScroll: true });
    setDirectoryOpen(false);
  }
  function show(id: string) {
    navigate(index.byFinding.get(id)?.id, id);
  }
  async function discuss(question: string, finding?: ResearchVersion) {
    if (!active || !ready || discussionLock.current || !question.trim()) return;
    const room = active;
    const discussion = space.claimDiscussion ?? [];
    if (discussion.length >= 2000) {
      setDiscussionErrors((old) => ({
        ...old,
        [room.id]: "discussionFull",
      }));
      return;
    }
    discussionLock.current = true;
    setDiscussionBusy(room.id);
    setDiscussionErrors((old) => ({ ...old, [room.id]: "" }));
    try {
      const history = discussion
        .filter((turn) => turn.claimId === room.id)
        .slice(-6)
        .map(({ question, reply }) => ({ question, reply }));
      const { reply } = await requestJson<{ reply: string }>(
        api + "/space",
        "POST",
        {
          action: "discussClaim",
          question,
          claim: room.title,
          origin: room.origin?.quote,
          history,
          finding:
            finding &&
            JSON.stringify({
              question: finding.document.question,
              synthesis: finding.document.synthesis,
              sources: finding.document.evidence.map(({ id, title }) => ({
                id,
                title,
              })),
            }).slice(0, 12000),
        },
      );
      const turn = {
        id: crypto.randomUUID(),
        claimId: room.id,
        question,
        reply,
        created: new Date().toISOString(),
        finding: finding?.id,
      };
      if (
        !update((s) => ({
          ...s,
          claimDiscussion: [...(s.claimDiscussion ?? []), turn],
        }))
      )
        throw Error("discussionSave");
      setQuestions((old) =>
        old[room.id] === question ? { ...old, [room.id]: "" } : old,
      );
      await flush();
    } catch (e) {
      setDiscussionErrors((old) => ({
        ...old,
        [room.id]: (e as Error).message,
      }));
    } finally {
      discussionLock.current = false;
      setDiscussionBusy(undefined);
    }
  }
  async function investigate(
    q: string,
    parent?: string,
    retry?: ResearchAttempt,
  ) {
    const room = active;
    const submittedFrom = window.location.href;
    if (!room || !ready || researchLock.current || q.trim().length < 3) return;
    researchLock.current = true;
    setPending({ claim: room.id, question: q });
    try {
      const result = await requestJson<{ versions: ResearchVersion[] }>(
        api + "/research",
        "POST",
        {
          question: q.trim(),
          baseVersionId: versions[0]?.id ?? null,
          space: {
            claimId: room.id,
            claimTitle: room.title,
            origin: room.origin,
            followUpTo: parent,
          },
        },
      );
      setVersions((old) => [result.versions[0], ...old]);
      setTargets((old) =>
        old[room.id] === parent ? { ...old, [room.id]: undefined } : old,
      );
      setQuestions((old) =>
        old[room.id] === q ? { ...old, [room.id]: "" } : old,
      );
      if (retry)
        update((s) => ({
          ...s,
          researchAttempts: s.researchAttempts?.filter(
            (a) => a.id !== retry.id,
          ),
        }));
      // Returning from another claim must not happen just because this request finished.
      const url = new URL(window.location.href);
      if (url.href === submittedFrom && url.searchParams.has("finding")) {
        url.searchParams.set("claim", room.id);
        url.searchParams.delete("finding");
        window.history.replaceState(null, "", url);
      }
    } catch (e) {
      update((s) => ({
        ...s,
        researchAttempts: [
          ...(s.researchAttempts ?? [])
            .filter((a) => a.id !== retry?.id)
            .slice(-149),
          {
            id: retry?.id ?? crypto.randomUUID(),
            claimId: room.id,
            question: q,
            message: (e as Error).message.slice(0, 1000),
            evidenceGap: e instanceof SpaceRequestError && e.status === 422,
            created: new Date().toISOString(),
            origin: room.origin,
            parent,
          },
        ],
      }));
      await flush();
    } finally {
      researchLock.current = false;
      setPending(null);
    }
  }
  function handoff(v: ResearchVersion) {
    writing.append({
      role: "handoff",
      text: v.document.question + "\n" + v.document.synthesis.judgment.text,
      finding: v.id,
    });
  }
  function panel(side: Side, children: ReactNode) {
    const collapsed = !inRoom && fold[side] && max !== side,
      title = tr(side === "research" ? "researchDesk" : "writingPartner"),
      Icon = side === "research" ? PanelLeftClose : PanelRightClose;
    return (
      <section
        id={"vs-" + side}
        className="vs-panel"
        aria-label={title}
        hidden={!inRoom && !!max && max !== side}
        data-open={(side === "research" && directoryOpen) || undefined}
        data-folded={collapsed}
      >
        <button
          id={"vs-expand-" + side}
          className="vs-rail"
          hidden={!collapsed}
          onClick={() => {
            open(side);
            requestAnimationFrame(() =>
              document.getElementById("vs-collapse-" + side)?.focus(),
            );
          }}
        >
          {tr("expandPanel", {title})}
        </button>
        <div
          hidden={collapsed}
          className={side === "research" ? "vs-library-panel" : undefined}
        >
          <div className="vs-row vs-panel-bar">
            {side === "research" ? (
              <h2 id="vs-desk-title" tabIndex={-1}>
                {tr("materialsClaims")}
              </h2>
            ) : (
              <h2>{title}</h2>
            )}
            <div className="vs-actions" data-room={inRoom || undefined}>
              <button
                id={"vs-collapse-" + side}
                aria-label={tr("collapsePanel", {title})}
                onClick={() => {
                  setMax(null);
                  setFold((v) => ({ ...v, [side]: true }));
                  requestAnimationFrame(() =>
                    document.getElementById("vs-expand-" + side)?.focus(),
                  );
                }}
              >
                <Icon size={13} />
                {tr("collapse")}
              </button>
              <button
                aria-label={tr(max === side ? "restorePanel" : "maximizePanel", {title})}
                aria-pressed={max === side}
                onClick={() => setMax(max === side ? null : side)}
              >
                {max === side ? (
                  <Minimize2 size={13} />
                ) : (
                  <Maximize2 size={13} />
                )}{" "}
                {max === side ? tr("restore") : tr("maximize")}
              </button>
            </div>
            {inRoom && (
              <button
                id="vs-close-directory"
                className="vs-directory-close"
                aria-label={tr("closeDirectory")}
                onClick={closeDirectory}
              >
                {tr("close")}
              </button>
            )}
          </div>
          {children}
        </div>
      </section>
    );
  }
  const directoryToggle = (
    <button
      id="vs-toggle-directory"
      className="vs-switch-claim"
      aria-controls="vs-research"
      aria-expanded={directoryOpen}
      onClick={() => setDirectoryOpen(true)}
    >
      <ListTree size={15} aria-hidden="true" /> {tr("directory")}
    </button>
  );
  return (
    <>
      {inRoom && directoryOpen && (
        <div
          className="vs-directory-shade"
          onClick={closeDirectory}
          aria-hidden="true"
        />
      )}
      <div
        className="vs-grid"
        data-claim={inRoom || undefined}
        data-max={inRoom ? "" : (max ?? "")}
        style={
          {
            "--left": !inRoom && fold.research ? "44px" : undefined,
            "--right": !inRoom && fold.partner ? "44px" : undefined,
          } as CSSProperties
        }
      >
        {panel(
          "research",
          <>
            <div className="vs-row vs-library-actions">
              <div className="vs-actions">
                <button
                  aria-label={tr("addSource")}
                  aria-expanded={adding}
                  onClick={() => setAdding(!adding)}
                >
                  <Plus size={14} /> {tr("sources")}
                </button>
              </div>
            </div>
            <nav className="vs-library" aria-label={tr("directory")} ref={tree}>
              <Library
                initialSources={initial.sources}
                {...{
                  api,
                  space,
                  update,
                  attachPdf,
                  versions,
                  show,
                  adding,
                  setAdding,
                }}
                bySource={index.bySource}
                activeSource={parentId}
                selected={active?.id}
                ready={ready}
                openClaim={navigate}
              />
            </nav>
            {historyError && <p role="alert">{historyError}</p>}
          </>,
        )}
        {inRoom && (
          <section
            ref={roomRef}
            data-translation-room=""
            data-translation-version={
              active &&
              !active.resource &&
              !space.customClaims?.some((c) => c.id === active.id)
                ? active.versions[0]?.id
                : undefined
            }
            className="vs-panel vs-claim-room"
            aria-label={overview ? tr("sourceClaims") : tr("claimRoom")}
          >
            {overview ? (
              <header className="vs-room-header">
                <RoomToolbar
                  title={tr("materialsClaims")}
                  directoryToggle={directoryToggle}
                  onBack={() => navigate()}
                />
                <h2 id="vs-room-title" tabIndex={-1}>
                  {siblings.length ? parentTitle : tr("sourceClaims")}
                </h2>
              </header>
            ) : (
              <ClaimRoomHeader
                room={active}
                directoryToggle={directoryToggle}
                onParent={() => navigate(undefined, undefined, parentId)}
                onBack={() => navigate()}
              >
                {active && (
                  <HighlightTranslation
                    key={active.id}
                    projectId={projectId}
                    claimId={active.id}
                    ensureSaved={ensureReadingSaved}
                    readingRef={roomRef}
                    browserLanguage={pickDefaultLanguage(
                      Array.from(navigator.languages ?? []),
                      SUPPORTED_LANGUAGE_CODES,
                    )}
                  />
                )}
              </ClaimRoomHeader>
            )}
            <div className="vs-room-tools">
              <button
                className="vs-jump-script"
                onClick={() =>
                  document
                    .querySelector<HTMLTextAreaElement>(".vs-script .vs-manuscript textarea")
                    ?.focus()
                }
              >
                {tr("writeScript")}
              </button>
            </div>
            {overview && siblings.length ? (
              <div className="vs-parent-claims">
                <h3>
                  {parentId ? tr("thisSourceClaims") : tr("projectClaims")} · {siblings.length}
                </h3>
                <ClaimLinks
                  rooms={siblings}
                  ready={ready}
                  openClaim={navigate}
                />
              </div>
            ) : active ? (
              <ClaimRoom
                key={active.id}
                room={active}
                selected={selected}
                question={questions[active.id] ?? ""}
                setQuestion={(q) => {
                  setQuestions((old) => ({ ...old, [active.id]: q }));
                  if (q.trim() && selected && !targets[active.id]) {
                    setTargets((old) => ({ ...old, [active.id]: selected.id }));
                  }
                }}
                search={investigate}
                discuss={discuss}
                turns={
                  space.claimDiscussion?.filter(
                    (t) => t.claimId === active.id,
                  ) ?? []
                }
                chatBusy={!!discussionBusy}
                chatStatus={
                  discussionBusy === active.id ? tr("replying") : undefined
                }
                chatError={discussionErrors[active.id]}
                target={targets[active.id]}
                setTarget={(id) =>
                  setTargets((old) => ({ ...old, [active.id]: id }))
                }
                busy={!!pending}
                pending={
                  pending?.claim === active.id ? pending.question : undefined
                }
                handoff={handoff}
                handed={
                  !!visibleFinding &&
                  space.messages.some(
                    (m) =>
                      m.role === "handoff" && m.finding === visibleFinding.id,
                  )
                }
                select={show}
                ready={ready}
              />
            ) : (
              <p role="status">
                {historyError || tr("missingClaim")}
              </p>
            )}
            {active && historyError && <p role="alert">{historyError}</p>}
          </section>
        )}
        <section
          className="vs-panel vs-script"
          aria-label={tr("scriptEditor")}
          hidden={!inRoom && !!max}
        >
          {inRoom && (
            <div className="vs-script-heading">
              <h2>{tr("scriptEditor")}</h2>
              <button
                className="vs-jump-script"
                onClick={() =>
                  document.getElementById("vs-room-title")?.focus()
                }
              >
                {tr("backToClaim")}
              </button>
            </div>
          )}
          <Script
            w={writing}
            {...{ space, status, flush, show }}
            openWriter={() => {
              if (inRoom) navigate();
              open("partner");
            }}
          />
        </section>
        {!inRoom &&
          panel("partner", <Partner w={writing} {...{ space, show }} />)}
      </div>
    </>
  );
}
