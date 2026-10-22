"use client";
import {
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { BookOpenText, FileClock, MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  VARIANTS,
  type EvidencePrototypeVariant,
  FIXTURES,
  type EvidencePrototypeFixture,
  type EvidenceClaim,
  CLAIMS,
  VARIANT_LABELS,
  FIXTURE_LABELS,
} from "./evidence-prototype-data";
import {
  ClaimDesk,
  CoverageLedger,
  GuidedDossier,
  type ReportLayoutProps,
} from "./evidence-prototype-report";
import { LifecycleState, HistoryPanel } from "./evidence-prototype-lifecycle";

interface EvidenceWorkspacePrototypeProps {
  readonly initialVariant?: EvidencePrototypeVariant;
  readonly initialFixture?: EvidencePrototypeFixture;
}

export function EvidenceWorkspacePrototype({
  initialVariant = "claim-desk",
  initialFixture = "report",
}: EvidenceWorkspacePrototypeProps) {
  const [variant, setVariant] = useState<EvidencePrototypeVariant>(initialVariant);
  const [fixture, setFixture] = useState<EvidencePrototypeFixture>(initialFixture);
  const [selected, setSelected] = useState<EvidenceClaim>(CLAIMS[0]);
  const [recheckRunning, setRecheckRunning] = useState(false);

  const replacePrototypeQuery = useCallback((key: string, value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const selectVariant = useCallback(
    (next: EvidencePrototypeVariant) => {
      setVariant(next);
      replacePrototypeQuery("variant", next);
    },
    [replacePrototypeQuery],
  );

  const selectFixture = useCallback(
    (next: EvidencePrototypeFixture) => {
      setFixture(next);
      setRecheckRunning(false);
      replacePrototypeQuery("fixture", next);
    },
    [replacePrototypeQuery],
  );

  const handlePrototypeKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.defaultPrevented || event.target !== event.currentTarget) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const currentIndex = VARIANTS.indexOf(variant);
    selectVariant(
      VARIANTS[
        (currentIndex + direction + VARIANTS.length) % VARIANTS.length
      ] ?? VARIANTS[0],
    );
  };

  const reportLayout = useMemo(() => {
    const props: ReportLayoutProps = { selected, onSelect: setSelected };
    if (variant === "coverage-ledger") return <CoverageLedger {...props} />;
    if (variant === "guided-dossier") return <GuidedDossier {...props} />;
    return <ClaimDesk {...props} />;
  }, [selected, variant]);

  const reportVisible = fixture === "report" || fixture === "recheck" || fixture === "corrected";

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-surface-base pb-28 text-text-primary">
      <div
        className="mx-auto max-w-page px-4 py-5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-state-focus sm:py-8"
        role="region"
        aria-label="Evidence prototype canvas. Focus here, then use Left and Right Arrow keys to compare layouts."
        tabIndex={0}
        onKeyDown={handlePrototypeKeyDown}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-raised px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-brand">Single Video workspace</p>
            <p className="truncate text-sm font-semibold text-text-primary">What actually makes an electric car sustainable?</p>
          </div>
          <span className="rounded-full border border-border-default px-2.5 py-1 text-xs text-text-secondary">Fixture data · private</span>
        </div>

        <Tabs defaultValue="evidence" className="gap-4">
          <div className="sticky top-0 z-30 -mx-4 bg-surface-base/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0">
            <TabsList className="grid h-auto w-full grid-cols-4 md:w-fit">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="summary"><PrototypePeerPanel icon={<BookOpenText />} title="Summary" /></TabsContent>
          <TabsContent value="transcript"><PrototypePeerPanel icon={<FileClock />} title="Transcript" /></TabsContent>
          <TabsContent value="chat"><PrototypePeerPanel icon={<MessageSquareText />} title="Chat" /></TabsContent>
          <TabsContent value="evidence">
            <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-brand">Opt-in · asynchronous</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">Evidence Check</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">A claim-by-claim view of what retrieved evidence supports, qualifies, conflicts with, or cannot resolve.</p>
              </div>
              {fixture === "recheck" ? (
                <div className="text-right">
                  <span className="inline-flex rounded-full border border-accent-warning/35 bg-accent-warning/10 px-2.5 py-1 text-xs font-semibold text-accent-warning">Recheck due</span>
                  <p className="mt-1 text-xs text-text-muted">Report dated 8 August 2026</p>
                </div>
              ) : null}
            </header>

            {fixture === "recheck" ? (
              <div className="mb-4 rounded-xl border border-accent-warning/35 bg-accent-warning/5 p-4">
                {recheckRunning ? (
                  <div className="flex flex-wrap items-center justify-between gap-3" role="status" aria-live="polite">
                    <div><p className="font-semibold text-text-primary">Reviewing evidence</p><p className="text-sm text-text-secondary">The dated report remains visible while this recheck runs.</p></div>
                    <Button variant="outline" onClick={() => setRecheckRunning(false)}>Cancel recheck</Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><p className="font-semibold text-text-primary">Sources or material dependencies may have changed.</p><p className="text-sm text-text-secondary">The prior report is still available and clearly dated.</p></div>
                    <Button onClick={() => setRecheckRunning(true)}>Request recheck</Button>
                  </div>
                )}
              </div>
            ) : null}

            {reportVisible ? reportLayout : <LifecycleState fixture={fixture} onStart={() => selectFixture("progress")} />}
            {fixture === "corrected" ? <HistoryPanel /> : null}
          </TabsContent>
        </Tabs>
      </div>

      <section
        aria-label="Prototype controls"
        className="fixed inset-x-2 bottom-2 z-50 mx-auto flex max-w-3xl flex-col gap-2 overflow-hidden rounded-2xl border border-border-default bg-surface-inverse px-2 py-2 text-text-inverse shadow-2xl sm:inset-x-6 sm:bottom-3 sm:flex-row sm:items-center sm:justify-between sm:px-3 sm:py-3"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[0.68rem] font-bold uppercase tracking-[0.16em] opacity-70">Prototype</span>
          <div className="flex min-w-0 gap-1" aria-label="Layout variant">
            {VARIANTS.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={variant === item}
                onClick={() => selectVariant(item)}
                aria-label={VARIANT_LABELS[item]}
                className="min-w-8 rounded-lg px-2 py-1 text-xs font-semibold opacity-65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white aria-pressed:bg-white/15 aria-pressed:opacity-100 sm:min-w-0"
              >
                <span aria-hidden className="sm:hidden">{VARIANT_LABELS[item].slice(0, 1)}</span>
                <span aria-hidden className="hidden sm:inline">{VARIANT_LABELS[item]}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold">
          <span className="shrink-0 opacity-70">Fixture state</span>
          <select
            value={fixture}
            onChange={(event) => {
              selectFixture(event.target.value as EvidencePrototypeFixture);
            }}
            className="min-w-0 rounded-lg border border-white/25 bg-black/20 px-2 py-1.5 text-xs text-white outline-none focus:ring-2 focus:ring-white"
          >
            {FIXTURES.map((item) => <option key={item} value={item}>{FIXTURE_LABELS[item]}</option>)}
          </select>
        </label>
      </section>
    </div>
  );
}

function PrototypePeerPanel({ icon, title }: { readonly icon: ReactNode; readonly title: string }) {
  return (
    <section className="rounded-2xl border border-border-subtle bg-surface-raised p-6">
      <div className="flex items-center gap-2 text-accent-brand">{icon}<h2 className="text-lg font-semibold text-text-primary">{title} fixture</h2></div>
      <p className="mt-2 text-sm text-text-secondary">This peer tab is intentionally reduced so the prototype can focus on Evidence navigation without changing the existing workspace.</p>
    </section>
  );
}

export {
  type EvidencePrototypeVariant,
  type EvidencePrototypeFixture,
} from "./evidence-prototype-data";
