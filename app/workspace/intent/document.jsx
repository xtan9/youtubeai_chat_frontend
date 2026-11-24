import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef } from "react";
import { BookOpen, Undo2 } from "lucide-react";
import { Script } from "@/app/new-workspace/projects/[projectId]/writing";
import { InkIcon } from "./ink-icon";
import { getFormats, questionPassages } from "./question-sources";
function Editable({ as: Tag = "p", value, label, onEdit, className }) {
  const t = useTranslations("intent");
  const element = useRef(null);
  useLayoutEffect(() => {
    if (element.current.innerText !== value)
      element.current.textContent = value;
  }, [value]);
  return (
    <Tag
      ref={element}
      className={"editable " + (className || "")}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      data-placeholder={t("writeYourIdeasHere")}
      onInput={(e) => {
        if (onEdit(e.currentTarget.innerText) === false)
          e.currentTarget.textContent = value;
      }}
    />
  );
}
export function paragraphRanges(text) {
  let start = 0;
  return text.split(/\n\n(?=## )/).map((chunk) => {
    const range = { chunk, start };
    start += chunk.length + 2;
    return range;
  });
}

export function Document({
  w,
  status,
  flush,
  space,
  update,
  show,
  full,
  onFull,
  openWriter,
  onAngle,
  rooms,
  onResearch,
  openQuestion,
  projectQuestions,
  runs,
}) {
  const t = useTranslations("intent");
  const formats = getFormats(t);
  const d = w.draft,
    kind = formats[d.id.split("/")[0]],
    chunks = paragraphRanges(d.text);
  const rename = (title) =>
    !!title.trim() &&
    title.length <= 140 &&
    update((s) => ({
      ...s,
      drafts: s.drafts.map((old) =>
        old.id === d.id
          ? {
              ...old,
              defaultTitle: undefined,
              title,
            }
          : old,
      ),
    }));
  const patch = (start, old, text) =>
    w.type(d.text.slice(0, start) + text + d.text.slice(start + old.length));
  const markers = (start, end) => {
    const sectionMarkers = d.markers.filter(
      (m) => m.start + m.text.length > start && m.start + m.text.length <= end,
    );
    return sectionMarkers.map((m) => {
      const q = runs[m.finding]?.question;
      if (q)
        return (
          <div
            className="q-draft-cites"
            key={m.start}
            data-answer-id={m.finding}
            tabIndex={-1}
          >
            <BookOpen size={13} />
            <span>
              {sectionMarkers.length > 1
                ? q.title + " " + t("citationLabel")
                : t("citationLabel")}
            </span>
            {questionPassages(q).map(({ source, passage }, i) => (
              <button
                key={passage.id}
                onClick={() => show(m.finding, passage.id)}
                title={source.title + " · " + passage.label}
              >
                [{i + 1}] {source.title} · {passage.label.split(" · ")[0]}
              </button>
            ))}
          </div>
        );
      return (
        <button
          type="button"
          key={m.start}
          className="ref-mark"
          onClick={() => show(m.finding)}
          title={m.text}
        >
          <BookOpen size={13} /> {t("viewSentenceSource")}{" "}
        </button>
      );
    });
  };
  return (
    <>
      <div className="pane-head">
        <InkIcon name="page" />
        <span>{kind?.kind || t("draft")}</span>
        <div className="head-end meta">
          {!full && w.canUndo && (
            <button className="mini" onClick={w.revert}>
              <Undo2 size={13} />
              {t("undo")}{" "}
            </button>
          )}
          <button
            className="mode-link"
            aria-label={full ? t("sectionEditor") : t("fullTextEditor")}
            title={
              full
                ? t("sectionEditor")
                : t("editTheFullTextAndSelectAPassageToDiscussOrRewrite")
            }
            onClick={() => onFull(!full)}
          >
            {full ? t("sectionEditor") : t("editFullText")}
          </button>
        </div>
      </div>
      {w.error && <p role="alert">{w.error}</p>}
      {full ? (
        <div className="native vs native-script">
          <Script
            w={w}
            space={space}
            show={show}
            flush={flush}
            status={status}
            openWriter={openWriter}
          />
        </div>
      ) : (
        <div className="paper-body">
          <article className={kind?.style}>
            <Editable
              as="h2"
              className="doc-title"
              value={w.titleFor(d.id, d.title)}
              label={t("draftTitle")}
              onEdit={rename}
            />
            {chunks.map(({ chunk, start }, i) => {
              if (!chunk.startsWith("## "))
                return (
                  <div key={i}>
                    <Editable
                      className="doc-lead"
                      value={chunk}
                      label={t("introduction")}
                      onEdit={(t) => patch(start, chunk, t)}
                    />
                    {markers(start, start + chunk.length)}
                  </div>
                );
              const newline = chunk.indexOf("\n"),
                heading = chunk.slice(3, newline === -1 ? undefined : newline);
              const body = newline === -1 ? "" : chunk.slice(newline + 1);
              const stamp =
                kind?.style === "script" && /^\d{2}:\d{2}　/.test(heading)
                  ? heading.slice(0, 5)
                  : "";
              const sectionTitle = stamp ? heading.slice(6) : heading;
              return (
                <section className="block" key={i}>
                  <h3>
                    {stamp && <span className="stamp">{stamp}</span>}
                    <Editable
                      as="span"
                      value={sectionTitle}
                      label={t("sectionHeading")}
                      onEdit={(t) =>
                        patch(start + 3 + (stamp ? 6 : 0), sectionTitle, t)
                      }
                    />
                  </h3>
                  <Editable
                    value={body}
                    label={t("sectionText") + " " + heading}
                    onEdit={(t) =>
                      newline === -1
                        ? patch(start, chunk, chunk + "\n" + t)
                        : patch(start + newline + 1, body, t)
                    }
                  />
                  {markers(start, start + chunk.length)}
                  {i === Math.min(3, chunks.length - 1) &&
                    (rooms.length > 0 || projectQuestions.length > 0) &&
                    !d.id.startsWith("explore/") && (
                      <details className="source-picker">
                        <summary
                          aria-label={t("findEvidenceForThisSection")}
                          title={t("findEvidenceForThisSection")}
                        >
                          <span className="source-word">
                            {t("findEvidenceForThisSection")}
                          </span>
                          <span className="source-icon">
                            <InkIcon name="book" />
                          </span>
                        </summary>
                        {projectQuestions.map((q) => (
                          <button
                            key={q.id}
                            className="file"
                            onClick={() => openQuestion(q, String(start))}
                          >
                            <BookOpen size={14} />
                            <span>
                              {q.title}
                              <small>{t("researchQuestion")}</small>
                            </span>
                          </button>
                        ))}
                        {rooms.map((r) => (
                          <button
                            key={r.id}
                            className="file"
                            onClick={() =>
                              onResearch(r.id, {
                                draft: d.id,
                                version: d.version,
                                start: start + chunk.length,
                                heading,
                              })
                            }
                          >
                            <BookOpen size={14} />
                            <span>
                              {r.title}
                              <small>
                                {r.origin?.title || t("projectClaims")}
                              </small>
                            </span>
                          </button>
                        ))}
                      </details>
                    )}
                  {d.id.startsWith("explore/") && (
                    <button className="link" onClick={() => onAngle(heading)}>
                      {t("exploreThisAngle")}{" "}
                    </button>
                  )}
                </section>
              );
            })}
          </article>
        </div>
      )}
    </>
  );
}
