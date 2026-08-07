import type { Locator, Page } from "@playwright/test";

type LiveSummaryWaitOptions<T> = {
  page: Page;
  success: Promise<T>;
  terminalTimeoutMs: number;
};

async function visibleText(locator: Locator): Promise<string> {
  return (await locator.innerText().catch(() => ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

async function rejectOnSummaryFailure(
  page: Page,
  timeoutMs: number,
): Promise<never> {
  // Every failed Summary Run renders the retry action. Waiting on that one
  // stable terminal marker covers quota, authentication, rate-limit, request,
  // network, processing, and protocol failures without guessing from progress
  // copy or transport events.
  const retry = page.getByTestId("summary-retry");
  const shell = page.getByTestId("summary-page-shell");
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remainingMs = Math.max(1, deadline - Date.now());
    await retry.waitFor({ state: "visible", timeout: remainingMs });

    // The auth/session provider can briefly render a failed run before the
    // access token is hydrated and the page starts the real run. Ignore that
    // stale retry marker; otherwise a transient AUTH_REQUIRED state masks the
    // actual production Summary result (the CJK smoke hit this race).
    const failureKind = await shell.getAttribute("data-summary-failure-kind");
    const quotaCard = page.locator('[data-paywall-variant="summary-cap"]');
    const quotaVisible = await quotaCard.isVisible();
    if (failureKind === "quota" || quotaVisible) {
      const detail = await visibleText(quotaCard);
      throw new Error(
        `live Summary ended in quota state${detail ? `: ${detail}` : ""}`,
      );
    }

    const streamError = page.getByTestId("stream-error-banner");
    const streamErrorVisible = await streamError.isVisible();
    if (streamErrorVisible) {
      const detail = await visibleText(streamError);
      throw new Error(
        `live Summary ended in stream-error state${detail ? `: ${detail}` : ""}`,
      );
    }

    const authenticationError = page.getByText("Authentication Error", {
      exact: true,
    });
    const authenticationErrorVisible = await authenticationError.isVisible();
    if (failureKind === "authentication" || authenticationErrorVisible) {
      throw new Error("live Summary ended in authentication-error state");
    }

    if (failureKind) {
      throw new Error(`live Summary ended in ${failureKind} state`);
    }

    // If none of the terminal cards is mounted, the retry marker was from a
    // superseded run. Wait for it to disappear and observe the current run.
    // If it remains visible, preserve the unclassified failure rather than
    // hiding a genuinely new terminal state.
    const status = await shell.getAttribute("data-summary-status");
    if (!status || status === "running" || status === "idle") {
      const hideTimeoutMs = Math.min(remainingMs, 5_000);
      await retry
        .waitFor({ state: "hidden", timeout: hideTimeoutMs })
        .catch(() => undefined);
      if (!(await retry.isVisible()) && Date.now() < deadline) continue;
    }

    throw new Error("live Summary ended in an unclassified failure state");
  }
}

/**
 * Wait for the caller's behavior-level success assertion while also observing
 * the Summary page's public terminal failure state. A real terminal failure
 * must reject immediately rather than consuming the full live-flow budget.
 */
export function waitForLiveSummarySuccess<T>({
  page,
  success,
  terminalTimeoutMs,
}: LiveSummaryWaitOptions<T>): Promise<T> {
  return Promise.race([
    success,
    rejectOnSummaryFailure(page, terminalTimeoutMs),
  ]);
}
