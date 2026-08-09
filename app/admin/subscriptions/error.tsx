"use client";

import { TriangleAlert } from "lucide-react";

export default function SubscriptionFunnelError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="surface-anim subscription-funnel-view">
      <div className="page-h">
        <div>
          <h1 className="page-title">Subscription conversion</h1>
          <p className="page-sub">
            The analytics provider did not return a report.
          </p>
        </div>
      </div>
      <div className="page-body subscription-funnel-page">
        <section
          className="card subscription-funnel-error"
          aria-labelledby="subscription-funnel-error-heading"
        >
          <TriangleAlert aria-hidden="true" />
          <h2 id="subscription-funnel-error-heading">
            Subscription report unavailable
          </h2>
          <p>
            No partial funnel is shown. Retry after the analytics service is
            available.
          </p>
          <button className="btn btn-primary" type="button" onClick={reset}>
            Retry report
          </button>
        </section>
      </div>
    </div>
  );
}
