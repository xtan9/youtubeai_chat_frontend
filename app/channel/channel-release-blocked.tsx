import type { ChannelLaunchGate } from "@/lib/compliance/channel-launch";

const GATE_LABELS: Record<string, string> = {
  youtube_compliance: "written YouTube clearance",
  oauth_verification: "Google OAuth verification",
  live_disclosures: "live privacy disclosures",
  offline_quality: "offline quality evidence",
  lifecycle_evidence: "lifecycle evidence",
  retention: "retention evidence",
  accessibility_evidence: "accessibility evidence",
  quota_load_evidence: "quota and load evidence",
  production_readiness: "production readiness evidence",
  launch_packet: "the complete launch packet",
};

function gateLabel(gate: string): string {
  return GATE_LABELS[gate] ?? gate.replaceAll("_", " ");
}

export function ChannelReleaseBlocked({
  gate,
}: Readonly<{ gate: Extract<ChannelLaunchGate, { status: "blocked" }> }>) {
  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6 sm:py-16"
      data-channel-release="blocked"
      aria-labelledby="channel-release-heading"
    >
      <header className="rounded-[1.75rem] border border-border-strong bg-surface-sunken px-5 py-8 sm:px-8">
        <p className="text-caption font-semibold uppercase tracking-[0.2em] text-accent-brand-secondary">
          Channel Hub
        </p>
        <h1
          id="channel-release-heading"
          className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-text-primary sm:text-4xl"
        >
          Channel is not available yet
        </h1>
        <p className="mt-4 max-w-prose text-body-md leading-7 text-text-secondary">
          The complete Channel launch packet is still being verified. No
          YouTube authorization or external Channel action is available from
          this deployment.
        </p>
      </header>

      <section
        className="rounded-xl border border-border-subtle bg-surface-raised p-5"
        aria-labelledby="channel-release-gates-heading"
      >
        <h2
          id="channel-release-gates-heading"
          className="text-body-lg font-semibold text-text-primary"
        >
          Release checks still required
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-body-sm text-text-secondary">
          {gate.blockedGates.map((blockedGate) => (
            <li key={blockedGate}>{gateLabel(blockedGate)}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
