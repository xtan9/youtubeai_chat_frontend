import { useTranslations } from "next-intl";
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
  answer,
  setAnswer,
  sendIntent,
  choose,
  generating,
  clarify,

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
  const prompt = choosing ? answer : w.prompt;
  function submit(event) {
    event.preventDefault();
    if (choosing) sendIntent(event);
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
      <div className="chat-log" aria-live="polite">
        {turns.map((m, i) => {
          const target =
            m.role === "handoff" &&
            destination?.finding?.id === m.finding &&
            destination.draft === w.draft.id &&
            destination.version === w.draft.version;
          return (
            <Turn key={i} message={m}>
              {(m.role === "handoff" || m.finding) && (
                <div className="chat-action">
                  {target && (
                    <button
                      className="choice"
                      onClick={applyToParagraph}
                      title={destination.heading}
                    >
                      {t("insertInThisSectionWithCitation")}{" "}
                    </button>
                  )}
                  {m.role === "handoff" && (
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
        {choosing ? (
          <>
            {generating && <p role="status">{t("writingYourDraft")}</p>}
            {clarify && (
              <p className="chat-text" role="status">
                {clarify}
              </p>
            )}
            <div className="choices">
              {Object.entries(formats).map(([key, format]) => (
                <button
                  className="choice"
                  disabled={generating}
                  key={key}
                  onClick={() => choose(key, format.label)}
                >
                  {format.label}
                </button>
              ))}
            </div>
            {space.messages.length > 0 && (
              <button className="link" onClick={() => setChoosing(false)}>
                {t("returnToWriting")}{" "}
              </button>
            )}
          </>
        ) : (
          <div className="chat-action">
            <button className="link" onClick={chooseAgain}>
              {t("tryAnotherPurpose")}{" "}
            </button>
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
          </div>
        )}
      </div>
      {!choosing && w.passage && (
        <blockquote className="quoted-selection">
          {w.passage.title} · “{w.passage.text}”{" "}
          <button className="link" onClick={() => w.setPassage(undefined)}>
            {t("removeSelection")}{" "}
          </button>
        </blockquote>
      )}
      {!choosing && w.error && <p role="alert">{w.error}</p>}
      <form className="composer" onSubmit={submit}>
        <textarea
          aria-label={choosing ? t("answerInYourOwnWords") : t("message")}
          rows={1}
          maxLength={choosing ? 600 : 4000}
          value={prompt}
          placeholder={
            choosing
              ? t("orAnswerInYourOwnWords")
              : t("discussAnAngleOrAskMeToKeepWriting")
          }
          onChange={(e) =>
            choosing ? setAnswer(e.target.value) : w.setPrompt(e.target.value)
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
          disabled={generating || w.busy}
          aria-label={choosing ? t("sendAnswer") : t("sendMessage")}
        >
          <InkIcon name="up" />
        </button>
      </form>
    </div>
  );
}
