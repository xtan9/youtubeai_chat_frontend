import { requireAdminPage } from "@/app/admin/_components/admin-gate";
import { loadProjectAdoptionReport } from "@/lib/admin/project-adoption-report";

export const dynamic = "force-dynamic";

export default async function AdminProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  await requireAdminPage();
  const params = await searchParams;
  const windowDays = params.window === "7" ? 7 : 30;
  const report = await loadProjectAdoptionReport({
    windowDays,
    now: new Date(),
  });
  const { metrics, ratios } = report;

  return (
    <div className="surface-anim">
      <div className="page-h">
        <div>
          <h1 className="page-title">Project adoption</h1>
          <p className="page-sub">
            Activation, same-Project return, trust, processing health, and
            active-Project generation cost
          </p>
        </div>
        <nav className="tabs" aria-label="Project reporting window">
          {[7, 30].map((days) => (
            <a
              key={days}
              href={`?window=${days}`}
              className={`tab${windowDays === days ? " active" : ""}`}
              aria-current={windowDays === days ? "page" : undefined}
            >
              {days}d
            </a>
          ))}
        </nav>
      </div>

      <div className="page-body">
        <p className="muted">
          Smoke Accounts are excluded. This report accepts only stable IDs,
          bounded counts, ordinals, tier, kinds, timing, and error classes;
          names, Goals, URLs, queries, prompts, answers, passages, and Artifact
          content are never queried.
          {report.isCached ? " Cached result." : ""}
        </p>

        <MetricSection title="Adoption and return">
          <Metric label="Projects created" value={metrics.projectsCreated} />
          <Metric label="Activated Projects" value={metrics.activatedProjects} />
          <Metric
            label="D7-eligible activations"
            value={metrics.eligibleActivatedProjects}
          />
          <Metric label="Seven-day return" value={formatPct(ratios.sevenDayReturnPct)} />
          <Metric label="Searches" value={metrics.searches} />
          <Metric label="Project messages" value={metrics.messages} />
          <Metric label="First messages" value={metrics.firstMessages} />
          <Metric label="Subsequent messages" value={metrics.subsequentMessages} />
          <Metric label="Artifacts generated" value={metrics.artifacts} />
        </MetricSection>

        <MetricSection title="Retrieval and trust">
          <Metric label="Search results" value={metrics.searchResults} />
          <Metric label="Search passages examined" value={metrics.searchPassagesExamined} />
          <Metric label="Retrieval yield" value={formatPct(ratios.retrievalYieldPct)} />
          <Metric label="Grounded Answers" value={metrics.groundedAnswers} />
          <Metric
            label="Source Coverage integrity"
            value={formatPct(ratios.sourceCoverageIntegrityPct)}
          />
          <Metric label="Ready Videos covered" value={metrics.groundedReadyVideos} />
          <Metric label="Evidence Videos used" value={metrics.groundedUsedVideos} />
          <Metric label="Evidence passages used" value={metrics.groundedPassagesUsed} />
          <Metric label="Citation clicks" value={metrics.citationClicks} />
          <Metric label="Citation diagnostics" value={metrics.citationDiagnostics} />
          <Metric
            label="Answers with citation diagnostics"
            value={formatPct(ratios.answersWithCitationDiagnosticsPct)}
          />
          <Metric label="Helpful feedback" value={formatPct(ratios.helpfulFeedbackPct)} />
        </MetricSection>

        <MetricSection title="Processing and active-Project cost">
          <Metric label="Processing succeeded" value={metrics.processingSucceeded} />
          <Metric label="Processing failed" value={metrics.processingFailed} />
          <Metric
            label="Processing failure rate"
            value={formatPct(ratios.processingFailurePct)}
          />
          <Metric label="Generation records" value={metrics.generationEvents} />
          <Metric label="Active cost Projects" value={metrics.activeCostProjects} />
          <Metric
            label="Measured cost coverage"
            value={formatPct(ratios.measuredCostCoveragePct)}
          />
          <Metric
            label="Average generation duration"
            value={formatDuration(ratios.averageGenerationDurationMs)}
          />
          <Metric label="Measured model cost" value={formatMicrousd(metrics.costUsdMicros)} />
          <Metric
            label="Cost per active Project"
            value={formatMicrousd(ratios.costPerActiveProjectUsdMicros)}
          />
          <Metric label="Paywall views" value={metrics.paywallViews} />
        </MetricSection>

        <section className="card" aria-labelledby="project-failure-heading">
          <div className="card-h">
            <div>
              <h2 className="card-title" id="project-failure-heading">
                Failure classes
              </h2>
              <p className="card-sub">
                Governed Project, Artifact, and Video-processing outcomes.
              </p>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" aria-label="Project failure classes">
              <thead>
                <tr>
                  <th scope="col">Error class</th>
                  <th scope="col" className="num">Events</th>
                  <th scope="col" className="num">Projects</th>
                </tr>
              </thead>
              <tbody>
                {report.failures.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">No failures in this window.</td>
                  </tr>
                ) : (
                  report.failures.map((failure) => (
                    <tr key={failure.errorClass}>
                      <th scope="row">{humanize(failure.errorClass)}</th>
                      <td className="num">{formatCount(failure.events)}</td>
                      <td className="num">{formatCount(failure.projects)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricSection({ title, children }: { title: string; children: React.ReactNode }) {
  const id = `project-${title.toLowerCase().replaceAll(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <div className="section-h">
        <h2 className="section-title" id={id}>{title}</h2>
      </div>
      <div className="kpi-grid cols-3">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {typeof value === "number" ? formatCount(value) : value}
      </div>
    </div>
  );
}

function formatCount(value: number) {
  return value.toLocaleString("en-US");
}

function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatDuration(value: number) {
  return value >= 1_000 ? `${(value / 1_000).toFixed(2)}s` : `${value}ms`;
}

function formatMicrousd(value: number) {
  return `$${(value / 1_000_000).toFixed(4)}`;
}

function humanize(value: string) {
  return value
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
