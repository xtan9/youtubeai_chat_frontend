"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
const label = { research: "研究台", partner: "创作搭档" };
type ProjectHeadingProps = { projectId: string; name: string };

function ProjectHeading({ projectId, name }: ProjectHeadingProps) {
  return (
    <header className="vs-heading">
      <div>
        <nav aria-label="当前位置">
          <Link href="/new-workspace">
            <ChevronLeft size={14} /> New Workspace
          </Link>
          <span aria-hidden="true">/</span>
          <span>视频 Space</span>
        </nav>
        <h1>{name}</h1>
      </div>
      <Link href={"/workspace/projects/" + projectId}>原项目资料 ↗</Link>
    </header>
  );
}

export function Workbench({ projectId, name }: ProjectHeadingProps) {
  const api = "/api/projects/" + projectId;
  const store = useSpace(api + "/space");
  return (
    <div className="vs ph-no-capture" data-ph-no-autocapture lang="zh-CN">
      {store.space ? (
        <Desk
          {...store}
          space={store.space}
          api={api}
          projectId={projectId}
          name={name}
        />
      ) : (
        <>
          <ProjectHeading projectId={projectId} name={name} />
          <p role="status">
            {store.status}{" "}
            <button onClick={() => window.location.reload()}>重新加载</button>
          </p>
        </>
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
  name,
}: Omit<ReturnType<typeof useSpace>, "space"> &
  ProjectHeadingProps & {
    space: NonNullable<ReturnType<typeof useSpace>["space"]>;
    api: string;
  }) {
  const [fold, setFold] = useState({ research: false, partner: false }),
    [max, setMax] = useState<Side | null>(null),
    [adding, setAdding] = useState(false);
  const [versions, setVersions] = useState<ResearchVersion[]>([]);
  const [ready, setReady] = useState(false);
  const [historyError, setHistoryError] = useState("");
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
  const [newClaim, setNewClaim] = useState<string | null>(null);
  const tree = useRef<HTMLElement>(null);
  const deskPosition = useRef<{
    top: number;
    pageTop: number;
    trigger: HTMLElement | null;
  } | null>(null);
  const params = useSearchParams();
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
  // A citation can be opened while earlier pages of research history are still loading.
  const active = claimId
    ? index.rooms.get(claimId)
    : findingId
      ? index.byFinding.get(findingId)
      : undefined;
  const overview = sourceId !== null && !claimId && !findingId;
  const inRoom = !!(claimId || findingId || overview);
  const parentId = overview ? sourceId : active && (active.origin?.id ?? "");
  const siblings =
    parentId !== undefined ? (index.bySource.get(parentId) ?? []) : [];
  const parentTitle = siblings[0]?.origin?.title ?? "项目观点";

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
  }, [route, inRoom, findingId, active, ready]);
  const selected = active?.versions.find((v) => v.id === findingId);
  const visibleFinding = selected ?? active?.versions.at(-1);
  const writing = useWriting({ space, live, update, api, versions });
  const researchLock = useRef(false);
  const history = useCallback(
    async (signal: AbortSignal) => {
      let cursor: string | null = null;
      const all: ResearchVersion[] = [];
      do {
        const page: { versions: ResearchVersion[]; nextCursor?: string } =
          await requestJson(
            api +
              "/research" +
              (cursor ? "?before=" + encodeURIComponent(cursor) : ""),
          );
        if (signal.aborted) return;
        all.push(...page.versions);
        cursor = page.nextCursor ?? null;
      } while (cursor);
      return all;
    },
    [api],
  );
  useEffect(() => {
    const c = new AbortController();
    void history(c.signal)
      .then((all) => {
        if (all && !c.signal.aborted) {
          setVersions(all);
          setReady(true);
        }
      })
      .catch(() => {
        if (!c.signal.aborted)
          setHistoryError("研究记录暂时无法读取，请重新加载。");
      });
    return () => c.abort();
  }, [history]);
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
        [room.id]: "此项目的讨论已达到保存上限。",
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
        throw Error("讨论无法保存，已保留你的问题。");
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
  function addClaim() {
    const text = newClaim?.trim();
    if (!text || text.length < 3) return;
    const id = crypto.randomUUID();
    if ((space.customClaims?.length ?? 0) >= 150) return;
    if (
      update((s) => ({
        ...s,
        customClaims: [...(s.customClaims ?? []), { id, text }],
      }))
    ) {
      setNewClaim(null);
      navigate(id);
    }
  }
  function panel(side: Side, children: ReactNode) {
    const collapsed = !inRoom && fold[side] && max !== side,
      title = label[side],
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
          展开{title}
        </button>
        <div
          hidden={collapsed}
          className={side === "research" ? "vs-library-panel" : undefined}
        >
          <div className="vs-row vs-panel-bar">
            {side === "research" ? (
              <h2 id="vs-desk-title" tabIndex={-1}>
                素材与观点
              </h2>
            ) : (
              <h2>{title}</h2>
            )}
            <div className="vs-actions" data-room={inRoom || undefined}>
              <button
                id={"vs-collapse-" + side}
                aria-label={"收起" + title}
                onClick={() => {
                  setMax(null);
                  setFold((v) => ({ ...v, [side]: true }));
                  requestAnimationFrame(() =>
                    document.getElementById("vs-expand-" + side)?.focus(),
                  );
                }}
              >
                <Icon size={13} />
                收起
              </button>
              <button
                aria-label={(max === side ? "还原" : "放大") + title}
                aria-pressed={max === side}
                onClick={() => setMax(max === side ? null : side)}
              >
                {max === side ? (
                  <Minimize2 size={13} />
                ) : (
                  <Maximize2 size={13} />
                )}{" "}
                {max === side ? "还原" : "放大"}
              </button>
            </div>
            {inRoom && (
              <button
                id="vs-close-directory"
                className="vs-directory-close"
                aria-label="关闭观点目录"
                onClick={closeDirectory}
              >
                关闭
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
      <ListTree size={15} aria-hidden="true" /> 素材目录
    </button>
  );
  return (
    <>
      <ProjectHeading projectId={projectId} name={name} />
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
            "--left":
              !inRoom && fold.research ? "44px" : "var(--library-width)",
            "--right": !inRoom && fold.partner ? "44px" : "minmax(0,1.05fr)",
          } as CSSProperties
        }
      >
        {panel(
          "research",
          <>
            <div className="vs-row vs-library-actions">
              <div className="vs-actions">
                <button
                  aria-label="添加素材"
                  aria-expanded={adding}
                  onClick={() => setAdding(!adding)}
                >
                  <Plus size={14} /> 素材
                </button>
                <button
                  aria-expanded={newClaim !== null}
                  onClick={() => setNewClaim(newClaim === null ? "" : null)}
                >
                  新建观点
                </button>
              </div>
            </div>
            {newClaim !== null && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  addClaim();
                }}
              >
                <input
                  autoFocus
                  aria-label="新观点"
                  value={newClaim}
                  maxLength={1400}
                  onChange={(e) => setNewClaim(e.target.value)}
                />
                <button
                  disabled={
                    newClaim.trim().length < 3 ||
                    (space.customClaims?.length ?? 0) >= 150
                  }
                >
                  打开观点空间
                </button>
              </form>
            )}
            <nav className="vs-library" aria-label="素材目录" ref={tree}>
              <Library
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
            aria-label={overview ? "素材观点" : "观点空间"}
          >
            {overview ? (
              <header className="vs-room-header">
                <RoomToolbar
                  title="素材与观点"
                  directoryToggle={directoryToggle}
                  onBack={() => navigate()}
                />
                <h2 id="vs-room-title" tabIndex={-1}>
                  {siblings.length ? parentTitle : "素材观点"}
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
                    .querySelector<HTMLTextAreaElement>(".vs-script textarea")
                    ?.focus()
                }
              >
                写脚本 →
              </button>
            </div>
            {overview && siblings.length ? (
              <div className="vs-parent-claims">
                <h3>
                  {parentId ? "本素材观点" : "项目观点"} · {siblings.length}
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
                  discussionBusy === active.id ? "正在回复…" : undefined
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
                {historyError ||
                  (ready
                    ? "找不到这个观点，请返回项目工作台。"
                    : "正在读取观点…")}
              </p>
            )}
            {active && historyError && <p role="alert">{historyError}</p>}
          </section>
        )}
        <section
          className="vs-panel vs-script"
          aria-label="脚本编辑器"
          hidden={!inRoom && !!max}
        >
          {inRoom && (
            <div className="vs-script-heading">
              <h2>脚本编辑器</h2>
              <button
                className="vs-jump-script"
                onClick={() =>
                  document.getElementById("vs-room-title")?.focus()
                }
              >
                ← 回到观点
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
