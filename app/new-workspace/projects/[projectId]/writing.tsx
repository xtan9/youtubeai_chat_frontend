"use client";
import { useRef, useState, type RefObject } from "react";
import { BookOpen, Undo2 } from "lucide-react";
import {
  editDraft,
  type Space,
  type Draft,
  type Message,
  type Passage,
} from "@/lib/video-space/contract";
import type { ResearchVersion } from "@/lib/projects/project-research-contract";
import { requestJson } from "./use-space";

type Suggestion = NonNullable<Message["suggestion"]>;
export function useWriting({
  space,
  live,
  update,
  api,
  versions,
}: {
  space: Space;
  live: RefObject<Space | null>;
  update: (change: (s: Space) => Space) => boolean;
  api: string;
  versions: ResearchVersion[];
}) {
  const [active, setActive] = useState(space.activeDraft ?? space.drafts[0].id),
    [passage, setPassage] = useState<Passage>(),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [undo, setUndo] = useState<{
    before: Draft;
    after: string | undefined;
  }>();
  const draft = space.drafts.find((d) => d.id === active) ?? space.drafts[0];
  function changeDraft(id: string) {
    update((s) => ({ ...s, activeDraft: id }));
    setActive(id);
    setPassage(undefined);
  }
  function type(text: string) {
    setPassage(undefined);
    update((s) => ({
      ...s,
      drafts: s.drafts.map((d) => (d.id === draft.id ? editDraft(d, text) : d)),
    }));
  }
  function append(message: Message) {
    return update((s) => ({ ...s, messages: [...s.messages, message] }));
  }
  function addDraft() {
    const id = crypto.randomUUID();
    const added = update((s) => ({
      ...s,
      drafts: [
        ...s.drafts,
        { id, title: "脚本 " + (s.drafts.length + 1), text: "", markers: [] },
      ],
    }));
    if (added) changeDraft(id);
  }
  function apply(suggestion: Suggestion, text: string, finding?: string) {
    const before = live.current?.drafts.find((d) => d.id === suggestion.draft);
    if (!before || before.version !== suggestion.version) {
      setError("原稿已修改。建议保留在对话中，可以重新请求编辑。");
      return;
    }
    const start = suggestion.start;
    const insert =
      !suggestion.length && start && !before.text.endsWith("\n")
        ? "\n" + text
        : text;
    const after = editDraft(
      before,
      before.text.slice(0, start) +
        insert +
        before.text.slice(start + suggestion.length),
    );
    if (after.text.length > 80000) {
      setError("脚本超过字数上限。");
      return;
    }
    if (finding)
      after.markers.push({
        start: start + insert.length - text.length,
        text,
        finding,
      });
    update((s) => ({
      ...s,
      drafts: s.drafts.map((d) => (d.id === before.id ? after : d)),
    }));
    setUndo({ before, after: after.version });
    setPassage(undefined);
  }
  function revert() {
    if (!undo || draft.version !== undo.after || draft.id !== undo.before.id)
      return;
    update((s) => ({
      ...s,
      drafts: s.drafts.map((d) =>
        d.id === draft.id
          ? { ...undo.before, version: crypto.randomUUID() }
          : d,
      ),
    }));
    setUndo(undefined);
  }
  async function send(
    instruction = prompt,
    specificFinding?: string,
    appendOnly = false,
  ) {
    if (busy || !instruction.trim()) return;
    setBusy(true);
    setError("");
    const prior = live.current!.messages;
    const handed =
      specificFinding ?? prior.findLast((m) => m.role === "handoff")?.finding;
    const finding = versions.find((v) => v.id === handed);
    const selected = passage;
    const msg: Message = { role: "user", text: instruction, passage: selected };
    if (prior.length >= 1999 || !append(msg)) {
      setError("对话已达容量上限。");
      setBusy(false);
      return;
    }
    if (instruction === prompt) setPrompt("");
    try {
      const reply = await requestJson<{
        mode: "edit" | "discuss" | "options";
        reply: string;
        options: string[];
        usedFinding?: boolean;
        target: "append" | "passage" | "whole";
      }>(api + "/space", "POST", {
        action: "write",
        appendOnly,
        prompt: instruction,
        script: draft.text,
        passage: selected,
        history: prior.slice(-16),
        finding: finding
          ? JSON.stringify({
              question: finding.document.question,
              judgment: finding.document.synthesis.judgment,
              assessment: finding.document.synthesis.assessment,
            }).slice(0, 12000)
          : undefined,
      });
      const replace =
        appendOnly || reply.target === "append" ? undefined : selected;
      const whole = !appendOnly && !selected && reply.target === "whole";
      const suggestion: Suggestion = {
        draft: draft.id,
        version: draft.version,
        start: whole ? 0 : (replace?.start ?? draft.text.length),
        length: whole ? draft.text.length : (replace?.text.length ?? 0),
        options: reply.options,
      };
      const source = reply.usedFinding ? handed : undefined;
      const added = append({
        role: "assistant",
        text: reply.reply,
        passage: selected,
        finding: source,
        suggestion: reply.mode === "discuss" ? undefined : suggestion,
      });
      if (added && reply.mode === "edit")
        apply(suggestion, reply.options[0], source);
    } catch (e) {
      setError((e as Error).message);
      setPrompt((p) => p || instruction);
    } finally {
      setBusy(false);
    }
  }
  return {
    draft,
    passage,
    prompt,
    busy,
    error,
    changeDraft,
    type,
    append,
    addDraft,
    apply,
    revert,
    canUndo:
      !!undo && draft.id === undo.before.id && draft.version === undo.after,
    send,
    setPassage,
    setPrompt,
  };
}
type Writer = ReturnType<typeof useWriting>;
export function Script({
  w,
  space,
  status,
  flush,
  show,
  openWriter,
}: {
  w: Writer;
  space: Space;
  status: string;
  flush: () => void;
  show: (id: string) => void;
  openWriter: () => void;
}) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const { draft } = w;
  const pieces: React.ReactNode[] = [];
  let prev = 0;
  for (const m of [...draft.markers].sort((a, b) => a.start - b.start)) {
    pieces.push(
      draft.text.slice(prev, m.start + m.text.length),
      <button
        className="vs-marker"
        key={m.start}
        aria-label={"查看句子来源：" + m.text}
        onClick={() => show(m.finding)}
      >
        <BookOpen size={13} />
      </button>,
    );
    prev = m.start + m.text.length;
  }
  pieces.push(draft.text.slice(prev), "\u200b");
  return (
    <>
      <div className="vs-row">
        <h2>{draft.title}</h2>
        <button disabled={!w.canUndo} onClick={w.revert}>
          <Undo2 size={13} />
          撤销 AI 编辑
        </button>
      </div>
      <div className="vs-manuscript">
        <div className="vs-mirror">{pieces}</div>
        <textarea
          ref={editor}
          aria-label="脚本正文"
          placeholder="写下你想对观众说的第一句话……"
          maxLength={80000}
          value={draft.text}
          onChange={(e) => w.type(e.target.value)}
          onBlur={flush}
          onSelect={(e) => {
            const t = e.currentTarget;
            if (document.activeElement !== t) return;
            w.setPassage(
              t.selectionStart < t.selectionEnd
                ? {
                    draft: draft.id,
                    title: draft.title,
                    start: t.selectionStart,
                    text: t.value.slice(t.selectionStart, t.selectionEnd),
                  }
                : undefined,
            );
          }}
        />
      </div>
      {w.passage && (
        <div className="vs-actions">
          {["讨论", "改写"].map((action) => (
            <button
              key={action}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                openWriter();
                if (!w.prompt.trim())
                  w.setPrompt(
                    action === "改写"
                      ? "请改写选中的这句话。"
                      : "这句话听起来自然吗？",
                  );
              }}
            >
              {action}
            </button>
          ))}
        </div>
      )}
      <div className="vs-row vs-meta">
        <small>
          {draft.text.length} 字 · <span role="status">{status}</span>
        </small>
        {status !== "已保存" && status !== "正在保存…" && (
          <button onClick={flush}>重新保存</button>
        )}
        <div>
          <select
            aria-label="当前脚本"
            value={draft.id}
            onChange={(e) => w.changeDraft(e.target.value)}
          >
            {space.drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <button aria-label="新建脚本" onClick={w.addDraft}>
            ＋
          </button>
        </div>
      </div>
    </>
  );
}
export function Partner({
  w,
  space,
  show,
}: {
  w: Writer;
  space: Space;
  show: (id: string) => void;
}) {
  return (
    <>
      <div className="vs-log" aria-live="polite">
        {!space.messages.length && (
          <small>这期视频，你想从哪个问题讲起？</small>
        )}
        {space.messages.map((m, i) => (
          <article key={i}>
            <small>
              {m.role === "user"
                ? "你"
                : m.role === "handoff"
                  ? "来自研究台"
                  : "创作搭档"}
            </small>
            {m.passage && (
              <blockquote>
                {m.passage.title} · “{m.passage.text}”
              </blockquote>
            )}
            <p>{m.text}</p>
            {m.role === "handoff" && (
              <button
                disabled={w.busy}
                onClick={() =>
                  void w.send("请根据这项调查接着写开场。", m.finding, true)
                }
              >
                写进开场
              </button>
            )}{" "}
            {m.finding && (
              <button onClick={() => show(m.finding!)}>查看依据</button>
            )}
            {m.suggestion?.options.map((option, j) => (
              <div key={j}>
                <p>{option}</p>
                <button
                  disabled={
                    w.draft.id !== m.suggestion!.draft ||
                    w.draft.version !== m.suggestion!.version
                  }
                  onClick={() => w.apply(m.suggestion!, option, m.finding)}
                >
                  采用
                  {m.suggestion!.options.length > 1
                    ? "方案 " + (j + 1)
                    : "此稿"}
                </button>
              </div>
            ))}
          </article>
        ))}
      </div>
      {w.passage && (
        <blockquote>
          {w.passage.title} · “{w.passage.text}”{" "}
          <button onClick={() => w.setPassage(undefined)}>移除引用</button>
        </blockquote>
      )}
      {w.error && <p role="alert">{w.error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void w.send();
        }}
      >
        <textarea
          aria-label="消息"
          rows={2}
          maxLength={4000}
          placeholder="讨论一个角度，或让我接着写……"
          value={w.prompt}
          onChange={(e) => w.setPrompt(e.target.value)}
        />
        <div className="vs-row">
          <button
            type="button"
            disabled={w.busy}
            onClick={() =>
              void w.send("请接着当前脚本续写一段开场。", undefined, true)
            }
          >
            续写开场
          </button>
          <button className="vs-primary" disabled={w.busy || !w.prompt.trim()}>
            {w.busy ? "正在回复…" : "发送"}
          </button>
        </div>
      </form>
    </>
  );
}
