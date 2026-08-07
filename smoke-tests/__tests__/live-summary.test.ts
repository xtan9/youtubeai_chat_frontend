import { describe, expect, it } from "vitest";
import type { Page } from "@playwright/test";
import { waitForLiveSummarySuccess } from "../live-summary";

type LocatorState = "visible" | "hidden";

function makePageWithTransientRetryMarker(): Page {
  let retryVisible = false;
  let failureKindReads = 0;
  let statusReads = 0;

  const retry = {
    async waitFor({ state }: { state: LocatorState }) {
      if (state === "visible") {
        retryVisible = true;
      } else {
        retryVisible = false;
      }
    },
    async isVisible() {
      return retryVisible;
    },
  };

  const shell = {
    async getAttribute(name: string) {
      if (name === "data-summary-failure-kind") {
        failureKindReads += 1;
        return failureKindReads === 1 ? null : "quota";
      }
      if (name === "data-summary-status") {
        statusReads += 1;
        return statusReads === 1 ? "running" : "failed";
      }
      return null;
    },
  };

  const quotaCard = {
    async isVisible() {
      return failureKindReads > 1;
    },
    async innerText() {
      return "You summarized 10 videos this month";
    },
  };

  const hiddenLocator = {
    async isVisible() {
      return false;
    },
  };

  return {
    getByTestId(testId: string) {
      if (testId === "summary-retry") return retry;
      if (testId === "summary-page-shell") return shell;
      return hiddenLocator;
    },
    locator() {
      return quotaCard;
    },
    getByText() {
      return hiddenLocator;
    },
  } as unknown as Page;
}

describe("waitForLiveSummarySuccess", () => {
  it("ignores a transient retry marker before reporting the current quota state", async () => {
    const page = makePageWithTransientRetryMarker();

    await expect(
      waitForLiveSummarySuccess({
        page,
        success: new Promise<never>(() => {}),
        terminalTimeoutMs: 1_000,
      }),
    ).rejects.toThrow(/quota state/);
  });
});
