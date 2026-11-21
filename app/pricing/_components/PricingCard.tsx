"use client";

import {useTranslations} from "next-intl";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

export type PricingPlan = "monthly" | "yearly";

export type PricingCardFailure = {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
};

type PricingProCardProps = {
  readonly plan: PricingPlan;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly actionDisabled?: boolean;
  readonly actionPending?: boolean;
  readonly currentPlan?: boolean;
  readonly selectedIntent?: boolean;
  readonly failure?: PricingCardFailure;
};

export function PricingProCard({
  plan,
  actionLabel,
  onAction,
  actionDisabled = false,
  actionPending = false,
  currentPlan = false,
  selectedIntent = false,
  failure,
}: PricingProCardProps) {
  const t = useTranslations("pricing");
  const isYearly = plan === "yearly";
  const titleId = `pricing-pro-${plan}-title`;
  const cadenceId = `pricing-pro-${plan}-cadence`;

  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      className={
        isYearly ? "border-accent-brand" : "border-border-subtle"
      }
      data-pricing-card={`pro-${plan}`}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-h4 text-text-primary">
            {isYearly ? t("proYearly") : t("proMonthly")}
          </h2>
          <div className="flex flex-wrap justify-end gap-1.5">
            {currentPlan ? <Badge variant="secondary">{t("current")}</Badge> : null}
            {selectedIntent && !currentPlan ? (
              <Badge variant="outline">{t("selected")}</Badge>
            ) : null}
            {isYearly ? <Badge>{t("savings")}</Badge> : null}
          </div>
        </div>
        <p className="mt-2 text-h2 text-text-primary">
          {isYearly ? t("yearPrice") : t("monthPrice")}
        </p>
        <p id={cadenceId} className="text-body-sm text-text-secondary">
          {isYearly
            ? t("yearCharge")
            : t("monthCharge")}
        </p>
      </CardHeader>

      <CardContent className="flex-1">
        <ul className="space-y-2 text-body-md text-text-secondary">
          <li>{t("summaries")}</li>
          <li>{t("chats")}</li>
          <li>{t("history")}</li>
          <li>{t("projects")}</li>
          <li>{t("cancel")}</li>
        </ul>
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          type="button"
          className="w-full"
          onClick={onAction}
          disabled={actionDisabled}
          aria-busy={actionPending || undefined}
          aria-describedby={cadenceId}
        >
          {actionLabel}
        </Button>
        {failure ? (
          <Alert variant="destructive">
            <AlertTitle>{failure.title}</AlertTitle>
            <AlertDescription>
              <p>{failure.description}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={failure.onAction}
              >
                {failure.actionLabel}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardFooter>
    </Card>
  );
}

export function PricingFreeCard() {
  const t = useTranslations("pricing");
  return (
    <Card
      role="region"
      aria-labelledby="pricing-free-title"
      className="border-border-subtle"
      data-pricing-card="free"
    >
      <CardHeader>
        <h2 id="pricing-free-title" className="text-h4 text-text-primary">{t("free")}</h2>
        <p className="mt-2 text-h2 text-text-primary">$0</p>
        <p className="text-body-sm text-text-secondary">{t("freeDescription")}</p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-body-md text-text-secondary">
          <li>{t("freeSummaries")}</li>
          <li>{t("freeChats")}</li>
          <li>{t("freeHistory")}</li>
          <li>{t("freeProjects")}</li>
        </ul>
      </CardContent>
    </Card>
  );
}
