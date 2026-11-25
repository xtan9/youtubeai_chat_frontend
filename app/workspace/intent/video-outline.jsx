import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Search, Pencil } from "lucide-react";
import { ThinkingDots } from "@/components/ui/thinking-dots";
import { maxOutlineSections } from "@/lib/video-space/contract";

function editCopy(section) {
  return {
    ...section,
    id: section.id || crypto.randomUUID(),
    note: section.note || "",
  };
}

export function VideoOutline({
  draft,
  questions,
  open,
  write,
  save,
  flush,
  status,
  busy,
  writing,
  pending,
  error,
  jump,
  startSection,
}) {
  const t = useTranslations("intent"),
    ui = useTranslations("ui");
  const [expanded, setExpanded] = useState(true);
  const [form, setForm] = useState(null),
    [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const outline = draft.outline;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const nextQuestion = outline?.sections
    .flatMap((s) => s.questionIds)
    .map((id) => byId.get(id))
    .find((q) => q && !q.versionId && !q.gap);
  function begin() {
    setProblem("");
    setExpanded(true);
    setForm({
      title: draft.title,
      angle: outline?.angle || "",
      version: draft.version,
      interviewId: outline?.interviewId || crypto.randomUUID(),
      sections: outline
        ? outline.sections.map(editCopy)
        : [editCopy({ heading: "", questionIds: [] })],
      removed: (outline?.removed || []).map(editCopy),
    });
  }
  function field(id, key, value) {
    setForm((old) => ({
      ...old,
      sections: old.sections.map((s) =>
        s.id === id ? { ...s, [key]: value } : s,
      ),
    }));
  }
  function move(i, dir) {
    setForm((old) => {
      const sections = [...old.sections];
      [sections[i], sections[i + dir]] = [sections[i + dir], sections[i]];
      return { ...old, sections };
    });
  }
  function remove(section) {
    setForm((old) => ({
      ...old,
      sections: old.sections.filter((s) => s.id !== section.id),
      removed:
        section.bodyStart === undefined
          ? old.removed
          : [...old.removed, section],
    }));
  }
  async function submit(e) {
    e.preventDefault();
    if (saving) return;
    if (!form.title.trim() || form.sections.some((s) => !s.heading.trim())) {
      setProblem(t("outlineNeedsTitle"));
      return;
    }
    setSaving(true);
    setProblem("");
    try {
      if (!form.applied) {
        const failure = save(form);
        if (failure) {
          setProblem(ui(failure));
          return;
        }
        setForm((old) => ({ ...old, applied: true }));
      }
      if (await flush()) setForm(null);
      else setProblem(ui("retrySave"));
    } finally {
      setSaving(false);
    }
  }
  if (!outline && !form)
    return (
      <button
        type="button"
        className="outline-create secondary"
        disabled={busy}
        onClick={begin}
      >
        <Pencil size={14} />
        {t("manualOutline")}
      </button>
    );
  return (
    <section
      className="video-outline manuscript-outline"
      aria-label={t("videoOutline")}
    >
      <header className="outline-bar">
        <button
          type="button"
          disabled={!!form}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          {t("videoOutline")}
        </button>
        {!form && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={begin}
          >
            <Pencil size={13} />
            {t("editOutline")}
          </button>
        )}
      </header>
      {form ? (
        <form onSubmit={submit}>
          <fieldset disabled={saving || form.applied || busy}>
            <label>
              {t("outlineTitle")}
              <input
                required
                maxLength={140}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label>
              {t("outlineAngle")}
              <textarea
                maxLength={280}
                rows={2}
                value={form.angle}
                onChange={(e) => setForm({ ...form, angle: e.target.value })}
              />
            </label>
            {form.sections.map((s, i) => (
              <section className="outline-edit-row" key={s.id}>
                <div className="outline-tools">
                  <b>{t("outlineBeat", { n: i + 1 })}</b>
                  <button
                    type="button"
                    disabled={!i}
                    onClick={() => move(i, -1)}
                  >
                    {t("outlineUp")}
                  </button>
                  <button
                    type="button"
                    disabled={i + 1 === form.sections.length}
                    onClick={() => move(i, 1)}
                  >
                    {t("outlineDown")}
                  </button>
                  <button type="button" onClick={() => remove(s)}>
                    {t("outlineRemove")}
                  </button>
                </div>
                <label>
                  {t("outlineHeading")}
                  <input
                    required
                    maxLength={140}
                    value={s.heading}
                    onChange={(e) => field(s.id, "heading", e.target.value)}
                  />
                </label>
                <label>
                  {t("outlineNote")}
                  <textarea
                    rows={2}
                    maxLength={600}
                    value={s.note}
                    onChange={(e) => field(s.id, "note", e.target.value)}
                  />
                </label>
              </section>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={form.sections.length >= maxOutlineSections}
              onClick={() =>
                setForm({
                  ...form,
                  sections: [
                    ...form.sections,
                    editCopy({ heading: "", questionIds: [] }),
                  ],
                })
              }
            >
              {t("addSection")}
            </button>
            {form.removed.map((s) => (
              <div key={s.id} className="outline-removed">
                {s.heading}
                <button
                  type="button"
                  className="link"
                  disabled={form.sections.length >= maxOutlineSections}
                  onClick={() =>
                    setForm({
                      ...form,
                      sections: [...form.sections, s],
                      removed: form.removed.filter((r) => r.id !== s.id),
                    })
                  }
                >
                  {t("restoreOutlineBeat")}
                </button>
              </div>
            ))}
          </fieldset>
          <div className="outline-actions">
            <button type="submit" className="primary" disabled={saving || busy}>
              {t("saveOutline")}
            </button>
            {!form.applied && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setForm(null);
                  setProblem("");
                }}
              >
                {t("cancel")}
              </button>
            )}
          </div>
          {problem && (
            <p role="alert">
              {problem} {form.applied && status}
            </p>
          )}
        </form>
      ) : (
        expanded && (
          <>
            <input
              className="outline-heading"
              aria-label={t("outlineTitle")}
              value={draft.title}
              readOnly
            />
            {outline.angle && <p>{outline.angle}</p>}
            {outline.sections.map((s, i) => (
              <section key={s.id ?? i} className="outline-section">
                <input
                  className="outline-heading"
                  aria-label={t("outlineHeading")}
                  value={s.heading}
                  readOnly
                />
                {s.note && <p>{s.note}</p>}
                <ul>
                  {s.questionIds.map((id) => {
                    const q = byId.get(id);
                    return (
                      q && (
                        <li key={id}>
                          <button onClick={() => open(q)}>
                            <Search size={14} />
                            <span>
                              {q.title}
                              {q.startingPoint && (
                                <span className="question-lead">
                                  {q.startingPoint}
                                </span>
                              )}
                            </span>
                            <small>
                              {t(
                                q.id === pending
                                  ? "researchingQuestion"
                                  : q.gap
                                    ? "needsVerification"
                                    : q.versionId
                                      ? "answerReady"
                                      : "toResearch",
                              )}
                            </small>
                          </button>
                        </li>
                      )
                    );
                  })}
                </ul>
                {s.bodyStart !== undefined ? (
                  <button className="link" onClick={() => jump(s.bodyStart)}>
                    {t("goToBody")}
                  </button>
                ) : (
                  <div className="outline-actions">
                    <button
                      className="link"
                      disabled={busy}
                      onClick={() => write(i)}
                    >
                      {t("writeOutlineSection")}
                    </button>
                    <button
                      className="link"
                      disabled={busy}
                      onClick={() => startSection(i)}
                    >
                      {t("handwriteSection")}
                    </button>
                  </div>
                )}
              </section>
            ))}
            {outline.removed?.map((s, i) => (
              <div className="outline-removed" key={s.id ?? i}>
                <span>
                  {t("removedFromOutline")} · {s.heading}
                </span>
                <button className="link" onClick={() => jump(s.bodyStart)}>
                  {t("goToBody")}
                </button>
              </div>
            ))}
            <div className="outline-actions">
              {nextQuestion && (
                <button
                  className="secondary"
                  onClick={() => open(nextQuestion)}
                >
                  {t("investigateNextQuestion")}
                </button>
              )}
              {!!outline.sections.length && !draft.text.trim() && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => write()}
                >
                  {t("writeVideoScript")}
                </button>
              )}
              {!!draft.text.trim() && (
                <button
                  className="secondary"
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([draft.title + "\n\n" + draft.text], {
                        type: "text/plain;charset=utf-8",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = draft.title + ".txt";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  {t("exportBody")}
                </button>
              )}
            </div>
          </>
        )
      )}
      {writing && <ThinkingDots label={t("writingYourDraft")} />}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
