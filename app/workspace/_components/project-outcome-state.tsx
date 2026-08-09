import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function ProjectOutcomeState({
  kind,
}: {
  kind: "anonymous" | "invalid" | "missing" | "unavailable";
}) {
  const content = {
    anonymous: {
      title: "Create an account for Projects",
      message:
        "Register free to create one private, durable Project and keep your research ready to resume.",
    },
    invalid: {
      title: "That Project link isn’t valid",
      message: "Open a Project from your Workspace instead.",
    },
    missing: {
      title: "Project not found",
      message: "It may have been deleted, or it may not belong to this account.",
    },
    unavailable: {
      title: "Projects are temporarily unavailable",
      message: "Refresh the page in a moment. Your saved Projects are unchanged.",
    },
  }[kind];

  return (
    <main className="mx-auto flex w-full max-w-page justify-center px-4 py-12 sm:px-6">
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
            <Link
              href={
                kind === "anonymous"
                  ? "/auth/sign-up?redirect_to=%2Fworkspace"
                  : "/workspace"
              }
            >
              {kind === "anonymous" ? "Create free account" : "Back to Workspace"}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
