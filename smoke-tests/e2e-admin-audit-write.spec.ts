import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

// Skip-conditional like e2e-admin-happypath: the default test account is
// intentionally not in production's ADMIN_EMAILS, so this spec only runs
// when TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD are present (typically a
// preview deploy or a CI env with a preview-scoped allowlist).
test("admin viewing a transcript writes a row to admin_audit_log", async ({
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

  // Sign in
  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 }),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);

  // Read /admin/audit BEFORE the click so we can compare against an
  // observed delta, not just "any row exists" — that catches the case
  // where the page already had pre-existing view_transcript rows.
  await page.goto(`${PROD_URL}/admin/audit`);
  await expect(page.getByRole("heading", { name: /^Audit log$/ })).toBeVisible();
  const auditTable = page.locator("table.tbl");
  const beforeCount = await auditTable
    .locator('tr:has-text("view transcript")')
    .count();

  // Open transcript modal from /admin/users
  await page.goto(`${PROD_URL}/admin/users`);
  await expect(page.getByRole("heading", { name: /^Users$/ })).toBeVisible();
  // Expand the first user row that has a transcript button.
  await page.getByRole("button", { name: /View transcript/i }).first().click();

  // The audit-banner copy should switch from "logging this view…" to
  // "this view is logged" once the server action returns successfully.
  await expect(
    page.getByText(/viewing as admin.*is logged/i),
  ).toBeVisible({ timeout: 10_000 });

  // Verify a row is rendered — header value or summary content lands.
  // We don't assert specific text since prod content varies.
  await expect(page.locator(".banner-audit")).toBeVisible();

  // Wait for the audit row to be readable on /admin/audit. Insert latency
  // is typically sub-second; allow up to 15s for replication / rendering.
  await page.goto(`${PROD_URL}/admin/audit`);
  await expect(async () => {
    await page.reload();
    const afterCount = await auditTable
      .locator('tr:has-text("view transcript")')
      .count();
    expect(afterCount).toBeGreaterThan(beforeCount);
  }).toPass({ timeout: 15_000 });
});
