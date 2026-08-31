"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  ExternalLink,
  LoaderCircle,
  MessageSquareReply,
  Plug,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  UserRound,
  Video,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  ModerationItem,
  ModerationSource,
  SafeYouTubeConnection,
} from "@/lib/comment-moderation/contracts";
import { cn } from "@/lib/utils";

type Props = {
  initialConnection: SafeYouTubeConnection | null;
  initialItems: ModerationItem[];
  youtubeNotice: string | null;
};

type ScanResult = {
  seen: number;
  analyzed: number;
  flagged: number;
  autoReplied: number;
  items: ModerationItem[];
};

async function responseMessage(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as {
    message?: unknown;
  } | null;
  return typeof payload?.message === "string" ? payload.message : fallback;
}

function noticeFor(value: string | null) {
  if (value === "connected") {
    return { tone: "success" as const, text: "YouTube is connected. Run your first scan when you're ready." };
  }
  if (value === "signed-out") {
    return { tone: "error" as const, text: "Your session expired before YouTube could be connected." };
  }
  if (value === "invalid-callback") {
    return { tone: "error" as const, text: "The YouTube connection link was invalid or expired. Try again." };
  }
  if (value === "connection-failed") {
    return { tone: "error" as const, text: "YouTube could not be connected. Confirm access on Google's consent screen and try again." };
  }
  return null;
}

function statusLabel(status: ModerationItem["status"]) {
  return {
    draft: "Needs approval",
    ignored: "No action",
    publishing: "Publishing",
    replied: "Replied",
    failed: "Retry available",
  }[status];
}

function statusBadgeVariant(status: ModerationItem["status"]) {
  if (status === "failed") return "destructive" as const;
  if (status === "replied") return "default" as const;
  return "secondary" as const;
}

