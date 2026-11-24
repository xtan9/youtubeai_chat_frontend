import type {useTranslations} from "next-intl";

// Some older project APIs send an English status sentence without a message ID.
const legacyNotices: Record<string, string> = {
  "Could not reload the Project Conversation.": "reloadThread",
  "Project Conversation response was not valid.": "invalidThread",
  "Could not load Project Conversations.": "loadThreads",
  "Project Conversations response was not valid.": "invalidThreads",
  "Could not load the Project Conversation.": "loadThread",
  "Could not create a Project Conversation.": "createThread",
  "Could not rename the Project Conversation.": "renameThread",
  "Could not clear the Project Conversation.": "clearThread",
  "Could not load earlier Project messages.": "earlierMessages",
  "Could not load earlier Source Set activity.": "earlierActivity",
  "Checking whether the Grounded Answer was saved.": "checkingAnswer",
  "Examining bounded Project passages.": "examiningPassages",
  "Writing the Grounded Answer.": "writingAnswer",
  "Saving the Grounded Answer.": "savingAnswer",
  "Generation stopped. Your question was saved.": "stoppedSaved",
  "Generation stopped before your question was saved.": "stoppedUnsaved",
  "Could not send the question.": "sendQuestion",
  "Empty response from server.": "emptyResponse",
  "The answer stream ended early.": "earlyEnd",
  "Grounded Answer reservation did not match.": "answerMismatch",
  "Grounded Answer complete. Evidence supported.": "completedSupported",
  "Grounded Answer complete. Abstained.": "completedAbstained",
  "Grounded Answer complete. Unsupported by sources.": "completedUnsupported",
  "Project conversations are temporarily unavailable.": "threadsUnavailable",
};

export function projectNotice(t: ReturnType<typeof useTranslations<"project">>, message: string, values?: Record<string, string | number>) {
  const key = legacyNotices[message] ?? message;
  return t.has(key) ? t(key, values) : message;
}
