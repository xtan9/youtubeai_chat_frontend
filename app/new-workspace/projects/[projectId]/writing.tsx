"use client";
import { useTranslations } from "next-intl";
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
  const tr = useTranslations("ui");
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
        { id, title: tr("draftTitle", {n: s.drafts.length + 1}), text: "", markers: [] },
      ],
    }));
    if (added) changeDraft(id);
  }
  function apply(suggestion: Suggestion, text: string, finding?: string) {
    const before = live.current?.drafts.find((d) => d.id === suggestion.draft);
    if (!before || before.version !== suggestion.version) {
      setError("theScriptHasChangedRequestAnotherEditFromTheConversation");
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
      setError("scriptLengthLimitReached");
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
      setError("conversationLimitReached");
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
    error: error && tr.has(error) ? tr(error) : error,
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
  const tr = useTranslations("ui");
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
        aria-label={tr("sourceSentence", {text: m.text})}
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
          {tr("undoAiEdit")}
        </button>
      </div>
      <div className="vs-manuscript">
        <div className="vs-mirror">{pieces}</div>
        <textarea
          ref={editor}
          aria-label={tr("scriptText")}
          placeholder={tr("writeYourFirstLineForTheAudience")}
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
          {[tr("discuss"), tr("rewrite")].map((action) => (
            <button
              key={action}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                openWriter();
                if (!w.prompt.trim())
                  w.setPrompt(
                    action === tr("rewrite")
                      ? tr("rewritePrompt")
                      : tr("discussionPrompt"),
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
          {tr("chars", {count: draft.text.length})} · <span role="status">{status}</span>
        </small>
        {status !== tr("saved") && status !== tr("saving") && (
          <button onClick={flush}>{tr("saveAgain")}</button>
        )}
        <div>
          <select
            aria-label={tr("currentScript")}
            value={draft.id}
            onChange={(e) => w.changeDraft(e.target.value)}
          >
            {space.drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
          <button aria-label={tr("newScript")} onClick={w.addDraft}>
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
  const tr = useTranslations("ui");
  return (
    <>
      <div className="vs-log" aria-live="polite">
        {!space.messages.length && (
          <small>{tr("whatQuestionWillOpenThisVideo")}</small>
        )}
        {space.messages.map((m, i) => (
          <article key={i}>
            <small>
              {m.role === "user"
                ? tr("you")
                : m.role === "handoff"
                  ? tr("fromTheResearchDesk")
                  : tr("writingPartner")}
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
                  void w.send(tr("openingPrompt"), m.finding, true)
                }
              >
                {tr("writeIntoOpening")}
              </button>
            )}{" "}
            {m.finding && (
              <button onClick={() => show(m.finding!)}>{tr("viewSources")}</button>
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
                  {m.suggestion!.options.length > 1
                    ? tr("applyOption", {n: j + 1})
                    : tr("applyDraft")}
                </button>
              </div>
            ))}
          </article>
        ))}
      </div>
      {w.passage && (
        <blockquote>
          {w.passage.title} · “{w.passage.text}”{" "}
          <button onClick={() => w.setPassage(undefined)}>{tr("removeQuote")}</button>
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
          aria-label={tr("message")}
          rows={2}
          maxLength={4000}
          placeholder={tr("discussAnAngleOrAskMeToContinue")}
          value={w.prompt}
          onChange={(e) => w.setPrompt(e.target.value)}
        />
        <div className="vs-row">
          <button
            type="button"
            disabled={w.busy}
            onClick={() =>
              void w.send(tr("continuePrompt"), undefined, true)
            }
          >
            {tr("continueOpening")}
          </button>
          <button className="vs-primary" disabled={w.busy || !w.prompt.trim()}>
            {w.busy ? tr("replying") : tr("send")}
          </button>
        </div>
      </form>
    </>
  );
}
