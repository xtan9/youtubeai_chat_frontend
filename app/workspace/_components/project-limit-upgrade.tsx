"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import type { ProjectLimitEventProperties } from "@/lib/analytics/project-limits";
import { useSubscriptionDiscovery } from "@/lib/analytics/use-subscription-discovery";
import { Button } from "@/components/ui/button";

type ProjectLimitSource =
  ProjectLimitEventProperties["project_limit_reached"]["source_surface"];

function governedProjectsUsed(value: unknown, fallback: number): number {
  const count =
    typeof value === "number" && Number.isInteger(value) ? value : fallback;
  return Math.min(10_000, Math.max(1, count));
}

export function ProjectLimitUpgrade({
  source,
  used,
}: {
  source: ProjectLimitSource;
  used: number;
}) {
  const tr = useTranslations("ui");
  const governedUsed = governedProjectsUsed(used, 1);
  const { captureClick: captureSubscriptionDiscoveryClick } =
    useSubscriptionDiscovery({
      sourceSurface: "project_limit",
      presentationState: "upgrade_to_pro",
      authenticationState: "registered",
    });

  function captureUpgradeClick() {
    captureSubscriptionDiscoveryClick();
    captureAnalyticsEvent("project_limit_cta_clicked", {
      source_surface: source,
      tier: "free",
      projects_used: governedUsed,
      projects_limit: 1,
      cta: "upgrade_to_pro",
    });
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <p className="text-body-sm text-text-secondary">
        {tr("usedProjects", { used: governedUsed })}
      </p>
      <Button asChild>
        <Link
          href="/pricing?source_surface=project_limit"
          onClick={captureUpgradeClick}
        >
          {tr("upgrade")}
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
      <p className="max-w-xs text-body-sm text-text-muted sm:text-right">
        {tr("deleteToFreeSlot")}
      </p>
    </div>
  );
}
