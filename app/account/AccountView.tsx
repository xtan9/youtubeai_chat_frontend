"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@/lib/contexts/user-context";
import { useEntitlements, type EntitlementsData } from "@/lib/hooks/useEntitlements";
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

function PlanCardSkeleton() {
  return (
    <Card data-testid="plan-card-skeleton">
      <CardHeader>
        <div className="h-5 w-24 rounded bg-state-disabled animate-pulse" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="h-4 w-48 rounded bg-state-disabled animate-pulse" />
        <div className="h-4 w-40 rounded bg-state-disabled animate-pulse" />
      </CardContent>
    </Card>
  );
}

function PlanCardError() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-h3">Plan</CardTitle>
      </CardHeader>
      <CardContent>
        <p role="alert" className="text-body-md text-text-secondary">
          Couldn&apos;t load your plan details. Please refresh the page, or contact support if this persists.
        </p>
      </CardContent>
    </Card>
  );
}

function FreePlanCard({ caps }: { caps: EntitlementsData["caps"] }) {
  return (
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
  );
}

function ProPlanCard({
  subscription,
}: {
  subscription: NonNullable<EntitlementsData["subscription"]> | null | undefined;
}) {
  const renewal = formatRenewalDate(subscription?.current_period_end);
  const cadence =
    subscription?.plan === "yearly"
      ? "Billed yearly"
      : subscription?.plan === "monthly"
        ? "Billed monthly"
        : null;
  const cancelPending = subscription?.cancel_at_period_end ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-h3">Pro plan</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {cadence ? (
          <p className="text-body-md text-text-secondary">{cadence}</p>
        ) : null}
        {renewal && !cancelPending ? (
          <p className="text-body-md text-text-secondary">Renews on {renewal}</p>
        ) : null}
        {cancelPending ? (
          <div
            role="status"
            className="rounded-md border border-accent-warning/40 bg-accent-warning/10 px-4 py-3 text-body-sm text-text-primary"
          >
            {renewal
              ? `Your subscription will end on ${renewal}. You can resume it from the billing portal.`
              : "Your subscription has been cancelled and will end at the end of the current billing period. You can resume it from the billing portal."}
          </div>
        ) : null}
        <div>
          <ManageSubscriptionButton />
        </div>
      </CardContent>
    </Card>
  );
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

  // Plan card branching:
  //   - isPending (no data, no error yet): skeleton
  //   - isError or no usable data: explicit error card
  //   - tier === "free": FreePlanCard with caps
  //   - tier === "pro": ProPlanCard (renders manage-subscription button even when subscription metadata is missing — escape hatch for paying users during webhook lag)
  //   - any other tier (e.g. transient "anon" while reconciling): error card
  let planNode: React.ReactNode;
  if (entitlements.isPending) {
    planNode = <PlanCardSkeleton />;
  } else if (entitlements.isError || !entitlements.data) {
    planNode = <PlanCardError />;
  } else if (tier === "free" && caps) {
    planNode = <FreePlanCard caps={caps} />;
  } else if (tier === "pro") {
    planNode = <ProPlanCard subscription={subscription} />;
  } else {
    planNode = <PlanCardError />;
  }

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

        {planNode}

        <div>
          <Button variant="outline" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
