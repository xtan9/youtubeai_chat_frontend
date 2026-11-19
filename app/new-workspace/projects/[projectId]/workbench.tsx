"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
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
  PanelRightClose,
} from "lucide-react";
import type { ResearchVersion } from "@/lib/projects/project-research-contract";
import { requestJson, useSpace, SpaceRequestError } from "./use-space";
import { Script, Partner, useWriting } from "./writing";
import { ClaimDirectory, ClaimRoom } from "./claim-room";
import {
  groupClaimSpaces,
  type ResearchAttempt,
} from "@/lib/video-space/claim-spaces";
import { Library } from "./library";
import "./workbench.css";

type Side = "research" | "partner";
const label = { research: "研究台", partner: "创作搭档" };
type ProjectHeadingProps = { projectId: string; name: string };

function ProjectHeading({
  projectId,
  name,
  onBack,
}: ProjectHeadingProps & { onBack?: () => void }) {
  return (
    <header className="vs-heading">
      <div>
        <nav aria-label="当前位置">
          <Link href="/new-workspace">
            <ChevronLeft size={14} /> New Workspace
          </Link>
          <span aria-hidden="true">/</span>
          {onBack ? (
            <button type="button" onClick={onBack}>
              返回项目工作台
            </button>
          ) : (
            <span>视频 Space</span>
          )}
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
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [newClaim, setNewClaim] = useState<string | null>(null);
  const params = useSearchParams();
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
  const inRoom = !!(claimId || findingId);
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
  useEffect(() => {
    if (!directoryOpen) return;
    document
      .querySelector<HTMLButtonElement>(
        "#vs-claim-directory [aria-current=page]",
      )
      ?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setDirectoryOpen(false);
      document.getElementById("vs-toggle-directory")?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [directoryOpen]);
  function open(side: Side) {
    setFold((v) => ({ ...v, [side]: false }));
    setMax((v) => (v === side ? v : null));
    requestAnimationFrame(() => {
      if (matchMedia("(max-width:920px)").matches)
        document
          .getElementById("vs-" + side)
          ?.scrollIntoView({ block: "start" });
    });
  }
  function navigate(claim?: string, finding?: string) {
    const url = new URL(window.location.href);
    url.searchParams.delete("claim");
    url.searchParams.delete("finding");
    if (claim) url.searchParams.set("claim", claim);
    if (finding) url.searchParams.set("finding", finding);
    if (url.href !== window.location.href)
      window.history.pushState(null, "", url);
    setDirectoryOpen(false);
    requestAnimationFrame(() => {
      const heading = document.getElementById(
        finding
          ? "finding-" + finding
          : claim
            ? "vs-room-title"
            : "vs-desk-title",
      );
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
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
    const collapsed = fold[side] && max !== side,
      title = label[side],
      Icon = side === "research" ? PanelLeftClose : PanelRightClose;
    return (
      <section
        id={"vs-" + side}
        className="vs-panel"
        aria-label={title}
        hidden={!!max && max !== side}
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
        <div hidden={collapsed}>
          <div className="vs-row">
            <h2>{title}</h2>
            <div className="vs-actions">
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
          </div>
          {children}
        </div>
      </section>
    );
  }
  return (
    <>
      <ProjectHeading
        projectId={projectId}
        name={name}
        onBack={inRoom ? () => navigate() : undefined}
      />
      <div
        className="vs-grid"
        data-claim={inRoom || undefined}
        data-max={inRoom ? "" : (max ?? "")}
        style={
          {
            "--left": fold.research ? "44px" : "minmax(0,1fr)",
            "--right": fold.partner ? "44px" : "minmax(0,1.05fr)",
          } as CSSProperties
        }
      >
        <div hidden={inRoom} className="vs-desk-library">
          {panel(
            "research",
            <>
              <div className="vs-row vs-library-actions">
                <h3 id="vs-desk-title" tabIndex={-1}>
                  素材与观点
                </h3>
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
              <div className="vs-library">
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
                  claimRooms={ready ? index.rooms : undefined}
                  openClaim={navigate}
                />
              </div>
              {[...index.rooms.values()].some((r) => !r.resource) && (
                <details className="vs-project-claims">
                  <summary>项目观点</summary>
                  {[...index.rooms.values()]
                    .filter((r) => !r.resource)
                    .map((r) => (
                      <button
                        key={r.id}
                        className="vs-claim-link"
                        onClick={() => navigate(r.id)}
                      >
                        {r.title} ›
                      </button>
                    ))}
                </details>
              )}
              {historyError && <p role="alert">{historyError}</p>}
            </>,
          )}
        </div>
        {inRoom && (
          <aside
            id="vs-claim-directory"
            className="vs-panel vs-claim-directory"
            data-open={directoryOpen}
            aria-label="观点目录"
          >
            <button
              className="vs-directory-close"
              aria-label="关闭观点目录"
              onClick={() => {
                setDirectoryOpen(false);
                document.getElementById("vs-toggle-directory")?.focus();
              }}
            >
              关闭
            </button>
            <ClaimDirectory
              rooms={index.rooms}
              selected={active?.id ?? ""}
              open={navigate}
            />
          </aside>
        )}
        {inRoom && (
          <section className="vs-panel vs-claim-room" aria-label="观点空间">
            <div className="vs-room-tools">
              <button
                id="vs-toggle-directory"
                className="vs-switch-claim"
                aria-controls="vs-claim-directory"
                aria-expanded={directoryOpen}
                onClick={() => setDirectoryOpen(!directoryOpen)}
              >
                切换观点
              </button>
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
            {active ? (
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
