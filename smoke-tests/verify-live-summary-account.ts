import { createClient, type User } from "@supabase/supabase-js";
import {
  hasSmokeProEntitlement,
  isSmokeAccount,
} from "../lib/auth/smoke-account";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalized(value: string | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed || null;
}

async function main(): Promise<void> {
  const liveEmail = requiredEnv("TEST_LIVE_SUMMARY_EMAIL");
  const livePassword = requiredEnv("TEST_LIVE_SUMMARY_PASSWORD");
  const quotaEmail = requiredEnv("TEST_NON_ADMIN_EMAIL");
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const secretKey = requiredEnv("SUPABASE_SECRET_KEY");

  const liveEmailNormalized = normalized(liveEmail);
  if (liveEmailNormalized === normalized(quotaEmail)) {
    throw new Error(
      "live Summary account must be different from the Free quota account",
    );
  }
  if (liveEmailNormalized === normalized(process.env.TEST_ADMIN_EMAIL)) {
    throw new Error(
      "live Summary account must be different from the administrator account",
    );
  }
  // Read the password so the workflow's protected secret is required without
  // ever logging or otherwise handling its value in this verification path.
  void livePassword;

  const client = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const matches: User[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error(`Auth account lookup failed: ${error.message}`);
    matches.push(
      ...data.users.filter(
        (user) => normalized(user.email) === liveEmailNormalized,
      ),
    );
    if (data.users.length < 1000) break;
  }
  if (matches.length !== 1) {
    throw new Error("live Summary account was not found uniquely in Auth");
  }
  const user = matches[0];
  if (!isSmokeAccount(user)) {
    throw new Error("live Summary account is missing the trusted Smoke marker");
  }
  if (user.app_metadata?.is_admin === true) {
    throw new Error("live Summary account must not be marked administrator");
  }
  if (!hasSmokeProEntitlement(user)) {
    throw new Error(
      "live Summary account is missing the trusted smoke-only Pro entitlement",
    );
  }

  console.log(
    "Dedicated live Summary Smoke Account verified: distinct, trusted, non-admin, and smoke-Pro-entitled.",
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "live Summary account verification failed",
  );
  process.exitCode = 1;
});
