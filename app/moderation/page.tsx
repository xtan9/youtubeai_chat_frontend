import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { resolveRequestPrincipal } from "@/lib/auth/request-principal";
import {
  getYouTubeConnection,
  listModerationItems,
} from "@/lib/comment-moderation/repository";
import type { SafeYouTubeConnection } from "@/lib/comment-moderation/contracts";
import { ModerationWorkspace } from "./moderation-workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Comment Shield - YouTube AI Chat",
  description: "Review hostile YouTube comments and approve AI-assisted replies.",
  robots: { index: false, follow: false },
};

export default async function ModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ youtube?: string }>;
}) {
  const principal = await resolveRequestPrincipal({ source: "comment_moderation" });
  if (principal.kind === "unavailable") {
    throw new Error("Account verification is temporarily unavailable.");
  }
  if (principal.kind === "missing" || principal.principal.isAnonymous) {
    redirect("/auth/login");
  }
  const [storedConnection, items, query] = await Promise.all([
    getYouTubeConnection(principal.principal.userId),
    listModerationItems(principal.principal.userId),
    searchParams,
  ]);
  const connection: SafeYouTubeConnection | null = storedConnection
    ? {
        channelId: storedConnection.channelId,
        channelTitle: storedConnection.channelTitle,
        autoReplyEnabled: storedConnection.autoReplyEnabled,
        autoReplyThreshold: storedConnection.autoReplyThreshold,
        replyTemplate: storedConnection.replyTemplate,
        lastScanAt: storedConnection.lastScanAt,
      }
    : null;

  return (
    <ModerationWorkspace
      initialConnection={connection}
      initialItems={items}
      youtubeNotice={query.youtube ?? null}
    />
  );
}
