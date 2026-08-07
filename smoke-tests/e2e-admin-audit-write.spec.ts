import { test, expect } from "@playwright/test";
import { openHighestVolumeUserTranscript } from "./admin-helpers";
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
    page.waitForURL(
      (url) => url.pathname === "/" || url.pathname === "/dashboard",
      { timeout: 15_000 },
    ),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);

  // Open transcript modal from /admin/users.
  await page.goto(`${PROD_URL}/admin/users`);
  await expect(page.getByRole("heading", { name: /^Users$/ })).toBeVisible();
  // Expand the first user row that has a transcript button.
  await openHighestVolumeUserTranscript(page);

  // The audit-banner copy should switch from "logging this view…" to
  // "this view is logged" once the server action returns successfully.
  await expect(
    page.getByText(/viewing as admin.*is logged/i),
  ).toBeVisible({ timeout: 10_000 });

  // The server action returns the inserted audit-row ID. Use that stable
  // identity for the read-back assertion; counting action labels is invalid
  // once the audit page reaches its fixed 50-row window (the newest row
  // replaces an older row, so the count stays exactly 50).
  const auditBanner = page.locator('.banner-audit[data-state="audited"]');
  await expect(auditBanner).toBeVisible({ timeout: 10_000 });
  const auditId = await auditBanner.getAttribute("data-audit-id");
  expect(auditId).toMatch(/^[0-9a-f-]{8,}$/i);

  // Wait for the exact audit row to be readable on /admin/audit. Insert
  // latency is typically sub-second; allow up to 15s for replication /
  // rendering.
  await page.goto(`${PROD_URL}/admin/audit`);
  await expect(async () => {
    await page.reload();
    const auditRow = page.locator(`tr[data-audit-id="${auditId}"]`);
    await expect(auditRow).toHaveCount(1);
    await expect(
      auditRow.getByText("view transcript", { exact: true }),
    ).toBeVisible();
  }).toPass({ timeout: 15_000 });
});
