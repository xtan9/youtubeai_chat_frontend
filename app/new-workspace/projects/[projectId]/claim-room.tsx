import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { normalizePassage } from "@/lib/highlight-translation/contract";
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

export function RoomToolbar({
  title,
  onBack,
  directoryToggle,
  children,
}: {
  title: string;
  onBack: () => void;
  directoryToggle: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="vs-room-toolbar">
      <small>{title}</small>
      {directoryToggle}
      <div className="vs-room-actions">
        {children}
        <button
          type="button"
          aria-label="返回项目工作台"
          title="返回项目工作台"
          onClick={onBack}
        >
          <ArrowLeft size={17} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function ClaimRoomHeader({
  room,
  onParent,
  onBack,
  directoryToggle,
  children,
}: {
  room?: ClaimSpace;
  onParent: () => void;
  onBack: () => void;
  directoryToggle: ReactNode;
  children?: ReactNode;
}) {
  const origin = room?.origin;
  const sourceLink = room && claimSourceLink(room);
  const versions = room?.resource ? undefined : room?.versions;
  const titleVersion = versions?.find(
    ({ document }) =>
      (document.space?.claimTitle ?? document.question) === room?.title,
  );
  const originVersion = versions?.find(
    ({ document }) => document.space?.origin?.quote === origin?.quote,
  );
  const title = normalizePassage(room?.title ?? "");
  const quote = normalizePassage(origin?.quote ?? "");
  const showQuote = quote !== "" && quote !== title;
  const pdfPage =
    origin && room?.resource?.kind === "pdf"
      ? room.resource.pages.find((p) => p.label === origin.location)?.text
      : undefined;
  const pageText = normalizePassage(pdfPage ?? "");
  const showPage = pageText !== "" && pageText !== quote && pageText !== title;

  return (
    <header
      className="vs-room-header vs-claim-header"
      data-translation-section="claim"
    >
      <RoomToolbar
        title="观点空间"
        onBack={onBack}
        directoryToggle={directoryToggle}
      >
        {children}
      </RoomToolbar>
      {room && (
        <div className="vs-claim-card" key={room.id}>
          <h2>{room.resource ? "AI 提炼的观点" : "观点"}</h2>
          <p
            id="vs-room-title"
            className="vs-claim-text"
            tabIndex={-1}
            data-translation-block="0"
            data-translation-version={titleVersion?.id}
          >
            {room.title}
          </p>
          <div className="vs-claim-source">
            <div className="vs-claim-attribution">
              {origin && <small>来源</small>}
              <button
                type="button"
                className="vs-parent-link"
                onClick={onParent}
              >
                {origin?.title ?? "项目观点"}
              </button>
            </div>
            {sourceLink ? (
              <a
                className="vs-claim-location"
                href={sourceLink}
                target="_blank"
                rel="noreferrer"
                aria-label={
                  origin?.location ? `打开素材 · ${origin.location}` : undefined
                }
              >
                {origin?.location || "打开素材"} ↗
              </a>
            ) : origin?.location ? (
              <small className="vs-claim-location">{origin.location}</small>
            ) : null}
          </div>
          {showQuote && (
            <details>
              <summary>查看原文摘录</summary>
              <blockquote
                data-translation-block="0"
                data-translation-version={originVersion?.id}
              >
                {origin?.quote}
              </blockquote>
            </details>
          )}
          {showPage && (
            <details>
              <summary>查看 PDF 页内容</summary>
              <p data-translation-block="0">{pdfPage}</p>
            </details>
          )}
        </div>
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
    { source: ResearchEvidence; versionId: string; quotes: Map<string, string> }
  >();
  for (const { id: versionId, document: d } of room.versions) {
    const byId = new Map(d.evidence.map((source) => [source.id, source]));
    for (const ref of findingReferences(d)) {
      const source = byId.get(ref.id);
      if (!source) continue;
      const entry = evidence.get(source.id) ?? {
        source,
        versionId,
        quotes: new Map<string, string>(),
      };
      entry.quotes.set(ref.quote, versionId);
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
      <section
        className="vs-room-evidence"
        aria-label="本观点的证据"
        data-translation-section="evidence"
      >
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
        {[...evidence.values()].map(({ source, quotes, versionId }) => (
          <details key={source.id} className="vs-evidence-source">
            <summary>
              <small>{source.kind === "video" ? "视频原文" : "论文摘要"}</small>{" "}
              <span
                data-translation-block="0"
                data-translation-version={versionId}
              >
                {source.title}
              </span>
            </summary>
            {[...quotes].map(([quote, quoteVersion]) => (
              <blockquote
                key={quote}
                data-translation-block="0"
                data-translation-version={quoteVersion}
              >
                {quote}
              </blockquote>
            ))}
            <a href={source.url} target="_blank" rel="noreferrer">
              打开来源 ↗
            </a>
          </details>
        ))}
      </section>
      <section
        className="vs-room-discussion"
        aria-label="本观点的讨论"
        data-translation-section="discussion"
      >
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
                <p data-translation-block="0">{chat.question}</p>
                <small>研究搭档</small>
                <p data-translation-block="0">{chat.reply}</p>
                {chat.finding && (
                  <button onClick={() => chat.finding && select(chat.finding)}>
                    讨论引用的证据
                  </button>
                )}
              </div>
            ) : v ? (
              <div
                key={v.id}
                className="vs-turn"
                data-translation-version={v.id}
              >
                <small>你</small>
                <p data-translation-block="0">{v.document.question}</p>
                <small>研究搭档</small>
                <p data-translation-block="0">
                  {v.document.synthesis.judgment.text}
                </p>
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
                <div
                  className="vs-turn"
                  key={a.id}
                  data-translation-version={a.parent}
                >
                  <strong data-translation-block="0">{a.question}</strong>
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
