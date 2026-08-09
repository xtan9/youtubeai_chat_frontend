import type { CSSProperties } from "react";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { requireAdminPage } from "@/app/admin/_components/admin-gate";
import { cn } from "@/lib/utils";
import {
  loadSubscriptionFunnelReport,
  readSubscriptionFunnelReleaseAt,
  type SubscriptionFunnelReport,
  type SubscriptionFunnelSegmentDimension,
  type SubscriptionFunnelStage,
} from "@/lib/admin/subscription-funnel-report";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ window?: string }>;
}

const STAGE_LABELS: Record<SubscriptionFunnelStage["event"], string> = {
  subscription_discovery_viewed: "Plan control viewed",
  subscription_discovery_clicked: "Plan control clicked",
  pricing_viewed: "Pricing viewed",
  plan_choice_attempted: "Plan chosen",
  checkout_started: "Checkout started",
  subscription_activated: "Subscription activated",
};

const SEGMENT_LABELS: Record<SubscriptionFunnelSegmentDimension, string> = {
  source_surface: "Source surface",
  presentation_state: "Presentation state",
  authentication_state: "Authentication state",
  device_class: "Device class",
  plan: "Plan",
  billing_interval: "Billing interval",
};

const SEGMENT_ORDER = Object.keys(
  SEGMENT_LABELS,
) as SubscriptionFunnelSegmentDimension[];

export default async function AdminSubscriptionsPage({
  searchParams,
}: PageProps) {
  await requireAdminPage();
  const params = await searchParams;
  const windowDays = parseFunnelWindowDays(params.window);
  const releaseAt = readSubscriptionFunnelReleaseAt();
  const report = await loadSubscriptionFunnelReport({
    windowDays,
    releaseAt,
    now: new Date(),
  });

  return <SubscriptionFunnelView report={report} />;
}

