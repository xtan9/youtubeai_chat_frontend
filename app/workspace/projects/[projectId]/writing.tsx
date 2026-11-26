"use client";
import { useTranslations } from "next-intl";
import { useRef, useState, type RefObject } from "react";
import { BookOpen, Undo2 } from "lucide-react";
import {
  defaultDraftTitle,
  editDraft,
  replaceDraftRange,
  intentFormat,
  type Space,
  type Draft,
  type FormatRange,
  type Message,
  type Passage,
} from "@/lib/video-space/contract";
import type { ResearchVersion } from "@/lib/projects/project-research-contract";
import { requestJson } from "./use-space";

type Suggestion = NonNullable<Message["suggestion"]>;
function numberedTitle(n: number) {
  return { title: `Script ${n}`, defaultTitle: n };
}

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
  function titleFor(id: string, title: string) {
    const index = space.drafts.findIndex(d => d.id === id);
    const label = defaultDraftTitle(
      { id, title, defaultTitle: space.drafts[index]?.defaultTitle },
      index,
    );
    if (label === "opening") return tr("openingScript");
    if (typeof label === "number") return tr("draftTitle", { n: label });
    return title;
  }
  function changeDraft(id: string) {
    update((s) => ({ ...s, activeDraft: id }));
    setActive(id);
    setPassage(undefined);
  }
  function rename(title: string) {
    return update((s) => ({
      ...s,
      drafts: s.drafts.map((old, i) => {
        if (old.id !== draft.id) return old;
        if (title.trim()) return { ...old, title, defaultTitle: null, ...(old.outline && old.title !== title ? { version: crypto.randomUUID() } : {}) };
        if (old.id === "opening")
          return { ...old, title: "Opening script", defaultTitle: "opening" };
        return { ...old, ...numberedTitle(i + 1) };
      }),
    }));
  }
  function type(text: string, formatting?: FormatRange[], markers?: Draft["markers"], outline?: Draft["outline"]) {
    if (text.length > 80000) {setError("scriptLengthLimitReached"); return false;}
    setError("");
    setPassage(undefined);
    return update((s) => ({
      ...s,
      drafts: s.drafts.map((d) => {
        if (d.id !== draft.id) return d;
        const next = editDraft(d, text, formatting);
        if (markers) next.markers = markers;
        if (outline) next.outline = outline;
        return next;
      }),
    }));
  }
  function append(message: Message) {
    return update((s) => ({ ...s, messages: [...s.messages, message] }));
  }
  function addDraft() {
    const id = crypto.randomUUID();
    const added = update((s) => ({
      ...s,
      activeDraft: id,
      drafts: [
        ...s.drafts,
        { id, ...numberedTitle(s.drafts.length + 1), text: "", markers: [] },
      ],
    }));
    if (added) {
      setActive(id);
      setPassage(undefined);
    }
    return added;
  }
  function apply(suggestion: Suggestion, text: string, finding?: string) {
    const before = live.current?.drafts.find((d) => d.id === suggestion.draft);
    if (!before || before.version !== suggestion.version) {
      setError("theScriptHasChangedRequestAnotherEditFromTheConversation");
      return;
    }
    const start = suggestion.start;
    const insert =
      !suggestion.length && start && before.text[start - 1] !== "\n"
        ? "\n" + text
        : text;
    const after = replaceDraftRange(
      before,
      before.text.slice(0, start) +
        insert +
        before.text.slice(start + suggestion.length),
      start, start + suggestion.length, start + insert.length,
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
    const { text, markers, formatting, outline } = undo.before;
    update((s) => ({
      ...s,
      drafts: s.drafts.map((d) =>
        d.id === draft.id
          ? { ...d, text, markers, formatting, outline, version: crypto.randomUUID() }
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
        format:draft.outline ? "video" : intentFormat.safeParse(draft.id.split("/")[0]).data ?? space.purpose,
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
    titleFor,
    draft,
    passage,
    prompt,
    busy,
    error: error && tr.has(error) ? tr(error) : error,
    changeDraft,
    rename,
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
export function DraftTitle({ w, flush }: { w: Writer; flush: () => void }) {
  const t = useTranslations("intent");
  const { draft } = w;
  const title = w.titleFor(draft.id, draft.title);
  return (
    <label className="draft-title-field">
      <span>{t("draftTitle")}</span>
      <textarea
        className="doc-title"
        rows={1}
        maxLength={140}
        value={draft.defaultTitle == null ? title : ""}
        placeholder={draft.defaultTitle == null ? t("draftTitle") : title}
        onChange={(e) => w.rename(e.currentTarget.value.replace(/\n/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
        }}
        onBlur={flush}
      />
    </label>
  );
}

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
  const [source, setSource] = useState<Draft["markers"][number]>();
  const pieces: React.ReactNode[] = [];
  let prev = 0;
  for (const m of [...draft.markers].sort((a, b) => a.start - b.start)) {
    pieces.push(
      draft.text.slice(prev, m.start + m.text.length),
      <button
        className="vs-marker"
        key={m.start + "/" + (m.finding ?? m.material?.id)}
        aria-label={tr("sourceSentence", {text: m.text})}
        onClick={() => m.finding ? show(m.finding) : setSource(m)}
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
        <DraftTitle w={w} flush={flush} />
        <button disabled={!w.canUndo} onClick={w.revert}>
          <Undo2 size={13} />
          {tr("undoAiEdit")}
        </button>
      </div>
      {source?.material && draft.markers.includes(source) && (
        <blockquote>{source.material.quote} <cite>{source.material.title} · {source.material.location}</cite></blockquote>
      )}
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
                {w.titleFor(d.id, d.title)}
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
