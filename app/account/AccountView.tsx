"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/contexts/user-context";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import { createClient } from "@/lib/supabase/client";
import { ProfileAvatar } from "@/components/profile-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ManageSubscriptionButton } from "@/components/paywall/ManageSubscriptionButton";

function formatRenewalDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AccountView() {
  const { user } = useUser();
  const entitlements = useEntitlements();
  const router = useRouter();
  const supabase = createClient();

  if (!user) return null;

  const displayName =
    user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "User";

  const tier = entitlements.data?.tier ?? null;
  const caps = entitlements.data?.caps;
  const subscription = entitlements.data?.subscription ?? null;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  return (
    <main className="mx-auto max-w-page px-6 py-8">
      <div className="mx-auto max-w-prose flex flex-col gap-6">
        <h1 className="text-h2 text-text-primary">Account</h1>

        <Card>
          <CardContent className="flex items-center gap-4">
            <ProfileAvatar user={user} />
            <div className="flex flex-col">
              <span className="text-body-lg font-semibold text-text-primary">
                {displayName}
              </span>
              <span className="text-body-sm text-text-muted">{user.email}</span>
            </div>
          </CardContent>
        </Card>

        {tier === "free" && caps ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-h3">Free plan</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-body-md text-text-secondary">
                {caps.summariesUsed} of {caps.summariesLimit} summaries used this month
              </p>
              {typeof caps.historyUsed === "number" &&
              typeof caps.historyLimit === "number" ? (
                <p className="text-body-md text-text-secondary">
                  {caps.historyUsed} of {caps.historyLimit} saved videos in history
                </p>
              ) : null}
              <div>
                <Link href="/pricing">
                  <Button>Upgrade to Pro</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {tier === "pro" && subscription
          ? (() => {
              const renewal = formatRenewalDate(subscription.current_period_end);
              const cadence =
                subscription.plan === "yearly"
                  ? "Billed yearly"
                  : subscription.plan === "monthly"
                    ? "Billed monthly"
                    : null;
              return (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-h3">Pro plan</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {cadence ? (
                      <p className="text-body-md text-text-secondary">{cadence}</p>
                    ) : null}
                    {renewal && !subscription.cancel_at_period_end ? (
                      <p className="text-body-md text-text-secondary">
                        Renews on {renewal}
                      </p>
                    ) : null}
                    {subscription.cancel_at_period_end && renewal ? (
                      <div
                        role="status"
                        className="rounded-md border border-accent-warning/40 bg-accent-warning/10 px-4 py-3 text-body-sm text-text-primary"
                      >
                        Your subscription will end on {renewal}. You can resume it from the billing portal.
                      </div>
                    ) : null}
                    <div>
                      <ManageSubscriptionButton />
                    </div>
                  </CardContent>
                </Card>
              );
            })()
          : null}

        <div>
          <Button variant="outline" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
