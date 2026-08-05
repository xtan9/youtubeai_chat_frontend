import { expect, type Page } from "@playwright/test";

/**
 * Open a real transcript from the highest-volume user in the admin directory.
 *
 * Transcript actions live inside an expanded user row. Sorting by the visible
 * Summaries column keeps the live-data smoke deterministic without depending
 * on a particular production email or summary title.
 */
export async function openHighestVolumeUserTranscript(
  page: Page,
): Promise<void> {
  const usersTable = page.locator("table.tbl");
  const summariesColumn = usersTable.getByRole("columnheader", {
    name: "Summaries",
  });

  await expect(summariesColumn).toBeVisible();
  await summariesColumn.click();
  await expect(page).toHaveURL(/(?:\?|&)sort=summaries(?:&|$)/);

  const highestVolumeUser = usersTable
    .locator("tbody > tr:not(.expand-row)")
    .first();
  await expect(highestVolumeUser).toBeVisible();
  await highestVolumeUser.click();
  await expect(
    page.getByText("RECENT SUMMARIES", { exact: true }),
  ).toBeVisible();

  const viewTranscript = page
    .getByRole("button", { name: /^View transcript$/i })
    .first();
  await expect(viewTranscript).toBeVisible();
  await expect(viewTranscript).toBeEnabled();
  await viewTranscript.click();
}
