"use client";
import { useState, type ReactNode } from "react";
import { Check, Clock3, History, SearchCheck, ShieldAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type EvidencePrototypeFixture } from "./evidence-prototype-data";

export function LifecycleState({ fixture, onStart }: { readonly fixture: EvidencePrototypeFixture; readonly onStart: () => void }) {
  if (fixture === "request") {
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-border-subtle bg-surface-raised p-6 text-center sm:p-10">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent-brand/10 text-accent-brand">
          <SearchCheck aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-semibold text-text-primary">Check this Video’s material claims</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-text-secondary">
          Evidence Check is a separate, private review. It examines 8–15 material claims. A visual dependency may be ineligible or excluded; only an eligible Finding can be Unresolved when admitted evidence cannot establish a direction.
        </p>
        <Button className="mt-5" onClick={onStart}>Request Evidence Check</Button>
        <p className="mt-3 text-xs text-text-muted">No score is produced. You can leave after the request starts.</p>
      </section>
    );
  }

  if (fixture === "progress") {
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-border-subtle bg-surface-raised p-6 sm:p-10">
        <div className="flex items-start gap-4" role="status" aria-live="polite">
          <span className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-brand/10 text-accent-brand">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-brand">Evidence Check in progress</p>
            <h2 className="mt-1 text-xl font-semibold text-text-primary">Reviewing evidence</h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">You can leave this page. The Evidence tab will show the durable status when you return.</p>
          </div>
        </div>
        <ol className="mt-6 space-y-3 text-sm">
          <ProgressStep done label="Eligibility confirmed" />
          <ProgressStep done label="Material claims identified" />
          <ProgressStep done label="Waiting for sources" />
          <ProgressStep active label="Reviewing evidence" />
          <ProgressStep label="Preparing report" />
        </ol>
        <Button className="mt-6" variant="outline">Cancel Evidence Check</Button>
      </section>
    );
  }

  if (fixture === "waiting") {
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-border-subtle bg-surface-raised p-6 sm:p-10">
        <div className="flex items-start gap-4" role="status" aria-live="polite">
          <span className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-brand/10 text-accent-brand">
            <Clock3 className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-brand">Evidence Check in progress</p>
            <h2 className="mt-1 text-xl font-semibold text-text-primary">Waiting for sources</h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">This durable stage is saved. You can leave this page and return without restarting the check.</p>
          </div>
        </div>
        <p className="mt-5 rounded-xl border border-border-subtle bg-surface-sunken p-3 text-sm text-text-secondary">No percentage or completion estimate is available. The next named stage is Reviewing evidence.</p>
        <Button className="mt-5" variant="outline">Cancel Evidence Check</Button>
      </section>
    );
  }

  if (fixture === "not-eligible") {
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-border-subtle bg-surface-raised p-6 sm:p-10">
        <ShieldAlert className="size-9 text-accent-warning" aria-hidden />
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-accent-warning">Not eligible · no report</p>
        <h2 className="mt-1 text-xl font-semibold text-text-primary">No report was created</h2>
        <p className="mt-3 text-sm leading-6 text-text-secondary">
          This Video relies on a visual demonstration that the available Transcript cannot faithfully represent. Eligibility was declined, so no Finding or Evidence Relationship exists.
        </p>
      </section>
    );
  }

  if (fixture === "failed") {
    return (
      <UnavailableReportState
        icon={<ShieldAlert aria-hidden />}
        eyebrow="Evidence Check failed · no report"
        title="A technical problem stopped this check"
        description="No Finding or partial report was published. A single-use retry is available for this bounded platform failure."
        action={<Button>Retry Evidence Check</Button>}
      />
    );
  }

  if (fixture === "expired") {
    return (
      <UnavailableReportState
        icon={<Clock3 aria-hidden />}
        eyebrow="Expired · no active assessment"
        title="This dated report can no longer be presented as current evidence"
        description="Its content-free audit shell, reason, dates, and version chain remain. An older report was not promoted in its place."
        action={<Button>Request a new Evidence Check</Button>}
        history="Version 2 · report dated 8 August 2026 · expired 11 August 2026"
      />
    );
  }

  if (fixture === "suppressed") {
    return (
      <UnavailableReportState
        icon={<ShieldAlert aria-hidden />}
        eyebrow="Temporarily suppressed · review pending"
        title="This complete report is temporarily unavailable"
        description="A source-rights concern blocks the entire report while authorized review is pending. No older report replaces it."
        history="Version 2 · display content hidden · action recorded 11 August 2026"
      />
    );
  }

  if (fixture === "withdrawn") {
    return (
      <UnavailableReportState
        icon={<ShieldAlert aria-hidden />}
        eyebrow="Withdrawn · final availability decision"
        title="There is no active Evidence report"
        description="The affected report cannot be displayed. Only a content-free history shell and authorized action record remain."
        history="Version 2 · withdrawn 11 August 2026 · no fallback report"
      />
    );
  }

  if (fixture === "notices") return <PrivateNoticeCenter />;
  if (fixture === "comprehension") return <ComprehensionStudy />;

  return null;
}