function SubscriptionFunnelView({
  report,
}: {
  report: SubscriptionFunnelReport;
}) {
  const firstStageLearners = report.stages[0]?.current.learners ?? 0;

  return (
    <div className="surface-anim subscription-funnel-view">
      <div className="page-h">
        <div>
          <h1 className="page-title">Subscription conversion</h1>
          <p className="page-sub">
            {formatWindow(report.windows.current)} compared with the equal,
            immediately preceding baseline
          </p>
        </div>
        <div className="row gap-8" style={{ alignItems: "center" }}>
          <span
            className={cn(
              "pill",
              report.windows.status === "complete" ? "pill-ok" : "pill-warn",
            )}
          >
            <span className="dot" />
            {report.windows.status === "complete"
              ? "Window complete"
              : "Window in progress"}
          </span>
          <div className="tabs" aria-label="Comparison window">
            {[7, 14].map((days) => (
              <a
                key={days}
                href={`?window=${days}`}
                className={cn(
                  "tab",
                  report.windowDays === days && "active",
                )}
                aria-current={report.windowDays === days ? "page" : undefined}
              >
                {days}d
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="page-body subscription-funnel-page">
        <div className="subscription-funnel-audience-note">
          <ShieldCheck size={15} aria-hidden="true" />
          <span>
            Smoke Account activity is excluded from every metric. Missing
            historical attribution is retained as Unattributed.
          </span>
          {report.isCached ? <span className="pill">Cached</span> : null}
        </div>

        <section className="card subscription-funnel-card" aria-labelledby="funnel-heading">
          <div className="card-h">
            <div>
              <h2 className="card-title" id="funnel-heading">
                Successful path
              </h2>
              <p className="card-sub">
                Learners at each stage; ordered loss is measured against the
                immediately preceding stage for current and baseline windows.
              </p>
            </div>
            <span className="pill pill-mono">
              Released {formatInstant(report.releaseAt)}
            </span>
          </div>
          <ol className="subscription-funnel-rail">
            {report.stages.map((stage, index) => {
              const fillPct =
                firstStageLearners === 0
                  ? 0
                  : Math.min(
                      100,
                      Math.round(
                        (stage.current.learners / firstStageLearners) * 100,
                      ),
                    );
              return (
                <li key={stage.event} className="subscription-funnel-stage">
                  {stage.currentDropOff && stage.baselineDropOff ? (
                    <div
                      className="subscription-funnel-loss"
                      aria-label={`${formatCount(
                        stage.currentDropOff.learners,
                      )} learners lost in the current window, ${formatPct(
                        stage.currentDropOff.ratePct,
                      )}; ${formatCount(
                        stage.baselineDropOff.learners,
                      )} learners lost in the baseline window, ${formatPct(
                        stage.baselineDropOff.ratePct,
                      )}`}
                    >
                      <span>
                        {"\u2212"}
                        {formatCount(stage.currentDropOff.learners)}
                      </span>
                      <small>
                        {formatPct(stage.currentDropOff.ratePct)} now
                      </small>
                      <small className="subscription-funnel-loss-baseline">
                        <span>
                          {"\u2212"}
                          {formatCount(stage.baselineDropOff.learners)} base
                        </span>
                        <span>{formatPct(stage.baselineDropOff.ratePct)}</span>
                      </small>
                    </div>
                  ) : null}
                  <article>
                    <div className="subscription-funnel-stage-index">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <h3>{STAGE_LABELS[stage.event]}</h3>
                    <strong>{formatCount(stage.current.learners)}</strong>
                    <span className="subscription-funnel-unit">Learners</span>
                    <div className="subscription-funnel-comparison">
                      <span>{formatCount(stage.current.events)} events</span>
                      <span>
                        {formatCount(stage.baseline.learners)} baseline
                      </span>
                    </div>
                    <div
                      className="subscription-funnel-meter"
                      aria-hidden="true"
                      style={
                        { "--funnel-fill": `${fillPct}%` } as CSSProperties
                      }
                    />
                  </article>
                </li>
              );
            })}
          </ol>
        </section>

        <section
          className="card subscription-funnel-failures"
          aria-labelledby="checkout-failures-heading"
        >
          <div className="card-h">
            <div>
              <h2 className="card-title" id="checkout-failures-heading">
                Checkout failures
              </h2>
              <p className="card-sub">
                Attempts that could not produce a Stripe Checkout destination.
              </p>
            </div>
            <TriangleAlert size={17} aria-hidden="true" />
          </div>
          <div className="subscription-funnel-failure-summary">
            <div>
              <span className="kpi-label">Current failures</span>
              <strong>{formatCount(report.checkoutFailures.current.events)}</strong>
              <small>
                {formatPct(report.checkoutFailures.current.outcomeRatePct)} of
                checkout outcomes
              </small>
            </div>
            <div>
              <span className="kpi-label">Baseline failures</span>
              <strong>{formatCount(report.checkoutFailures.baseline.events)}</strong>
              <small>
                {formatPct(report.checkoutFailures.baseline.outcomeRatePct)} of
                checkout outcomes
              </small>
            </div>
          </div>
          <div className="subscription-funnel-table-wrap">
            <table className="tbl">
              <caption>Checkout failure categories</caption>
              <thead>
                <tr>
                  <th scope="col">Failure category</th>
                  <th scope="col" className="num">Current events</th>
                  <th scope="col" className="num">Current Learners</th>
                  <th scope="col" className="num">Baseline events</th>
                </tr>
              </thead>
              <tbody>
                {report.failureCategories.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No checkout failures in either window.
                    </td>
                  </tr>
                ) : (
                  report.failureCategories.map((failure) => (
                    <tr key={failure.category}>
                      <th scope="row">{humanize(failure.category)}</th>
                      <td className="num">{formatCount(failure.current.events)}</td>
                      <td className="num">
                        {formatCount(failure.current.learners)}
                      </td>
                      <td className="num">
                        {formatCount(failure.baseline.events)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="segment-heading">
          <div className="section-h">
            <div>
              <h2 className="section-title" id="segment-heading">
                Stage segments
              </h2>
              <p className="section-note">
                Current Learners with the equal baseline shown beneath.
              </p>
            </div>
          </div>
          <div className="subscription-funnel-segments">
            {SEGMENT_ORDER.map((dimension) => {
              const segments = report.segments.filter(
                (segment) => segment.dimension === dimension,
              );
              if (segments.length === 0) return null;
              return (
                <div className="card subscription-funnel-segment" key={dimension}>
                  <div className="card-h">
                    <h3 className="card-title">{SEGMENT_LABELS[dimension]}</h3>
                  </div>
                  <div className="subscription-funnel-table-wrap">
                    <table className="tbl">
                      <caption>{SEGMENT_LABELS[dimension]} by funnel stage</caption>
                      <thead>
                        <tr>
                          <th scope="col">Segment</th>
                          {report.stages.map((stage) => (
                            <th scope="col" className="num" key={stage.event}>
                              {shortStageLabel(stage.event)}
                            </th>
                          ))}
                          <th scope="col" className="num">
                            Failed
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {segments.map((segment) => (
                          <tr key={segment.value}>
                            <th scope="row">{humanize(segment.value)}</th>
                            {segment.stages.map((stage) => (
                              <td className="num" key={stage.event}>
                                <strong>{formatCount(stage.current.learners)}</strong>
                                <small>{formatCount(stage.baseline.learners)} base</small>
                              </td>
                            ))}
                            <td className="num">
                              <strong>
                                {formatCount(
                                  segment.checkoutFailures.current.learners,
                                )}
                              </strong>
                              <small>
                                {formatCount(
                                  segment.checkoutFailures.baseline.learners,
                                )}{" "}
                                base
                              </small>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function parseFunnelWindowDays(raw: string | undefined): 7 | 14 {
  return raw === "14" ? 14 : 7;
}

function shortStageLabel(event: SubscriptionFunnelStage["event"]): string {
  switch (event) {
    case "subscription_discovery_viewed":
      return "Viewed";
    case "subscription_discovery_clicked":
      return "Clicked";
    case "pricing_viewed":
      return "Pricing";
    case "plan_choice_attempted":
      return "Chosen";
    case "checkout_started":
      return "Checkout";
    case "subscription_activated":
      return "Activated";
  }
}

function humanize(value: string): string {
  const parts = value.split("_").filter(Boolean);
  const [first, ...rest] = parts;
  if (!first) return value;
  return [first[0].toUpperCase() + first.slice(1), ...rest].join(" ");
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatWindow(window: { start: string; end: string }): string {
  return `${formatInstant(window.start)} – ${formatInstant(window.end)}`;
}

function formatInstant(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}
