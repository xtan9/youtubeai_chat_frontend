import { useLayoutEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { ThinkingDots } from "@/components/ui/thinking-dots";
import { InkIcon } from "./ink-icon";
import { getFormats } from "./question-sources";

function Turn({ message, children }) {
  const t = useTranslations("intent");
  const user = message.role === "user";
  return (
    <div className={user ? "turn chat-text user-text" : "turn"}>
      {!user && (
        <div className="assistant-name">
          <span className="avatar">
            <InkIcon name={message.role === "handoff" ? "book" : "layers"} />
          </span>
          {message.role === "handoff"
            ? t("fromResearch")
            : t("projectAssistant")}
        </div>
      )}
      {message.passage && (
        <blockquote>
          {message.passage.title} · “{message.passage.text}”
        </blockquote>
      )}
      {user ? message.text : <p className="chat-text">{message.text}</p>}
      {children}
    </div>
  );
}

export function ProjectChat({
  name,
  w,
  space,
  choosing,
  setChoosing,
  canCancelChoice,
  answer,
  setAnswer,
  interview,

  show,
  destination,
  applyToParagraph,
}) {
  const t = useTranslations("intent");
  const formats = getFormats(t);
  const turns = space.messages.length
    ? space.messages
    : [
        {
          role: "assistant",
          text: t("purpose", { name }),
        },
      ];
  const planning = space.interview;
  const composing = choosing || Boolean(planning);
  const busy = Boolean(interview.busy || w.busy);
  const awaitingDraft = interview.busy === "starter" && Boolean(planning);
  const showDots = w.busy || interview.busy === "interview" || awaitingDraft;
  const activeQuestion = planning && !choosing && !busy && !planning.pending && !planning.brief
    ? turns.findLast(m => m.interviewId === planning.id)
    : null;
  const log = useRef(null);
  useLayoutEffect(() => {
    log.current.scrollTop = log.current.scrollHeight;
  }, [space.messages, choosing, showDots, planning?.quickReplies]);
  const prompt = composing ? answer : w.prompt;
  function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (choosing) void interview.ask(prompt, {});
    else if (planning) void interview.ask(prompt);
    else if (prompt.trim()) void w.send();
  }
  function chooseAgain() {
    w.append({
      role: "assistant",
      text: t(
        "whatWouldYouLikeToMakeThisTimeYourPreviousDraftsAreInTheDirectory",
      ),
    });
    setChoosing(true);
  }
  return (
    <div className="log-wrap">
      <div className="chat-log" aria-live="polite" ref={log}>
        {turns.map((m, i) => {
          const target =
            m.role === "handoff" &&
            destination?.finding?.id === m.finding &&
            destination.draft === w.draft.id &&
            destination.version === w.draft.version;
          return (
            <Turn key={i} message={m}>
              {m === activeQuestion && m.role === "assistant" && (
                planning.quickReplies === undefined ? (
                  <button className="link" type="button"
                    disabled={interview.loadingReplies === planning.turnId}
                    onClick={interview.loadQuickReplies}>
                    {t(interview.loadingReplies === planning.turnId ? "loadingQuickReplies" : "showQuickReplies")}
                  </button>
                ) : planning.quickReplies.length > 0 && (
                  <div className="choices" role="group" aria-label={t("quickReplies")}>
                    {[...new Set(planning.quickReplies)].map(reply => (
                      <button key={reply} type="button" className="choice" disabled={!!prompt.trim()}
                        onClick={() => interview.ask(reply)}>{reply}</button>
                    ))}
                  </div>
                )
              )}
              {(m.role === "handoff" || m.finding) && (
                <div className="chat-action">
                  {target && !composing && (
                    <button
                      className="choice"
                      onClick={applyToParagraph}
                      title={destination.heading}
                    >
                      {t("insertInThisSectionWithCitation")}{" "}
                    </button>
                  )}
                  {m.role === "handoff" && !composing && (
                    <button
                      className="link"
                      disabled={w.busy}
                      onClick={() =>
                        void w.send(
                          t("writeThisFindingIntoTheCurrentDraft"),
                          m.finding,
                          true,
                        )
                      }
                    >
                      {t("writeIntoDraft")}{" "}
                    </button>
                  )}
                  {m.finding && (
                    <button className="link" onClick={() => show(m.finding)}>
                      {t("viewSource")}{" "}
                    </button>
                  )}
                </div>
              )}
              {m.suggestion?.options.map((option, n) => (
                <div className="suggestion" key={n}>
                  <p className="chat-text">{option}</p>
                  <button
                    className="choice"
                    onClick={() => w.apply(m.suggestion, option, m.finding)}
                    disabled={
                      Boolean(composing) ||
                      w.draft.id !== m.suggestion.draft ||
                      w.draft.version !== m.suggestion.version
                    }
                  >
                    {m.suggestion.options.length > 1
                      ? t("useOption") + " " + (n + 1)
                      : t("useThisDraft")}
                  </button>
                </div>
              ))}
            </Turn>
          );
        })}
        {awaitingDraft && (
          <Turn message={{ role: "user", text: t("confirmAndDraft") }} />
        )}
        {showDots ? (
          <div className="chat-pending">
            <ThinkingDots label={awaitingDraft ? t("writingYourDraft") : undefined} />
          </div>
        ) : choosing ? (
          <>
            <div className="choices">
              {Object.entries(formats).map(([key, format]) => (
                <button
                  className="choice"
                  disabled={busy}
                  key={key}
                  onClick={() => interview.ask(format.label, { format: key })}
                >
                  {format.label}
                </button>
              ))}
            </div>
            {canCancelChoice && (
              <button className="link" onClick={() => setChoosing(false)}>
                {t(planning ? "returnToDiscussion" : "returnToWriting")}{" "}
              </button>
            )}
          </>
        ) : (
          <div className="chat-action">
            {planning?.brief && (
              <button
                className="choice"
                disabled={busy || !!prompt.trim()}
                onClick={interview.confirm}
              >
                {t("confirmAndDraft")}
              </button>
            )}
            {planning && space.drafts.some((d) => d.text) && (
              <button
                className="link"
                disabled={busy}
                onClick={interview.returnToDraft}
              >
                {t("returnToWriting")}
              </button>
            )}
            {planning?.pending && !busy && (
              <button className="choice" onClick={interview.retry}>
                {t("retryInterview")}
              </button>
            )}
            <button className="link" disabled={busy} onClick={chooseAgain}>
              {t("tryAnotherPurpose")}{" "}
            </button>
            {!planning && (
              <button
                className="link contextual"
                disabled={w.busy}
                onClick={() =>
                  void w.send(
                    t("continueThisDraftWithAnotherParagraph"),
                    undefined,
                    true,
                  )
                }
              >
                {t("continueWriting")}{" "}
              </button>
            )}
          </div>
        )}
      </div>
      {!composing && w.passage && (
        <blockquote className="quoted-selection">
          {w.passage.title} · “{w.passage.text}”{" "}
          <button className="link" onClick={() => w.setPassage(undefined)}>
            {t("removeSelection")}{" "}
          </button>
        </blockquote>
      )}
      {!composing && w.error && <p role="alert">{w.error}</p>}
      {interview.error && <p role="alert">{interview.error}</p>}
      <form className="composer" onSubmit={submit}>
        <textarea
          aria-label={choosing ? t("answerInYourOwnWords") : t("message")}
          readOnly={interview.busy === "starter"}
          rows={1}
          maxLength={4000}
          value={prompt}
          placeholder={
            choosing
              ? t("orAnswerInYourOwnWords")
              : planning
                ? t(planning.brief ? "correctBrief" : "answerInterview")
                : t("discussAnAngleOrAskMeToKeepWriting")
          }
          onChange={(e) =>
            composing ? setAnswer(e.target.value) : w.setPrompt(e.target.value)
          }
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            )
              submit(e);
          }}
        />
        <button
          className="send"
          disabled={busy}
          aria-label={choosing ? t("sendAnswer") : t("sendMessage")}
        >
          <InkIcon name="up" />
        </button>
      </form>
    </div>
  );
}
