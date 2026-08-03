"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    const langs =
      typeof navigator !== "undefined" && navigator.languages
        ? Array.from(navigator.languages)
        : [];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrowserLanguage(pickDefaultLanguage(langs, SUPPORTED_LANGUAGE_CODES));
  }, []);

  const { snapshot, start, retry, cancel, isAuthLoading } =
    useYouTubeSummarizer();

  const snapshotMatchesCurrentInput =
    snapshot.status === "idle" ||
    (snapshot.input.video.youtubeUrl === url &&
      snapshot.input.outputLanguage === outputLanguage &&
      snapshot.input.includeTranscript === true);
  const currentSnapshot = snapshotMatchesCurrentInput ? snapshot : null;

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

  const { copied, copyToClipboard } = useClipboard();

  const handleCopySummary = async () => {
    if (currentSnapshot?.status !== "succeeded") return;
    await copyToClipboard(
      `${currentSnapshot.summary.title}\n\n${currentSnapshot.summary.summary}`,
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

  const failure =
    currentSnapshot?.status === "failed" ? currentSnapshot.error : null;
  const failureMessage = failure
    ? getSummaryRunFailureMessage(failure)
    : undefined;
  const draftText =
    currentSnapshot?.status === "running" ||
    currentSnapshot?.status === "failed" ||
    currentSnapshot?.status === "cancelled"
      ? currentSnapshot.draft.text
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

      {(currentSnapshot?.status === "running" ||
        currentSnapshot?.status === "failed" ||
        currentSnapshot?.status === "cancelled") &&
        url && <div className="mb-4 flex justify-end">{languagePicker}</div>}

      {currentSnapshot?.status === "running" && (
        <StreamingProgressIndicator
          progress={currentSnapshot.progress}
          onCancel={cancel}
        />
      )}

      {draftText !== null && <SummaryDraft text={draftText} />}

      {currentSnapshot?.status === "succeeded" && (
        <ResultsDisplay
          data={currentSnapshot.summary}
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

  const chatLocked = currentSnapshot?.status !== "succeeded";
  const chatPermanentlyLocked =
    currentSnapshot?.status === "failed" ||
    currentSnapshot?.status === "cancelled";
  const completedSummary =
    currentSnapshot?.status === "succeeded"
      ? currentSnapshot.summary
      : undefined;
  const completedTranscript =
    currentSnapshot?.status === "succeeded"
      ? currentSnapshot.transcript
      : undefined;

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
                <ChatTab
                  youtubeUrl={url || null}
                  active={!chatLocked}
                  transcriptTimingStatus={completedTranscript?.status}
                />
              }
            />
          </div>
          <div className="sticky top-[138px] w-full">
            <YoutubeVideo
              url={url}
              width={600}
              segments={completedSummary?.segments}
              transcriptSource={completedSummary?.transcriptSource}
              transcriptState={completedTranscript}
              streamingComplete={currentSnapshot?.status === "succeeded"}
            />
          </div>
        </div>
      </div>
    </PlayerRefProvider>
  );
}