const PRIVATE_NOTICES = [
  { id: "completion", label: "Completion", detail: "A partially completed report is ready with 10 of 12 inventory entries examined." },
  { id: "failure", label: "Retryable failure", detail: "No report was published. One bounded Retry authorization is available." },
  { id: "recheck", label: "Recheck due", detail: "The dated 8 August report remains accessible but is not current-status evidence." },
  { id: "correction", label: "Material correction", detail: "Version 2 is current; version 1 is superseded and the before/after change is available." },
  { id: "suppression", label: "Temporary suppression", detail: "The complete report is unavailable while an authorized review is pending." },
  { id: "not-eligible", label: "Not eligible", detail: "No Finding exists; no report was created because the governed eligibility decision did not admit this Video." },
  { id: "restoration", label: "Restoration", detail: "The report display was restored after the authorized availability review completed." },
  { id: "withdrawal", label: "Withdrawal", detail: "The withdrawal is final and no active report can be displayed." },
  { id: "case", label: "Case disposition", detail: "The authorized Case disposition changed the governed availability state without exposing private content in the generic notice." },
] as const;

function PrivateNoticeCenter() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const selected = PRIVATE_NOTICES.find((notice) => notice.id === selectedId);

  return (
    <section className="mx-auto max-w-3xl rounded-3xl border border-border-subtle bg-surface-raised p-5 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-brand">Private in-app notices</p>
      <h2 className="mt-1 text-xl font-semibold text-text-primary">Evidence Check updates</h2>
      <p className="mt-2 text-sm text-text-secondary">The notice list is generic. Private report state appears only after account reauthorization.</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
      {PRIVATE_NOTICES.map((notice, index) => (
          <button
            key={notice.id}
            type="button"
            onClick={() => {
              setSelectedId(notice.id);
              setAuthorized(false);
            }}
            className="rounded-xl border border-border-subtle bg-surface-base p-3 text-left focus-visible:outline-2 focus-visible:outline-state-focus"
          >
            <span className="block text-xs text-text-muted">Private update · 11 August 2026</span>
            <span className="mt-1 block font-semibold text-text-primary">Review private update {index + 1}</span>
          </button>
        ))}
      </div>
      {selected ? (
        <div className="mt-5 rounded-xl border border-accent-brand/30 bg-accent-brand/5 p-4" role="status" aria-live="polite">
          {!authorized ? (
            <>
              <p className="font-semibold text-text-primary">Reauthorization required</p>
              <p className="mt-1 text-sm text-text-secondary">Confirm the invited Learner account before loading private Evidence details.</p>
              <Button className="mt-3" onClick={() => setAuthorized(true)}>Continue as demo learner</Button>
            </>
          ) : (
            <>
              <p className="font-semibold text-text-primary">{selected.label}</p>
              <p className="mt-1 text-sm text-text-secondary">{selected.detail}</p>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

const COMPREHENSION_ANSWERS = {
  scope: "uk-three-year",
  relationship: "conflicts",
  unresolved: "abstains",
  coverage: "ten-plus-two",
  overreliance: "evidence-not-honesty",
  confidence: "not-estimated",
} as const;

function ComprehensionStudy() {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<"pass" | "retry" | null>(null);
  const answer = (key: string, value: string) =>
    setAnswers((current) => ({ ...current, [key]: value }));

  return (
    <section className="mx-auto max-w-3xl rounded-3xl border border-border-subtle bg-surface-raised p-5 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-danger">Seeded-error comprehension task · P-04 fixture</p>
      <h2 className="mt-1 text-xl font-semibold text-text-primary">Correct the Finding without judging the speaker</h2>
      <p className="mt-2 text-sm text-text-secondary">Simulated protocol only · no human participant or launch evidence. The prototype intentionally labels this Finding “Supported by retrieved evidence.” Inspect the exact passage, then answer all six concepts.</p>
      <div className="mt-4 rounded-xl border border-accent-danger/30 bg-accent-danger/5 p-4">
        <p className="font-semibold text-text-primary">Claim: Used electric vehicles retain value better than comparable petrol cars.</p>
        <p className="mt-2 text-sm text-text-secondary">Seeded relationship: Supported by retrieved evidence</p>
        <blockquote className="mt-3 border-l-2 border-accent-danger pl-3 text-sm text-text-primary">“Three-year electric vehicles retained 47% of list price, compared with 55% for petrol vehicles in the matched UK cohort.”</blockquote>
      </div>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const passed = Object.entries(COMPREHENSION_ANSWERS).every(
            ([key, expected]) => answers[key] === expected,
          );
          setResult(passed ? "pass" : "retry");
        }}
      >
        <StudySelect label="1. What is the bounded claim scope?" value={answers.scope} onChange={(value) => answer("scope", value)} options={["Global prices", "UK matched cohort at three years"]} values={["global", "uk-three-year"]} />
        <StudySelect label="2. Which correction does the passage require?" value={answers.relationship} onChange={(value) => answer("relationship", value)} options={["Supported by retrieved evidence", "Conflicts with retrieved evidence"]} values={["supported", "conflicts"]} />
        <StudySelect label="3. What does Unresolved mean?" value={answers.unresolved} onChange={(value) => answer("unresolved", value)} options={["The claim is false", "The system abstains from a directional relationship"]} values={["false", "abstains"]} />
        <StudySelect label="4. What does 10 of 12 Coverage mean?" value={answers.coverage} onChange={(value) => answer("coverage", value)} options={["A score of 83%", "10 complete Findings plus 2 explicit governed exclusions"]} values={["score", "ten-plus-two"]} />
        <StudySelect label="5. What may you conclude about the speaker?" value={answers.overreliance} onChange={(value) => answer("overreliance", value)} options={["The speaker is dishonest", "Only that retrieved evidence conflicts with this bounded claim"]} values={["dishonest", "evidence-not-honesty"]} />
        <StudySelect label="6. What does Confidence: unavailable mean?" value={answers.confidence} onChange={(value) => answer("confidence", value)} options={["The report is probably accurate", "No calibrated confidence estimate is available"]} values={["likely-accurate", "not-estimated"]} />
        <Button type="submit">Evaluate simulated response</Button>
      </form>
      {result ? (
        <div className={cn("mt-5 rounded-xl border p-4 text-sm", result === "pass" ? "border-accent-success/35 bg-accent-success/10 text-text-primary" : "border-accent-warning/35 bg-accent-warning/10 text-text-primary")} role="status" aria-live="polite">
          {result === "pass"
            ? "Simulated protocol pass: six concepts demonstrated — claim scope, relationship meaning, Unresolved, Coverage, confidence unavailability, and evidence limitation; the overreliance check passed. No human participant or launch evidence was produced."
            : "Protocol observation incomplete: revisit the seeded Finding and record which concept was misunderstood."}
        </div>
      ) : null}
    </section>
  );
}

function StudySelect({ label, value, onChange, options, values }: { readonly label: string; readonly value?: string; readonly onChange: (value: string) => void; readonly options: readonly string[]; readonly values: readonly string[] }) {
  return (
    <label className="block text-sm font-semibold text-text-primary">
      {label}
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value)} className="mt-2 block w-full rounded-lg border border-border-default bg-surface-base px-3 py-2 text-sm font-normal text-text-primary focus-visible:outline-2 focus-visible:outline-state-focus" required>
        <option value="" disabled>Select an observation</option>
        {options.map((option, index) => <option key={values[index]} value={values[index]}>{option}</option>)}
      </select>
    </label>
  );
}

function UnavailableReportState({
  icon,
  eyebrow,
  title,
  description,
  action,
  history,
}: {
  readonly icon: ReactNode;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly history?: string;
}) {
  return (
    <section className="mx-auto max-w-2xl rounded-3xl border border-border-subtle bg-surface-raised p-6 sm:p-10">
      <span className="text-accent-warning [&_svg]:size-9">{icon}</span>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-accent-warning">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold text-text-primary">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-text-secondary">{description}</p>
      {history ? (
        <div className="mt-5 rounded-xl border border-border-subtle bg-surface-sunken p-3 text-sm text-text-secondary">
          <p className="font-semibold text-text-primary">Report history shell</p>
          <p className="mt-1">{history}</p>
        </div>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}

function ProgressStep({ done = false, active = false, label }: { readonly done?: boolean; readonly active?: boolean; readonly label: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className={cn("flex size-6 items-center justify-center rounded-full border", done ? "border-accent-success bg-accent-success/10 text-accent-success" : active ? "border-accent-brand bg-accent-brand/10 text-accent-brand" : "border-border-default text-text-muted")}>
        {done ? <Check className="size-3.5" aria-hidden /> : <span className="size-1.5 rounded-full bg-current" />}
      </span>
      <span className={cn("text-text-secondary", active && "font-semibold text-text-primary")}>{label}</span>
    </li>
  );
}

export function HistoryPanel() {
  return (
    <section aria-labelledby="history-title" className="mt-5 rounded-2xl border border-border-subtle bg-surface-raised p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <History className="size-4 text-accent-brand" aria-hidden />
        <h2 id="history-title" className="font-semibold text-text-primary">Report history</h2>
      </div>
      <ol className="mt-4 space-y-3 text-sm">
        <li className="rounded-xl border border-accent-brand/35 bg-accent-brand/5 p-3">
          <p className="font-semibold text-text-primary">Current · version 2</p>
          <p className="mt-1 text-text-secondary">Corrected 10 August 2026 after the cited source published a revision.</p>
          <p className="mt-2 text-text-secondary">After: Conflicts with retrieved evidence — the claim said doubled in every market, while two independent origins reported smaller increases and missing comparable measures.</p>
        </li>
        <li className="rounded-xl border border-border-subtle p-3">
          <p className="font-semibold text-text-primary">Superseded · version 1</p>
          <p className="mt-1 text-text-secondary">Report dated 8 August 2026</p>
          <p className="mt-2 text-text-secondary">Before: Supported by retrieved evidence — based on the earlier source wording.</p>
        </li>
      </ol>
    </section>
  );
}
