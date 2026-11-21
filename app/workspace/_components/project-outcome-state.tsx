import {useTranslations} from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function ProjectOutcomeState({
  kind,
}: {
  kind:
    | "anonymous"
    | "invalid"
    | "missing"
    | "unavailable";
}) {
  const tr = useTranslations("ui");
  const content = {
    anonymous: {
      title: tr("createAccount"),
      message:
        tr("register"),
      action: {
        href: "/auth/sign-up?redirect_to=%2Fworkspace",
        label: tr("createFreeAccount"),
      },
    },
    invalid: {
      title: tr("invalid"),
      message: tr("openFromWorkspace"),
      action: { href: "/workspace", label: tr("back") },
    },
    missing: {
      title: tr("missing"),
      message: tr("missingDetail"),
      action: { href: "/workspace", label: tr("back") },
    },
    unavailable: {
      title: tr("unavailable"),
      message: tr("refreshLater"),
      action: { href: "/workspace", label: tr("back") },
    },
  }[kind];

  return (
    <div className="mx-auto flex w-full max-w-page justify-center px-4 py-12 sm:px-6">
      <Card className="w-full max-w-prose">
        <CardHeader>
          <h1 className="text-h4 font-semibold text-text-primary">
            {content.title}
          </h1>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-5">
          <p role={kind === "unavailable" ? "alert" : undefined} className="text-body-md text-text-secondary">
            {content.message}
          </p>
          <Button asChild>
            <Link href={content.action.href}>{content.action.label}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
