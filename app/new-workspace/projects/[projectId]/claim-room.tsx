import { ArrowLeft } from "lucide-react";
import type { ClaimTurn } from "@/lib/video-space/contract";
import type {
  ResearchVersion,
  ResearchEvidence,
} from "@/lib/projects/project-research-contract";
import {
  claimSourceLink,
  findingReferences,
  type ClaimSpace,
  type ResearchAttempt,
} from "@/lib/video-space/claim-spaces";
import { Finding } from "./research";

export function ClaimDirectory({
  rooms,
  selected,
  open,
}: {
  rooms: Map<string, ClaimSpace>;
  selected: string;
  open: (id: string) => void;
}) {
  const groups = new Map<
    string,
    { title: string; kind: string; claims: ClaimSpace[] }
  >();
  for (const claim of rooms.values()) {
    const id = claim.origin?.id ?? "";
    if (!groups.has(id))
      groups.set(id, {
        title: claim.origin?.title ?? "项目观点",
        kind: claim.resource
          ? { video: "YouTube", pdf: "PDF", web: "网页" }[claim.resource.kind]
          : "",
        claims: [],
      });
    groups.get(id)!.claims.push(claim);
  }
  return (
    <>
      <h2>素材与观点</h2>
      {[...groups].map(([id, group]) => (
        <div className="vs-source" key={id}>
          {group.kind && <small>{group.kind}</small>}
          <h3>{group.title}</h3>
          {group.claims.map((claim) => (
            <button
              key={claim.id}
              title={claim.title}
              className="vs-claim-link"
              aria-current={claim.id === selected ? "page" : undefined}
              onClick={() => open(claim.id)}
            >
              <span>{claim.title}</span>
              <span aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

export function ClaimRoomHeader({
  room,
  onBack,
}: {
  room?: ClaimSpace;
  onBack: () => void;
}) {
  const sourceLink = room && claimSourceLink(room);
  return (
    <header className="vs-room-header">
      <small>观点空间</small>
      <button
        type="button"
        className="vs-room-back"
        aria-label="返回项目工作台"
        title="返回项目工作台"
        onClick={onBack}
      >
        <ArrowLeft size={17} aria-hidden="true" />
      </button>
      {room && (
        <h2 id="vs-room-title" tabIndex={-1}>
          {room.title}
        </h2>
      )}
      {room?.origin && (
        <>
          <p className="vs-room-byline">
            {room.origin.title} · {room.origin.location}
          </p>
          <details key={room.id}>
            <summary>查看素材出处</summary>
            <blockquote>{room.origin.quote}</blockquote>
            {sourceLink && (
              <a href={sourceLink} target="_blank" rel="noreferrer">
                {room.origin.location} ↗
              </a>
            )}
            {room.resource?.kind === "pdf" && (
              <p>
                {
                  room.resource.pages.find(
                    (p) => p.label === room.origin?.location,
                  )?.text
                }
              </p>
            )}
          </details>
        </>
      )}
    </header>
  );
}

export function ClaimRoom({
  room,
  selected,
  question,
  setQuestion,
  search,
  busy,
  pending,
  handoff,
  handed,
  select,
  ready,
  discuss,
  turns: chats,
  chatBusy,
  chatStatus,
  chatError,
  target,
  setTarget,
}: {
  room: ClaimSpace;
  selected?: ResearchVersion;
  question: string;
  setQuestion: (q: string) => void;
  search: (q: string, parent?: string, retry?: ResearchAttempt) => void;
  busy: boolean;
  pending?: string;
  handoff: (v: ResearchVersion) => void;
  handed: boolean;
  select: (id: string) => void;
  ready: boolean;
  discuss: (q: string, finding?: ResearchVersion) => void;
  turns: ClaimTurn[];
  chatBusy: boolean;
  chatStatus?: string;
  chatError?: string;
  target?: string;
  setTarget: (id?: string) => void;
}) {
  const latest = room.versions.at(-1);
  const finding = selected ?? latest;
  const parent = room.versions.find((v) => v.id === target) ?? finding;
  const evidence = new Map<
    string,
    { source: ResearchEvidence; quotes: Set<string> }
  >();
  for (const { document: d } of room.versions) {
    const byId = new Map(d.evidence.map((source) => [source.id, source]));
    for (const ref of findingReferences(d)) {
      const source = byId.get(ref.id);
      if (!source) continue;
      const entry = evidence.get(source.id) ?? {
        source,
        quotes: new Set<string>(),
      };
      entry.quotes.add(ref.quote);
      evidence.set(source.id, entry);
    }
  }
  const turns = [
    ...chats.map((chat) => ({
      at: chat.created,
      chat,
      version: undefined,
      attempt: undefined,
    })),
    ...room.versions.map((v) => ({
      at: v.created_at,
      chat: undefined,
      version: v,
      attempt: undefined,
    })),
    ...room.attempts.map((a) => ({
      at: a.created,
      chat: undefined,
      version: undefined,
      attempt: a,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <>
      <section className="vs-room-evidence" aria-label="本观点的证据">
        <div className="vs-row">
          <h3>
            证据 <small>{evidence.size}</small>
          </h3>
          <button
            disabled={busy || !ready}
            onClick={() => search(room.title, latest?.id)}
          >
            查找证据
          </button>
        </div>
        {finding ? (
          <div
            id={"finding-" + finding.id}
            tabIndex={-1}
            data-selected={!!selected}
          >
            <Finding key={finding.id} version={finding} />
          </div>
        ) : (
          <p className="vs-hint">
            {ready ? "这个观点还没有保存的证据。" : "正在读取证据…"}
          </p>
        )}
        {[...evidence.values()].map(({ source, quotes }) => (
          <details key={source.id} className="vs-evidence-source">
            <summary>
              <small>{source.kind === "video" ? "视频原文" : "论文摘要"}</small>{" "}
              {source.title}
            </summary>
            {[...quotes].map((quote) => (
              <blockquote key={quote}>{quote}</blockquote>
            ))}
            <a href={source.url} target="_blank" rel="noreferrer">
              打开来源 ↗
            </a>
          </details>
        ))}
      </section>
      <section aria-label="本观点的讨论">
        <div className="vs-row">
          <h3>围绕这个观点讨论</h3>
          {finding && (
            <button disabled={handed} onClick={() => handoff(finding)}>
              {handed ? "已交给创作搭档" : "交给创作搭档"}
            </button>
          )}
        </div>
        <div className="vs-research-log">
          {turns.map(({ version: v, attempt: a, chat }) =>
            chat ? (
              <div key={chat.id} className="vs-turn">
                <small>你</small>
                <p>{chat.question}</p>
                <small>研究搭档</small>
                <p>{chat.reply}</p>
                {chat.finding && (
                  <button onClick={() => chat.finding && select(chat.finding)}>
                    讨论引用的证据
                  </button>
                )}
              </div>
            ) : v ? (
              <div key={v.id} className="vs-turn">
                <small>你</small>
                <p>{v.document.question}</p>
                <small>研究搭档</small>
                <p>{v.document.synthesis.judgment.text}</p>
                <button onClick={() => select(v.id)}>查看本次证据</button>{" "}
                {v.id !== latest?.id && (
                  <button
                    onClick={() => {
                      setTarget(v.id);
                      document.getElementById("vs-question")?.focus();
                    }}
                  >
                    追问这次判断
                  </button>
                )}
              </div>
            ) : (
              a && (
                <div className="vs-turn" key={a.id}>
                  <strong>{a.question}</strong>
                  <p role="alert">
                    {a.evidenceGap ? "证据不足 · " : ""}
                    {a.message}
                  </p>
                  <button
                    disabled={busy || !ready}
                    onClick={() => search(a.question, a.parent, a)}
                  >
                    重试调查
                  </button>
                </div>
              )
            ),
          )}
        </div>
        {pending && <p role="status">正在核查：{pending}</p>}
        {chatStatus && <p role="status">{chatStatus}</p>}
        {chatError && <p role="alert">{chatError}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            discuss(question, parent);
          }}
        >
          {target && parent?.id !== latest?.id && (
            <small>
              追问 · {parent?.document.question}{" "}
              <button type="button" onClick={() => setTarget(undefined)}>
                取消
              </button>
            </small>
          )}
          <textarea
            id="vs-question"
            aria-label="研究问题"
            placeholder="就这个观点追问…"
            rows={2}
            maxLength={2000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button
            type="button"
            disabled={!ready || busy || question.trim().length < 3}
            onClick={() => search(question, parent?.id)}
          >
            检索这个问题
          </button>{" "}
          <button
            className="vs-primary"
            disabled={!ready || chatBusy || !question.trim()}
          >
            发送
          </button>
        </form>
      </section>
    </>
  );
}
