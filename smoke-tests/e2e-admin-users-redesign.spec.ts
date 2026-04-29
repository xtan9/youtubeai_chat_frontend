import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

// Same skip-conditional as e2e-admin-audit-write: the default test account
// is intentionally not in production's ADMIN_EMAILS, so this spec only
// runs when TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD are present (typically
// a preview deploy or a CI env with a preview-scoped allowlist).
test("admin /users renders rows by default and supports sort + tab + drilldown", async ({
  page,
}) => {
  const adminEmail = process.env.TEST_ADMIN_EMAIL?.trim();
  const adminPassword = process.env.TEST_ADMIN_PASSWORD?.trim();
  test.skip(
    !adminEmail || !adminPassword,
    "TEST_ADMIN_EMAIL/TEST_ADMIN_PASSWORD required (must be in ADMIN_EMAILS)",
  );

  const creds =
    adminEmail && adminPassword
      ? { email: adminEmail, password: adminPassword }
      : await loadSmokeCreds();
  if (!creds) return;

  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 }),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);

  // 1. Default tab renders ≥1 row. This is the regression check for the
  //    empty-table bug — the old code dropped page-1 anonymous users and
  //    rendered "No users in this view".
  await page.goto(`${PROD_URL}/admin/users`);
  await expect(page.getByRole("heading", { name: /^Users$/ })).toBeVisible();
  const dataRows = page.locator("table.tbl tbody tr").filter({
    hasNot: page.locator("text=No users in this view"),
  });
  await expect(dataRows.first()).toBeVisible({ timeout: 10_000 });

  // 2. Click "Joined" header — URL gains dir=asc (the default sort key
  //    flips direction; the URL only carries dir when non-default).
  await page.getByText("Joined", { exact: true }).click();
  await expect(page).toHaveURL(/dir=asc/);

  // 3. Click "Summaries" — URL gains sort=summaries (and drops dir back
  //    to default desc, which the URL omits).
  await page.getByText("Summaries", { exact: true }).click();
  await expect(page).toHaveURL(/sort=summaries/);

  // 4. Switch to Anonymous tab — the URL changes; we don't assert any
  //    rows here because anonymous-user count is org state and could be
  //    zero on a freshly-cleaned environment.
  await page.getByText("Anonymous", { exact: true }).click();
  await expect(page).toHaveURL(/tab=anon_only/);

  // 5. Switch back to default tab and expand the first data row to
  //    confirm the new drilldown sections render.
  await page.getByText("Accounts", { exact: true }).click();
  await expect(page.locator("table.tbl tbody tr").first()).toBeVisible();
  await page.locator("table.tbl tbody tr").first().click();

  await expect(page.getByText(/RECENT SUMMARIES/)).toBeVisible();
  await expect(page.getByText(/RECENT AUDIT EVENTS/)).toBeVisible();
  await expect(page.getByText(/RAW METADATA/)).toBeVisible();
});
