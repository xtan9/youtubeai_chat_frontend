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
  await page
    .getByTestId("summary-retry")
    .waitFor({ state: "visible", timeout: timeoutMs });

  const quotaCard = page.locator('[data-paywall-variant="summary-cap"]');
  if (await quotaCard.isVisible()) {
    const detail = await visibleText(quotaCard);
    throw new Error(
      `live Summary ended in quota state${detail ? `: ${detail}` : ""}`,
    );
  }

  const streamError = page.getByTestId("stream-error-banner");
  if (await streamError.isVisible()) {
    const detail = await visibleText(streamError);
    throw new Error(
      `live Summary ended in stream-error state${detail ? `: ${detail}` : ""}`,
    );
  }

  const authenticationError = page.getByText("Authentication Error", {
    exact: true,
  });
  if (await authenticationError.isVisible()) {
    throw new Error("live Summary ended in authentication-error state");
  }

  throw new Error("live Summary ended in an unclassified failure state");
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
