"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useYouTubeSummarizer } from "@/lib/hooks/useYouTubeSummarizer";
import { useClipboard } from "@/lib/hooks/useClipboard";
import { AuthErrorBanner } from "./auth-error-banner";
import { ResultsDisplay } from "./results-display";
import { SummaryDraft } from "./summary-draft";
import { StreamingProgressIndicator } from "./streaming-progress";
import { StreamErrorBanner } from "./stream-error-banner";
import { LanguagePicker } from "./language-picker";
import { SummaryTabs } from "./summary-tabs";
import { ChatTab } from "./chat-tab";
import { PlayerRefProvider } from "@/lib/contexts/player-ref";
import { UpgradeCard } from "@/components/paywall/UpgradeCard";
import {
  SUPPORTED_LANGUAGE_CODES,
  type SupportedLanguageCode,
} from "@/lib/constants/languages";
import { pickDefaultLanguage } from "@/lib/utils/browser-locale";
import YoutubeVideo from "./youtube-video";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { Button } from "@/components/ui/button";
import { getSummaryRunFailureMessage } from "@/lib/summary-run";

interface YouTubeSummarizerAppProps {
  initialUrl: string | undefined;
}

export function YouTubeSummarizerApp({
  initialUrl,
}: YouTubeSummarizerAppProps) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [url, setUrl] = useState(initialUrl || "");
  const [outputLanguage, setOutputLanguage] =
    useState<SupportedLanguageCode | null>(null);
  const [browserLanguage, setBrowserLanguage] =
    useState<SupportedLanguageCode>("en");
  const analyticsOutcomeRef = useRef<string | null>(null);

  useEffect(() => {
    const langs =
      typeof navigator !== "undefined" && navigator.languages
        ? Array.from(navigator.languages)
        : [];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrowserLanguage(pickDefaultLanguage(langs, SUPPORTED_LANGUAGE_CODES));
  }, []);

  const { snapshot, start, retry, isAnonymous, isAuthLoading } =
    useYouTubeSummarizer();

  // Each effect execution is one explicit Summary Run start. The controller
  // captures the URL, language, and transcript preference before any async
  // work begins, and replaces/cancels an older run when language changes.
  useEffect(() => {
    if (!url || isAuthLoading) return;
    void start({
      video: { youtubeUrl: url },
      outputLanguage,
      includeTranscript: true,
    });
  }, [isAuthLoading, outputLanguage, start, url]);

  useEffect(() => {
    const accountType = isAnonymous ? "anonymous" : "registered";
    const outputLanguageProperty = outputLanguage ?? "video_native";

    if (snapshot.status === "failed") {
      const outcomeKey = `failed:${snapshot.runId}`;
      if (analyticsOutcomeRef.current === outcomeKey) return;
      analyticsOutcomeRef.current = outcomeKey;
      const { error } = snapshot;
      captureAnalyticsEvent("summary_failed", {
        account_type: accountType,
        source_surface: "summary",
        output_language: outputLanguageProperty,
        failure_category:
          error.kind === "quota"
            ? "quota"
            : error.kind === "authentication"
              ? "auth"
              : error.kind === "rate_limit"
                ? "rate_limit"
                : error.kind === "processing" || error.kind === "protocol"
                  ? "processing"
                  : "request",
        error_code: error.code ?? "summary_run_failed",
        ...(error.status !== undefined ? { http_status: error.status } : {}),
      });
      return;
    }

    if (snapshot.status === "succeeded") {
      const outcomeKey = `succeeded:${snapshot.runId}`;
      if (analyticsOutcomeRef.current === outcomeKey) return;
      analyticsOutcomeRef.current = outcomeKey;
      captureAnalyticsEvent("summary_succeeded", {
        account_type: accountType,
        source_surface: "summary",
        result_origin: snapshot.origin,
        output_language: outputLanguageProperty,
        transcription_seconds: snapshot.summary.transcriptionTime,
        summary_seconds: snapshot.summary.summaryTime,
        total_seconds:
          snapshot.summary.transcriptionTime + snapshot.summary.summaryTime,
      });
    }
  }, [isAnonymous, outputLanguage, snapshot]);

  const { copied, copyToClipboard } = useClipboard();

  const handleCopySummary = async () => {
    if (snapshot.status !== "succeeded") return;
    await copyToClipboard(
      `${snapshot.summary.title}\n\n${snapshot.summary.summary}`,
    );
  };

  const handleNewSummary = () => {
    setUrl("");
    router.push("/");
  };

  const handleLanguageSelect = (code: SupportedLanguageCode) => {
    if (code === outputLanguage) return;
    setOutputLanguage(code);
  };

  const failure = snapshot.status === "failed" ? snapshot.error : null;
  const failureMessage = failure
    ? getSummaryRunFailureMessage(failure)
    : undefined;
  const draftText =
    snapshot.status === "running" ||
    snapshot.status === "failed" ||
    snapshot.status === "cancelled"
      ? snapshot.draft.text
      : null;

  const languagePicker = (
    <LanguagePicker
      currentLanguage={outputLanguage}
      browserLanguage={browserLanguage}
      onSelect={handleLanguageSelect}
      isDark={isDark}
      disabled={false}
    />
  );

  const summaryContent = (
    <>
      {failure?.kind === "quota" ? (
        <UpgradeCard variant="summary-cap" />
      ) : failure?.kind === "authentication" ? (
        <AuthErrorBanner authError={failureMessage} />
      ) : failure ? (
        <StreamErrorBanner
          message={failureMessage ?? ""}
          errorId={failure.code}
        />
      ) : null}

      {failure && (
        <div className="mb-5 flex justify-end">
          <Button
            type="button"
            variant="outline"
            data-testid="summary-retry"
            onClick={() => void retry()}
          >
            Retry summary
          </Button>
        </div>
      )}

      {(snapshot.status === "running" ||
        snapshot.status === "failed" ||
        snapshot.status === "cancelled") &&
        url && <div className="mb-4 flex justify-end">{languagePicker}</div>}

      {snapshot.status === "running" && (
        <StreamingProgressIndicator progress={snapshot.progress} />
      )}

      {draftText !== null && <SummaryDraft text={draftText} />}

      {snapshot.status === "succeeded" && (
        <ResultsDisplay
          data={snapshot.summary}
          copied={copied}
          onCopySummary={handleCopySummary}
          onNewSummary={handleNewSummary}
          outputLanguage={outputLanguage}
          browserLanguage={browserLanguage}
          onSelectLanguage={handleLanguageSelect}
          languageDisabled={false}
        />
      )}
    </>
  );

  const chatLocked = snapshot.status !== "succeeded";
  const chatPermanentlyLocked =
    snapshot.status === "failed" || snapshot.status === "cancelled";
  const completedSummary =
    snapshot.status === "succeeded" ? snapshot.summary : undefined;

  return (
    <PlayerRefProvider>
      <div className="mx-auto max-w-page px-4 py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SummaryTabs
              chatLocked={chatLocked}
              chatPermanentlyLocked={chatPermanentlyLocked}
              summaryContent={summaryContent}
              chatContent={
                <ChatTab youtubeUrl={url || null} active={!chatLocked} />
              }
            />
          </div>
          <div className="sticky top-[138px] w-full">
            <YoutubeVideo
              url={url}
              width={600}
              segments={completedSummary?.segments}
              transcriptSource={completedSummary?.transcriptSource}
              streamingComplete={snapshot.status === "succeeded"}
            />
          </div>
        </div>
      </div>
    </PlayerRefProvider>
  );
}
