import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  Search,
  Pencil,
  Plus,
} from "lucide-react";
import { answerId, questionPassages } from "./question-sources";

export function QuestionList({
  questions,
  current,
  runs,
  draft,
  open,
  save,
  remove,
}) {
  const t = useTranslations("intent");
  const [editor, setEditor] = useState(null);
  function form() {
    return (
      <form
        className="q-edit"
        onSubmit={(e) => {
          e.preventDefault();
          const title = editor.title.trim();
          if (title.length < 3) return;
          save(editor.id, title);
          setEditor(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditor(null);
        }}
      >
        <label>
          {t("questionTitle")}{" "}
          <input
            required
            minLength={3}
            maxLength={500}
            autoFocus
            value={editor.title}
            onChange={(e) => setEditor({ ...editor, title: e.target.value })}
          />
        </label>
        <div>
          <button
            className="secondary"
            disabled={editor.title.trim().length < 3}
          >
            {t("save")}{" "}
          </button>
          <button
            type="button"
            className="link"
            onClick={() => setEditor(null)}
          >
            {t("cancel")}{" "}
          </button>
          {editor.id && (
            <button
              type="button"
              className="link q-delete"
              onClick={() => {
                const question = questions.find((q) => q.id === editor.id);
                if (
                  window.confirm(t("deleteNamed", { name: question.title }))
                ) {
                  remove(question);
                  setEditor(null);
                }
              }}
            >
              {t("deleteQuestion")}{" "}
            </button>
          )}
        </div>
      </form>
    );
  }
  return (
    <section className="q-list" aria-label={t("myQuestions")}>
      <div className="side-line">
        <h3>
          {t("myQuestions")} <small>{questions.length}</small>
        </h3>
        <button
          className="mini"
          disabled={questions.length >= 150}
          onClick={() => setEditor({ id: null, title: "" })}
        >
          <Plus size={12} />
          {t("addQuestion")}{" "}
        </button>
      </div>
      {editor && !editor.id && form()}
      {questions.map((q) => {
        if (editor?.id === q.id) return <div key={q.id}>{form()}</div>;
        const run = runs[answerId(q)];
        const written = draft.markers.some((m) => m.finding === answerId(q));
        const status = written
          ? t("inDraft")
          : q.gap
            ? t("needsVerification")
            : run?.question.answer
              ? run.question.relatedOnly
                ? t("relatedFinding")
                : t("answerReady")
              : run
                ? t("needsVerification")
                : t("toResearch");
        return (
          <div key={q.id} className="q-row" data-selected={current === q.id}>
            <button
              className="q-open"
              aria-current={current === q.id ? "page" : undefined}
              onClick={() => open(q)}
              aria-label={q.title}
            >
              <span>{q.title}</span>
              <small>{status}</small>
            </button>
            <button
              className="q-edit-toggle mini"
              title={t("editQuestion")}
              aria-label={t("editNamed", { name: q.title })}
              onClick={() => setEditor({ id: q.id, title: q.title })}
            >
              <Pencil size={12} />
            </button>
          </div>
        );
      })}
      {!questions.length && !editor && (
        <p className="lane-empty">
          {t("addTheFirstQuestionYouWantToInvestigate")}
        </p>
      )}
    </section>
  );
}

export function ResearchSourceList({ sources, open }) {
  return sources.map((s) => (
    <button className="q-source-link" key={s.id} onClick={() => open(s)}>
      <BookOpen size={15} />
      <span>
        {s.title}
        <small>{s.credit}</small>
      </span>
      <ChevronRight size={14} />
    </button>
  ));
}

function OriginalPassage({ source, passage }) {
  const t = useTranslations("intent");
  return (
    <div className="q-passage">
      <blockquote>{passage.quote}</blockquote>
      <p>{passage.note || source.credit}</p>
      <a target="_blank" rel="noreferrer" href={source.url + passage.anchor}>
        {t("openOriginal")} <ArrowUpRight size={13} />
      </a>
    </div>
  );
}

export function ResearchSource({ source, show }) {
  const t = useTranslations("intent");
  return (
    <>
      <h2>{source.title}</h2>
      <p className="q-credit">{source.credit}</p>
      {source.passages.map((p) => (
        <section key={p.id} className="q-original">
          <h3>{p.label}</h3>
          <OriginalPassage source={source} passage={p} />
          {p.uses?.length > 0 && (
            <p className="q-credit">{t("questionsCitingThisPassage")}</p>
          )}
          {p.uses?.map((use) => (
            <button
              key={use.id}
              className="q-backlink"
              onClick={() => show(use.id, p.id)}
            >
              {use.title} <ChevronRight size={13} />
            </button>
          ))}
        </section>
      ))}
    </>
  );
}

export function QuestionSheet({
  question,
  hypothesis,
  onHypothesisChange,
  archived,
  run,
  materials,
  draft,
  excerpt,
  research,
  busy,
  error,
  write,
  back,
  written,
  targets,
  section,
}) {
  const t = useTranslations("intent");
  const refs = run ? questionPassages(run.question) : [];
  const [opened, setOpened] = useState(
    excerpt || run?.focus || refs[0]?.passage.id,
  );
  const defaultTarget =
    targets.find((t) => t.value === section) ?? targets.at(-1);
  const [target, setTarget] = useState(defaultTarget.value);
  const body = useRef(null);
  async function start() {
    await research();
    if (body.current) body.current.scrollTop = 0;
  }
  function reveal(id) {
    setOpened(id);
    requestAnimationFrame(() =>
      body.current
        ?.querySelector('[data-passage="' + id + '"]')
        ?.scrollIntoView({ block: "nearest" }),
    );
  }
  return (
    <>
      <div className="pane-head">
        <BookOpen size={16} />
        <span>
          {archived ? t("citedResearchVersion") : t("questionResearch")}
        </span>
        <button className="meta mode-link" onClick={back}>
          <ArrowLeft size={12} /> {t("backToDraft")}{" "}
        </button>
      </div>
      <article className="paper-body q-sheet" ref={body}>
        <h2 className="doc-title">{question.title}</h2>
        {!archived && (
          <label className="q-hypothesis">
            {t("myHypothesis")} <small>{t("optional")}</small>
            <textarea
              maxLength={1000}
              rows={2}
              value={hypothesis}
              placeholder={t("writeAnIdeaYouWouldLikeToCheck")}
              onChange={(event) => onHypothesisChange(event.target.value)}
            />
          </label>
        )}
        {!run && (
          <div className="q-start">
            <p>
              {t(
                "theAssistantWillResearchThisQuestionAndShowItsAnswerAndSources",
              )}
            </p>
            <button
              className="primary q-action"
              disabled={busy}
              onClick={start}
            >
              <Search size={15} />
              {t("researchWithAI")}{" "}
            </button>
          </div>
        )}
        {run && !run.question.answer && (
          <p role="status" className="q-gap">
            {t("needsVerification") +
              " " +
              (run.question.gap ||
                t("noEvidenceDirectlyAnswersThisQuestionYet"))}
          </p>
        )}
        {run?.question.answer && (
          <section className="q-answer">
            <h3>
              {run.question.relatedOnly
                ? t("relatedResearch")
                : t("researchAnswer")}
            </h3>
            <p>{run.question.answer}</p>
            <div className="q-cites">
              {refs.map(({ passage }, i) => (
                <button
                  key={passage.id}
                  onClick={() => reveal(passage.id)}
                  aria-label={
                    t("viewCitation") + " " + (i + 1) + " " + passage.label
                  }
                >
                  [{i + 1}] {passage.label.split(" · ")[0]}
                </button>
              ))}
            </div>
            {archived ? null : written ? (
              <button className="secondary q-action" onClick={back}>
                <Check size={14} />
                {t("viewAnswerInDraft")}{" "}
              </button>
            ) : (
              <div className="q-insert">
                <label>
                  {t("insertAt")}{" "}
                  <select
                    aria-label={t("insertAt")}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    {targets.map((t) => (
                      <option value={t.value} key={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary q-action"
                  title={draft.title}
                  onClick={() => write(target)}
                >
                  <FileText size={14} />
                  {t("insertAnswerWithCitations")}{" "}
                </button>
              </div>
            )}
          </section>
        )}
        {refs.length > 0 && (
          <section className="q-results">
            <h3>
              {t("sourcesCitedInThisAnswer")}{" "}
              <small>
                {new Set(refs.map((r) => r.source.id)).size} {t("sources")}{" "}
                {refs.length} {t("excerpts")}{" "}
              </small>
            </h3>
            {refs.map(({ source, passage }, i) => (
              <div
                key={passage.id}
                data-passage={passage.id}
                className="q-result"
              >
                <button
                  aria-expanded={opened === passage.id}
                  onClick={() =>
                    setOpened(opened === passage.id ? "" : passage.id)
                  }
                >
                  <span className="q-ref-index">[{i + 1}]</span>
                  <span>
                    <strong>{source.title}</strong>
                    <small>{passage.label}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
                {opened === passage.id && (
                  <OriginalPassage source={source} passage={passage} />
                )}
              </div>
            ))}
          </section>
        )}
        {(run ? run.context : materials).length > 0 && (
          <details className="q-context">
            <summary>
              {run
                ? t("backgroundSuppliedForThisResearch")
                : t("backgroundForTheAssistant")}{" "}
              · {(run ? run.context : materials).length} {t("items")}{" "}
            </summary>
            {(run ? run.context : materials).map((m, i) => (
              <div key={i}>
                <strong>{m.title}</strong>
                <p>
                  {(
                    m.excerpt ||
                    m.pages?.[0]?.text ||
                    m.digest?.summary ||
                    ""
                  ).slice(0, 180)}
                </p>
              </div>
            ))}
          </details>
        )}
        {run && !archived && (
          <button className="link" disabled={busy} onClick={start}>
            {t("researchAgain")}{" "}
          </button>
        )}
        {busy && <p role="status">{t("searchingAndCheckingSources")}</p>}
        {error && <p role="alert">{error}</p>}
      </article>
    </>
  );
}