function ModerationCard({
  item,
  replying,
  onReply,
}: {
  item: ModerationItem;
  replying: boolean;
  onReply: (item: ModerationItem) => void;
}) {
  const risk = Math.round(item.confidence * 100);
  const isHostile = item.classification === "hostile";
  const canReply = item.status === "draft" || item.status === "failed";
  return (
    <article className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-raised shadow-sm">
      <div className="h-1.5 bg-surface-sunken" aria-hidden="true">
        <div
          className={cn(
            "h-full rounded-r-full transition-[width] duration-slow",
            isHostile ? "bg-accent-danger" : "bg-accent-warning",
          )}
          style={{ width: `${risk}%` }}
        />
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.82fr)] lg:p-6">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isHostile ? "destructive" : "outline"}>
              {isHostile ? "Hostile" : "Sharp criticism"}
            </Badge>
            <Badge variant={statusBadgeVariant(item.status)}>
              {statusLabel(item.status)}
            </Badge>
            <span className="text-caption font-semibold tabular-nums text-text-muted">
              {risk}% confidence
            </span>
          </div>
          <div>
            <p className="mb-2 flex items-center gap-2 text-body-sm font-semibold text-text-secondary">
              <UserRound className="size-4" />
              {item.authorDisplayName}
            </p>
            <blockquote className="border-l-2 border-border-default pl-4 text-body-md leading-relaxed text-text-primary">
              {item.commentText}
            </blockquote>
          </div>
          <div className="flex flex-wrap gap-2">
            {item.reasonCodes.map((reason) => (
              <span
                key={reason}
                className="rounded-full bg-surface-sunken px-2.5 py-1 text-caption text-text-secondary"
              >
                {reason.replaceAll("_", " ")}
              </span>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-col rounded-xl border border-border-subtle bg-surface-sunken/60 p-4">
          <p className="mb-2 flex items-center gap-2 text-body-sm font-semibold text-text-primary">
            <Bot className="size-4 text-accent-brand" />
            Reply preview
          </p>
          <p className="flex-1 whitespace-pre-wrap text-body-sm leading-relaxed text-text-secondary">
            {item.renderedReply}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!canReply || replying}
              onClick={() => onReply(item)}
            >
              {replying ? (
                <LoaderCircle className="animate-spin" />
              ) : item.status === "replied" ? (
                <Check />
              ) : (
                <MessageSquareReply />
              )}
              {replying
                ? "Publishing…"
                : item.status === "replied"
                  ? "Published"
                  : item.status === "failed"
                    ? "Retry reply"
                    : "Approve & reply"}
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link
                href={`https://www.youtube.com/watch?v=${item.youtubeVideoId}&lc=${item.youtubeCommentId}`}
                target="_blank"
                rel="noreferrer"
              >
                Open on YouTube <ExternalLink />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function ModerationWorkspace({
  initialConnection,
  initialItems,
  youtubeNotice,
}: Props) {
  const [connection, setConnection] = useState(initialConnection);
  const [items, setItems] = useState(initialItems);
  const [source, setSource] = useState<ModerationSource>("creator");
  const [videoUrl, setVideoUrl] = useState("");
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(
    initialConnection?.autoReplyEnabled ?? false,
  );
  const [threshold, setThreshold] = useState(
    initialConnection?.autoReplyThreshold ?? 0.92,
  );
  const [template, setTemplate] = useState(
    initialConnection?.replyTemplate ?? "",
  );
  const [busy, setBusy] = useState<"scan" | "settings" | "disconnect" | null>(null);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const notice = useMemo(() => noticeFor(youtubeNotice), [youtubeNotice]);

  const scan = async () => {
    if (!connection || busy) return;
    setBusy("scan");
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/comment-moderation/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, videoUrl: source === "consumer" ? videoUrl : undefined }),
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response, "Comments could not be scanned."));
      }
      const payload = (await response.json()) as ScanResult;
      setItems(payload.items);
      setResult(payload);
      setConnection((current) =>
        current ? { ...current, lastScanAt: new Date().toISOString() } : current,
      );
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Comments could not be scanned.");
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async () => {
    if (!connection || busy) return;
    setBusy("settings");
    setError(null);
    try {
      const response = await fetch("/api/comment-moderation/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoReplyEnabled,
          autoReplyThreshold: threshold,
          replyTemplate: template,
        }),
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response, "Settings could not be saved."));
      }
      const payload = (await response.json()) as { connection: SafeYouTubeConnection };
      setConnection(payload.connection);
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : "Settings could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  const reply = async (item: ModerationItem) => {
    if (replyingId) return;
    setReplyingId(item.id);
    setError(null);
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, status: "publishing" } : entry,
      ),
    );
    try {
      const response = await fetch(
        `/api/comment-moderation/items/${encodeURIComponent(item.id)}/reply`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(await responseMessage(response, "The reply could not be published."));
      }
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, status: "replied" } : entry,
        ),
      );
    } catch (replyError) {
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, status: "failed" } : entry,
        ),
      );
      setError(replyError instanceof Error ? replyError.message : "The reply could not be published.");
    } finally {
      setReplyingId(null);
    }
  };

  const disconnect = async () => {
    if (!connection || busy) return;
    if (!window.confirm("Disconnect YouTube and remove the moderation inbox?")) return;
    setBusy("disconnect");
    setError(null);
    try {
      const response = await fetch("/api/youtube/disconnect", { method: "POST" });
      if (!response.ok) {
        throw new Error(await responseMessage(response, "YouTube could not be disconnected."));
      }
      setConnection(null);
      setItems([]);
      setResult(null);
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "YouTube could not be disconnected.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="min-h-[calc(100vh-8rem)] bg-surface-sunken/30">
      <div className="mx-auto flex w-full max-w-page flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
        <header className="grid gap-6 border-b border-border-subtle pb-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-3xl">
            <p className="mb-3 flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.18em] text-text-muted">
              <ShieldCheck className="size-4 text-accent-brand" />
              Comment shield
            </p>
            <h1 className="text-h2 font-bold tracking-tight text-text-primary sm:text-h1">
              Keep the heat out of your replies.
            </h1>
            <p className="mt-3 max-w-2xl text-body-lg text-text-secondary">
              Scan comments on your channel—or replies to comments you left elsewhere. AI separates attacks from criticism and drafts a calm boundary-setting reply.
            </p>
          </div>
          {connection ? (
            <div className="flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface-raised px-4 py-3 shadow-sm">
              <span className="flex size-9 items-center justify-center rounded-full bg-accent-success/10 text-accent-success">
                <Check className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-caption text-text-muted">Connected channel</p>
                <p className="max-w-56 truncate text-body-sm font-semibold text-text-primary">
                  {connection.channelTitle}
                </p>
              </div>
            </div>
          ) : null}
        </header>

        {notice ? (
          <Alert className={notice.tone === "success" ? "border-accent-success/40" : "border-accent-danger/40"}>
            {notice.tone === "success" ? <Check /> : <AlertTriangle />}
            <AlertTitle>{notice.tone === "success" ? "Connected" : "Connection issue"}</AlertTitle>
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Action needed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!connection ? (
          <Card className="overflow-hidden border-border-default">
            <CardContent className="grid min-h-80 gap-8 p-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.7fr)] lg:items-center lg:p-12">
              <div className="max-w-2xl">
                <span className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-gradient-brand-primary text-white shadow-lg">
                  <Plug className="size-7" />
                </span>
                <h2 className="text-h3 font-semibold text-text-primary">Connect your YouTube identity</h2>
                <p className="mt-3 text-body-md text-text-secondary">
                  YouTube asks for comment-management access in a separate Google consent step. Your refresh token is encrypted before storage and never sent to the browser.
                </p>
                <Button className="mt-6" asChild>
                  <Link href="/api/youtube/oauth/start">
                    Connect YouTube <ChevronRight />
                  </Link>
                </Button>
              </div>
              <div className="rounded-2xl border border-border-subtle bg-surface-sunken p-6">
                <p className="mb-4 text-body-sm font-semibold text-text-primary">Before anything is published</p>
                <ul className="space-y-4 text-body-sm text-text-secondary">
                  <li className="flex gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-success" /> Human approval is the default.</li>
                  <li className="flex gap-3"><SlidersHorizontal className="mt-0.5 size-4 shrink-0 text-accent-brand" /> Auto-reply has a high-confidence threshold.</li>
                  <li className="flex gap-3"><MessageSquareReply className="mt-0.5 size-4 shrink-0 text-accent-warning" /> At most three automatic replies per scan.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(23rem,0.9fr)]">
              <Card>
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-accent-brand/10 text-accent-brand"><ScanSearch /></span>
                    <div>
                      <h2 className="text-h5 font-semibold text-text-primary">Choose what to scan</h2>
                      <p className="mt-1 text-body-sm text-text-muted">Newest comments first, up to 20 unseen replies per scan.</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <Tabs value={source} onValueChange={(value) => setSource(value as ModerationSource)}>
                    <TabsList className="grid h-auto w-full grid-cols-2 p-1">
                      <TabsTrigger value="creator" className="min-h-11"><Video /> My channel</TabsTrigger>
                      <TabsTrigger value="consumer" className="min-h-11"><MessageSquareReply /> Replies to me</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  {source === "consumer" ? (
                    <div className="space-y-2">
                      <Label htmlFor="moderation-video-url">YouTube video URL</Label>
                      <Input
                        id="moderation-video-url"
                        type="url"
                        placeholder="https://www.youtube.com/watch?v=…"
                        value={videoUrl}
                        onChange={(event) => setVideoUrl(event.target.value)}
                      />
                      <p className="text-caption text-text-muted">We will find your top-level comments on this video and inspect their replies.</p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border-subtle bg-surface-sunken/70 p-4 text-body-sm text-text-secondary">
                      Scans recent top-level comments and replies across <strong className="text-text-primary">{connection.channelTitle}</strong>.
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={scan} disabled={busy !== null || (source === "consumer" && !videoUrl.trim())}>
                      {busy === "scan" ? <LoaderCircle className="animate-spin" /> : <ScanSearch />}
                      {busy === "scan" ? "Scanning & classifying…" : "Scan comments"}
                    </Button>
                    {connection.lastScanAt ? (
                      <p className="text-caption text-text-muted">Last scan {new Date(connection.lastScanAt).toLocaleString()}</p>
                    ) : null}
                  </div>
                  {result ? (
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-sunken p-4 sm:grid-cols-4">
                      {[
                        ["Seen", result.seen],
                        ["Analyzed", result.analyzed],
                        ["Flagged", result.flagged],
                        ["Auto-replied", result.autoReplied],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <p className="text-h5 font-semibold tabular-nums text-text-primary">{value}</p>
                          <p className="text-caption text-text-muted">{label}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className={cn(autoReplyEnabled && "border-accent-warning/60")}>
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <span className={cn("flex size-10 items-center justify-center rounded-xl", autoReplyEnabled ? "bg-accent-warning/15 text-accent-warning" : "bg-surface-sunken text-text-muted")}>
                      {autoReplyEnabled ? <ShieldCheck /> : <ShieldOff />}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-4">
                        <h2 className="text-h5 font-semibold text-text-primary">Publishing guardrail</h2>
                        <Switch checked={autoReplyEnabled} onCheckedChange={setAutoReplyEnabled} aria-label="Enable automatic replies" />
                      </div>
                      <p className="mt-1 text-body-sm text-text-muted">
                        {autoReplyEnabled ? "High-confidence hostile comments can be answered during a scan." : "Every reply waits for your approval."}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="confidence-threshold">Minimum confidence</Label>
                      <span className="rounded-md bg-surface-sunken px-2 py-1 text-body-sm font-semibold tabular-nums text-text-primary">{Math.round(threshold * 100)}%</span>
                    </div>
                    <Slider
                      id="confidence-threshold"
                      value={[threshold * 100]}
                      min={80}
                      max={99}
                      step={1}
                      thumbAriaLabel="Automatic reply confidence threshold"
                      onValueChange={(value) => setThreshold((value[0] ?? 92) / 100)}
                    />
                    <p className="text-caption text-text-muted">Only the hostile label qualifies. Criticism always stays in the approval queue.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reply-template">Reply wrapper</Label>
                    <Textarea id="reply-template" rows={5} value={template} onChange={(event) => setTemplate(event.target.value)} />
                    <p className="text-caption text-text-muted">Keep <code>{"{{reply}}"}</code> where the generated response should appear.</p>
                  </div>
                  {autoReplyEnabled ? (
                    <Alert className="border-accent-warning/40 bg-accent-warning/5">
                      <AlertTriangle />
                      <AlertTitle>Automatic public action</AlertTitle>
                      <AlertDescription>YouTube charges 50 quota units per reply. A scan publishes no more than three.</AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={saveSettings} disabled={busy !== null || !template.includes("{{reply}}") }>
                      {busy === "settings" ? <LoaderCircle className="animate-spin" /> : <SlidersHorizontal />}
                      {busy === "settings" ? "Saving…" : "Save guardrail"}
                    </Button>
                    <Button variant="ghost" onClick={disconnect} disabled={busy !== null} className="text-text-muted hover:text-accent-danger">
                      {busy === "disconnect" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                      Disconnect
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-caption font-semibold uppercase tracking-[0.16em] text-text-muted">Review queue</p>
                  <h2 className="mt-1 text-h3 font-semibold text-text-primary">Comments worth a second look</h2>
                </div>
                <p className="text-body-sm text-text-muted">{items.length} flagged {items.length === 1 ? "comment" : "comments"}</p>
              </div>
              {items.length ? (
                <div className="space-y-4">
                  {items.map((item) => (
                    <ModerationCard key={item.id} item={item} replying={replyingId === item.id} onReply={reply} />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border-default bg-surface-raised p-8 text-center">
                  <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-accent-success/10 text-accent-success"><ShieldCheck /></span>
                  <h3 className="text-h5 font-semibold text-text-primary">The queue is clear</h3>
                  <p className="mt-2 max-w-md text-body-sm text-text-muted">Run a scan to check recent comments. Constructive criticism will not be added here.</p>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
