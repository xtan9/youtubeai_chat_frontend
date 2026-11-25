"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Quill, { type Range } from "quill";
import type Delta from "quill-delta";
import type Table from "quill/modules/table";
import { Bold, Italic, Underline, Strikethrough, Code, Link, List, ListOrdered, ListChecks, Quote,
  Undo2, Redo2, Ellipsis, IndentIncrease, IndentDecrease, RemoveFormatting } from "lucide-react";
import { DraftTitle, type useWriting } from "@/app/new-workspace/projects/[projectId]/writing";
import { draftContents, editorContents, editorFormats, moveEditorMarkers } from "@/lib/video-space/rich-text";
import "quill/dist/quill.core.css";
import "./rich-editor.css";

type Writer = ReturnType<typeof useWriting>;
type Props = { w: Writer; flush: () => void; status: string; openWriter: () => void; children: ReactNode };

export default function RichEditor({ w, flush, status, openWriter, children }: Props) {
  const t = useTranslations("richEditor"), ui = useTranslations("ui"), intent = useTranslations("intent");
  const canvas = useRef<HTMLDivElement>(null);
  const editor = useRef<Quill | null>(null);
  const latest = useRef(w);
  const model = useRef<ReturnType<typeof draftContents> | null>(null);
  const [formats, setFormats] = useState<Record<string, unknown>>({});
  const [more, setMore] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const label = t("body"), placeholder = intent("writeYourIdeasHere");

  useLayoutEffect(() => { latest.current = w; });
  useLayoutEffect(() => {
    const host = canvas.current!;
    const node = document.createElement("div");
    host.append(node);
    const q = new Quill(node, {
      formats: editorFormats, placeholder,
      modules: { toolbar: false, table: true, history: { userOnly: true }, uploader: { handler() {} } },
    });
    editor.current = q;
    q.root.setAttribute("role", "textbox");
    q.root.setAttribute("aria-multiline", "true");
    q.root.setAttribute("aria-label", label);
    const initial = editorContents(latest.current.draft);
    q.setContents(initial, "silent");
    model.current = draftContents(initial);
    q.history.clear();
    q.keyboard.addBinding({ key: "k", shortKey: true }, range => {
      const address = q.getFormat(range).link;
      setLink(typeof address === "string" ? address : "");
      setInvalid(false);
    });
    function selection(range: Range | null) {
      if (!range || !model.current) return; // Keep the passage when focus moves to the assistant.
      const doc = latest.current.draft;
      const start = model.current.sourceIndex(range.index);
      const end = model.current.sourceIndex(range.index + range.length, true);
      latest.current.setPassage(range.length ? {
        draft: doc.id, title: latest.current.titleFor(doc.id, doc.title), start, text: model.current.text.slice(start, end),
      } : undefined);
      setFormats(q.getFormat(range));
    }
    function change(delta: Delta) {
      const updated = draftContents(q.getContents());
      const markers = moveEditorMarkers(latest.current.draft.markers, model.current!, updated, delta);
      if (latest.current.type(updated.text, updated.formatting, markers)) model.current = updated;
      else {
        const accepted = editorContents(latest.current.draft);
        q.setContents(accepted, "silent");
        model.current = draftContents(accepted);
        q.history.clear();
      }
      const range = q.getSelection();
      if (range) {
        setFormats(q.getFormat(range));
        if (range.length) selection(range);
      }
    }
    q.on("selection-change", selection);
    q.on("text-change", change);
    return () => {
      q.off("selection-change", selection);
      q.off("text-change", change);
      q.disable();
      q.scroll.detach();
      editor.current = null;
      host.replaceChildren();
    };
  }, [label, placeholder]);

  useLayoutEffect(() => {
    const q = editor.current, current = model.current;
    if (!q || !current) return;
    if (w.draft.text === current.text && (w.draft.formatting === current.formatting ||
      (!w.draft.formatting && !current.formatting.length))) return;
    if (w.draft.text === current.text &&
      JSON.stringify(current.formatting) === JSON.stringify(w.draft.formatting ?? [])) return;
    const next = editorContents(w.draft);
    q.setContents(next, "silent");
    model.current = draftContents(next);
    q.history.clear();
    setFormats({});
  }, [w.draft]);

  function format(name: string, value: string | number | boolean) {
    const q = editor.current;
    if (!q) return;
    q.focus();
    q.history.cutoff();
    q.format(name, value, "user");
    q.history.cutoff();
    setFormats(q.getFormat());
  }
  function button(name: string, Icon: typeof Bold, run: () => void, pressed?: boolean) {
    return <button type="button" aria-label={t(name)} title={t(name)} aria-pressed={pressed}
      onMouseDown={e => e.preventDefault()} onClick={run}><Icon size={16} /></button>;
  }
  function toggle(name: string, Icon: typeof Bold, value: string | boolean = true) {
    const active = formats[name] === value;
    return button(typeof value === "string" ? value : name, Icon, () => format(name, active ? false : value), active);
  }
  function select(name: string, options: string[], values: string[] = options) {
    return <select aria-label={t(name)} title={t(name)} value={String(formats[name] || "")}
      onChange={e => format(name, e.target.value || false)}>
      {options.map((key, i) => <option key={key} value={values[i]}>{t(key)}</option>)}
    </select>;
  }
  const size = select("size", ["regular", "small", "large", "huge"], ["", "small", "large", "huge"]);
  const alignment = select("align", ["left", "center", "right", "justify"], ["", "center", "right", "justify"]);

  function applyLink() {
    const url = link?.trim() ?? "";
    if (url && (url.length > 3000 || !URL.canParse(url) ||
      !["https:", "http:", "mailto:", "tel:"].includes(new URL(url).protocol))) {
      setInvalid(true);
      return;
    }
    const q = editor.current!;
    q.focus();
    const range = q.getSelection(true);
    if (url && !range.length && !q.getFormat().link) {
      q.insertText(range.index, url, { link: url }, "user");
      q.setSelection(range.index + url.length, 0);
    } else if (!range.length && q.getFormat().link) {
      const [leaf] = q.getLeaf(range.index);
      const anchor = leaf?.domNode.parentElement?.closest("a");
      const blot = anchor && Quill.find(anchor);
      if (blot && "length" in blot) q.formatText(q.getIndex(blot), blot.length(), "link", url || false, "user");
      else q.format("link", url || false, "user");
    } else q.format("link", url || false, "user");
    setFormats(q.getFormat());
    setLink(null);
  }
  function tableAction(action: string) {
    const q = editor.current!;
    q.focus();
    const table = q.getModule("table") as Table;
    if (action === "insertTable") table.insertTable(2, 2);
    else if (action === "addRow") table.insertRowBelow();
    else if (action === "addColumn") table.insertColumnRight();
    else if (action === "deleteRow") table.deleteRow();
    else if (action === "deleteColumn") table.deleteColumn();
    else if (action === "deleteTable") table.deleteTable();
    setFormats(q.getFormat());
  }
  return <>
    <div className="rich-tools" role="toolbar" aria-label={t("toolbar")}>
      <div className="rich-tool-row">
        {select("header", ["paragraph", "h1", "h2", "h3", "h4", "h5", "h6"], ["", "1", "2", "3", "4", "5", "6"])}
        <span className="rich-wide">{size}</span>
        {toggle("bold", Bold)}{toggle("italic", Italic)}{toggle("underline", Underline)}
        {toggle("list", List, "bullet")}{toggle("list", ListOrdered, "ordered")}
        <span className="rich-wide">{alignment}</span>
        {button("link", Link, () => { setInvalid(false); setLink(typeof formats.link === "string" ? formats.link : ""); }, Boolean(formats.link))}
        {button("undo", Undo2, () => editor.current?.history.undo())}
        {button("redo", Redo2, () => editor.current?.history.redo())}
        <button type="button" aria-label={t("more")} title={t("more")} aria-expanded={more}
          onMouseDown={e => e.preventDefault()} onClick={() => setMore(!more)}>
          <Ellipsis size={16}/><span className="rich-wide">{t("more")}</span>
        </button>
      </div>
      {more && <div className="rich-tool-row extended">
        {select("font", ["defaultFont", "serif", "monospace"], ["", "serif", "monospace"])}
        <span className="rich-narrow">{size}</span>
        <span className="rich-narrow">{alignment}</span>
        {(["color", "background"] as const).map(name => <label key={name} className="rich-color" title={t(name)}>
          <span>{t(name)}</span><input aria-label={t(name)} type="color" value={String(formats[name] || (name === "color" ? "#222222" : "#ffff99"))}
            onChange={e => format(name, e.target.value)} /></label>)}
        {toggle("strike", Strikethrough)}{toggle("blockquote", Quote)}{toggle("code", Code)}
        {button("checklist", ListChecks, () => format("list", ["checked", "unchecked"].includes(String(formats.list)) ? false : "unchecked"),
          ["checked", "unchecked"].includes(String(formats.list)))}
        {button("indentMore", IndentIncrease, () => format("indent", "+1"))}
        {button("indentLess", IndentDecrease, () => format("indent", "-1"))}
        <select aria-label={t("table")} value="" onChange={e => tableAction(e.target.value)}>
          <option value="" disabled>{t("table")}</option>
          {["insertTable", "addRow", "addColumn", "deleteRow", "deleteColumn", "deleteTable"].map(action =>
            <option key={action} value={action} disabled={action === "insertTable" ? Boolean(formats.table) : !formats.table}>{t(action)}</option>)}
        </select>
        {button("clear", RemoveFormatting, () => {
          const q = editor.current!;
          const range = q.getSelection(true);
          if (range.length) q.removeFormat(range.index, range.length, "user");
          else Object.keys(q.getFormat()).forEach(name => q.format(name, false, "user"));
          setFormats(q.getFormat());
        })}
      </div>}
      {link !== null && <form className="rich-link" onSubmit={e => { e.preventDefault(); applyLink(); }}>
        <input autoFocus aria-label={t("linkUrl")} aria-invalid={invalid} placeholder="https://" value={link}
          onKeyDown={e => { if (e.key === "Escape") { setLink(null); editor.current?.focus(); } }}
          onChange={e => { setLink(e.target.value); setInvalid(false); }}/>
        <button type="submit">{t("apply")}</button>
        <button type="button" onClick={() => { setLink(null); editor.current?.focus(); }}>{t("cancel")}</button>
        {invalid && <span role="alert">{t("invalidLink")}</span>}
      </form>}
    </div>
    <div className="paper-body rich-paper">
      <article>
        <DraftTitle w={w} flush={flush}/>
        <div ref={canvas} className="rich-canvas" onBlur={flush}/>
        {children}
      </article>
    </div>
    <footer className="rich-footer">
      <span>{ui("chars", { count: w.draft.text.length })} · <span role="status">{status}</span></span>
      {status !== ui("saved") && status !== ui("saving") && <button onClick={flush}>{ui("saveAgain")}</button>}
      {w.passage && ["discuss", "rewrite"].map(action => <button key={action} onMouseDown={e => e.preventDefault()}
        onClick={() => { w.setPrompt(ui(action === "rewrite" ? "rewritePrompt" : "discussionPrompt")); openWriter(); }}>{ui(action)}</button>)}
    </footer>
  </>;
}
