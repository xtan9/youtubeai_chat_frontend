"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
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
import type {
  ResearchVersion,
  ResearchDocument,
} from "@/lib/projects/project-research-contract";
import { requestJson, useSpace, SpaceRequestError } from "./use-space";
import { Script, Partner, useWriting } from "./writing";
import { Finding } from "./research";
import { Library } from "./library";
import "./workbench.css";

type Side = "research" | "partner";
const label = { research: "研究台", partner: "创作搭档" };
type Origin = NonNullable<ResearchDocument["space"]>["origin"];
export function Workbench({
  projectId,
  name,
}: {
  projectId: string;
  name: string;
}) {
  const api = "/api/projects/" + projectId;
  const store = useSpace(api + "/space");
  return (
    <div className="vs ph-no-capture" data-ph-no-autocapture lang="zh-CN">
      <div className="vs-heading">
        <div>
          <Link href="/new-workspace">
            <ChevronLeft size={14} />
            New Workspace
          </Link>
          <span> / 视频 Space</span>
          <h1>{name}</h1>
        </div>
        <Link href={"/workspace/projects/" + projectId}>原项目资料 ↗</Link>
      </div>
      {store.space ? (
        <Desk {...store} space={store.space} api={api} />
      ) : (
        <p role="status">
          {store.status}{" "}
          <button onClick={() => window.location.reload()}>重新加载</button>
        </p>
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
}: Omit<ReturnType<typeof useSpace>, "space"> & {
  space: NonNullable<ReturnType<typeof useSpace>["space"]>;
  api: string;
}) {
  const [fold, setFold] = useState({ research: false, partner: false }),
    [max, setMax] = useState<Side | null>(null),
    [tab, setTab] = useState("素材"),
    [adding, setAdding] = useState(false);
  const [versions, setVersions] = useState<ResearchVersion[]>([]),
    [question, setQuestion] = useState(""),
    [researching, setResearching] = useState(false),
    [researchError, setResearchError] = useState(""),
    [pending, setPending] = useState(""),
    [selected, setSelected] = useState<string>(),
    [parent, setParent] = useState<ResearchVersion>();
  const [ready, setReady] = useState(false);
  const writing = useWriting({ space, live, update, api, versions });
  const researchLock = useRef(false);
  const initialParent = useRef(space.researchParent);
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
          setParent(
            initialParent.current === undefined
              ? all[0]
              : all.find((v) => v.id === initialParent.current),
          );
          setReady(true);
        }
      })
      .catch(() => {
        if (!c.signal.aborted)
          setResearchError("研究记录暂时无法读取，请重新加载。");
      });
    return () => c.abort();
  }, [history]);
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
  function show(id: string) {
    open("research");
    setTab("证据");
    setSelected(id);
    requestAnimationFrame(() =>
      document.getElementById("finding-" + id)?.focus(),
    );
  }
  async function investigate(
    q: string,
    origin?: Origin,
    followUp?: ResearchVersion,
  ) {
    if (!ready || researchLock.current || q.trim().length < 3) return;
    researchLock.current = true;
    open("research");
    setTab("研究对话");
    setResearchError("");
    setPending(q);
    setResearching(true);
    try {
      const result = await requestJson<{ versions: ResearchVersion[] }>(
        api + "/research",
        "POST",
        {
          question: q,
          baseVersionId: versions[0]?.id ?? null,
          space: {
            origin: origin ?? followUp?.document.space?.origin,
            followUpTo: followUp?.id,
          },
        },
      );
      setVersions((v) => [result.versions[0], ...v]);
      selectParent(result.versions[0]);
      setPending("");
      setQuestion((old) => (old === q ? "" : old));
    } catch (e) {
      const message = (e as Error).message;
      setResearchError(message);
      setPending("");
      update((s) => ({
        ...s,
        researchAttempts: [
          ...(s.researchAttempts ?? []).slice(-149),
          {
            id: crypto.randomUUID(),
            question: q,
            message: message.slice(0, 1000),
            evidenceGap: e instanceof SpaceRequestError && e.status === 422,
            created: new Date().toISOString(),
            origin,
            parent: followUp?.id,
          },
        ],
      }));
      setQuestion((old) => old || q);
    } finally {
      researchLock.current = false;
      setResearching(false);
    }
  }
  function selectParent(v: ResearchVersion | undefined) {
    setParent(v);
    update((s) => ({ ...s, researchParent: v?.id ?? null }));
  }
  function follow(v: ResearchVersion) {
    open("research");
    selectParent(v);
    setTab("研究对话");
    requestAnimationFrame(() =>
      document.getElementById("vs-question")?.focus(),
    );
  }
  function handoff(v: ResearchVersion) {
    writing.append({
      role: "handoff",
      text: v.document.question + "\n" + v.document.synthesis.judgment.text,
      finding: v.id,
    });
    open("partner");
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
    <div
      className="vs-grid"
      data-max={max ?? ""}
      style={
        {
          "--left": fold.research ? "44px" : "minmax(0,1fr)",
          "--right": fold.partner ? "44px" : "minmax(0,1.05fr)",
        } as CSSProperties
      }
    >
      {panel(
        "research",
        <>
          <nav className="vs-tabs" aria-label="研究导航">
            {["素材", "证据", "研究对话"].map((t) => (
              <button
                key={t}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                {t}
                {t === "证据" ? " " + versions.length : ""}
              </button>
            ))}
            <button
              aria-label="添加素材"
              title="添加素材"
              aria-expanded={tab === "素材" && adding}
              onClick={() => {
                setAdding(tab === "素材" ? !adding : true);
                setTab("素材");
              }}
            >
              <Plus size={16} />
            </button>
          </nav>
          <div hidden={tab !== "素材"} className="vs-library">
            <Library
              {...{
                api,
                space,
                update,
                attachPdf,
                versions,
                investigate,
                show,
                adding,
                setAdding,
              }}
            />
          </div>
          <div hidden={tab !== "证据"}>
            {!versions.length &&
              !space.researchAttempts?.some((a) => a.evidenceGap) && (
                <p>调查结果会按问题保存在这里。</p>
              )}
            {space.researchAttempts
              ?.filter((a) => a.evidenceGap)
              .map((a) => (
                <article key={a.id}>
                  <small>证据不足 · 待研究</small>
                  <h3>{a.question}</h3>
                  <p>{a.message}</p>
                  <button
                    onClick={() =>
                      void investigate(
                        a.question,
                        a.origin,
                        versions.find((v) => v.id === a.parent),
                      )
                    }
                  >
                    继续深究
                  </button>
                </article>
              ))}
            {versions.map((v) => (
              <div
                id={"finding-" + v.id}
                tabIndex={-1}
                key={v.id}
                data-selected={selected === v.id}
              >
                <Finding version={v} {...{ handoff, follow }} />
              </div>
            ))}
          </div>
          <div hidden={tab !== "研究对话"}>
            <div className="vs-research-log">
              {versions
                .slice()
                .reverse()
                .map((v) => (
                  <div key={v.id}>
                    <article>
                      <small>你</small>
                      {v.document.space?.origin && (
                        <blockquote>
                          {v.document.space.origin.title} ·{" "}
                          {v.document.space.origin.location}
                          <br />
                          {v.document.space.origin.quote}
                        </blockquote>
                      )}
                      <p>{v.document.question}</p>
                    </article>
                    <article>
                      <small>研究台 AI</small>
                      <p>{v.document.synthesis.judgment.text}</p>
                      <button onClick={() => show(v.id)}>查看证据</button>{" "}
                      <button onClick={() => handoff(v)}>交给创作搭档</button>
                    </article>
                  </div>
                ))}
            </div>
            {space.researchAttempts?.map((a) => (
              <article key={a.id}>
                <strong>{a.question}</strong>
                <p>{a.message}</p>
                <button
                  disabled={researching}
                  onClick={() =>
                    void investigate(
                      a.question,
                      a.origin,
                      versions.find((v) => v.id === a.parent),
                    )
                  }
                >
                  重试调查
                </button>
              </article>
            ))}
            {pending && <blockquote>{pending}</blockquote>}
            {researching && <p role="status">正在检索文献并核查出处…</p>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void investigate(question, undefined, parent);
              }}
            >
              {parent && (
                <small>
                  追问 · {parent.document.question}{" "}
                  <button type="button" onClick={() => selectParent(undefined)}>
                    另起问题
                  </button>
                </small>
              )}
              <textarea
                id="vs-question"
                aria-label="研究问题"
                rows={2}
                maxLength={2000}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="追问这项研究，或比较素材里的说法……"
              />
              <button
                className="vs-primary"
                disabled={!ready || researching || question.trim().length < 3}
              >
                调查
              </button>
            </form>
          </div>
          {researchError && <p role="alert">{researchError}</p>}
        </>,
      )}
      <section
        className="vs-panel vs-script"
        aria-label="脚本编辑器"
        hidden={!!max}
      >
        <Script
          w={writing}
          {...{ space, status, flush, show }}
          openWriter={() => open("partner")}
        />
      </section>
      {panel("partner", <Partner w={writing} {...{ space, show }} />)}
    </div>
  );
}
