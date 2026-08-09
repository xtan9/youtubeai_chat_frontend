"use client";

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
            Pro {isYearly ? "Yearly" : "Monthly"}
          </h2>
          <div className="flex flex-wrap justify-end gap-1.5">
            {currentPlan ? <Badge variant="secondary">Current Plan</Badge> : null}
            {selectedIntent && !currentPlan ? (
              <Badge variant="outline">Selected</Badge>
            ) : null}
            {isYearly ? <Badge>Save 28%</Badge> : null}
          </div>
        </div>
        <p className="mt-2 text-h2 text-text-primary">
          {isYearly ? "$4.99/month equivalent" : "$6.99/month"}
        </p>
        <p id={cadenceId} className="text-body-sm text-text-secondary">
          {isYearly
            ? "$59.88 charged once per year."
            : "$6.99 charged every month."}
        </p>
      </CardHeader>

      <CardContent className="flex-1">
        <ul className="space-y-2 text-body-md text-text-secondary">
          <li>Unlimited summaries</li>
          <li>Unlimited Video Chat per Video</li>
          <li>Unlimited History</li>
          <li>Unlimited Projects within technical and abuse limits</li>
          <li>Cancel anytime</li>
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
  return (
    <Card
      role="region"
      aria-labelledby="pricing-free-title"
      className="border-border-subtle"
      data-pricing-card="free"
    >
      <CardHeader>
        <h2 id="pricing-free-title" className="text-h4 text-text-primary">
          Free
        </h2>
        <p className="mt-2 text-h2 text-text-primary">$0</p>
        <p className="text-body-sm text-text-secondary">No charge, ever.</p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-body-md text-text-secondary">
          <li>10 summaries per month</li>
          <li>5 Video Chat messages per Video</li>
          <li>10-item History</li>
          <li>1 durable Project</li>
        </ul>
      </CardContent>
    </Card>
  );
}
