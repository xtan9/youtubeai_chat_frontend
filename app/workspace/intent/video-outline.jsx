import { useTranslations } from "next-intl";
import { Search, FileText } from "lucide-react";
import { ThinkingDots } from "@/components/ui/thinking-dots";

function EditableHeading({ value, label, disabled, save }) {
  return (
    <input key={value} className="outline-heading" aria-label={label} maxLength={140}
      defaultValue={value} disabled={disabled}
      onKeyDown={e => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
      }}
      onBlur={e => {
        const next = e.currentTarget.value.trim();
        if (next && next !== value) save(next);
        else e.currentTarget.value = value;
      }} />
  );
}

export function VideoOutline({ draft, questions, open, write, rename, busy, writing, error }) {
  const t = useTranslations("intent");
  const byId = new Map(questions.map(q => [q.id, q]));
  return (
    <>
      <h2 className="pane-head"><FileText size={16} />{t("videoOutline")}</h2>
      <article className="paper-body video-outline">
        <EditableHeading value={draft.title} disabled={busy} label={t("outlineTitle")}
          save={title => rename(undefined, title)} />
        {draft.outline.angle && <p>{draft.outline.angle}</p>}
        {draft.outline.sections.map((section, index) => (
          <section key={index} className="outline-section">
            <EditableHeading value={section.heading} disabled={busy} label={t("outlineHeading")}
              save={heading => rename(index, heading)} />
            <ul>
              {section.questionIds.map(id => {
                const q = byId.get(id);
                return q && <li key={id}><button disabled={busy} onClick={() => open(q)}>
                  <Search size={14} /><span>{q.title}{q.startingPoint && <span className="question-lead">{q.startingPoint}</span>}</span>
                  <small>{t(q.gap ? "needsVerification" : q.versionId ? "answerReady" : "toResearch")}</small>
                </button></li>;
              })}
            </ul>
            <button className="link" disabled={busy} onClick={() => write(index)}>{t("writeOutlineSection")}</button>
          </section>
        ))}
        <button className="primary" disabled={busy} onClick={() => write()}>{t("writeVideoScript")}</button>
        {writing && <ThinkingDots label={t("writingYourDraft")} />}
        {error && <p role="alert">{error}</p>}
      </article>
    </>
  );
}
