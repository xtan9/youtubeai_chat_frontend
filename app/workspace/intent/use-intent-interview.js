import { useRef, useState } from "react";
import { requestJson } from "@/app/new-workspace/projects/[projectId]/use-space";

function keepDraft(draft) {
  return draft.id !== "opening" || draft.text || draft.markers.length || !draft.defaultTitle;
}

export function useIntentInterview({
  api,
  store,
  locale,
  name,
  t,
  tr,
  onSend,
  onDraft,
}) {
  const { live, update, flush } = store;
  const lock = useRef(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loadingReplies, setLoadingReplies] = useState("");

  async function loadQuickReplies() {
    const turnId = live.current.interview?.turnId;
    if (!turnId || loadingReplies === turnId) return;
    setLoadingReplies(turnId);
    setError("");
    try {
      if (!(await flush())) throw Error("retrySave");
      if (live.current.interview?.turnId !== turnId) return;
      const { quickReplies } = await requestJson(api + "/space", "POST", {
        action: "quickReplies", locale, turnId,
      });
      if (live.current.interview?.turnId === turnId) {
        if (!update(s => ({ ...s, interview: { ...s.interview, quickReplies } }))) throw Error("capacity");
      }
    } catch (e) {
      if (live.current.interview?.turnId === turnId)
        setError(tr.has(e.message) ? tr(e.message) : e.message);
    } finally {
      setLoadingReplies(current => current === turnId ? "" : current);
    }
  }

  async function run(action, prepare) {
    if (lock.current) return;
    lock.current = true;
    setBusy(action);
    setError("");
    try {
      const before = live.current;
      const authorTurn = action === "starter" || Boolean(prepare);
      const purposePrompt = !before.messages.length && action === "interview" && authorTurn;
      const messagesNeeded = 1 + Number(authorTurn) + Number(purposePrompt);
      if (
        before.messages.length + messagesNeeded > 2000 ||
        (action === "starter" && before.drafts.filter(keepDraft).length >= 50)
      )
        throw Error("capacity");
      if (prepare && !prepare()) throw Error("capacity");
      if (!(await flush())) throw Error("retrySave");
      const interview = live.current.interview;
      const result = await requestJson(api + "/space", "POST", {
        action,
        locale,
        turnId: interview.turnId,
        ...(action === "starter" && { confirmBrief: true }),
      });
      if (live.current.interview?.turnId !== interview.turnId) return;
      const message = (role, text) => ({
        role,
        text,
        interviewId: interview.id,
      });
      if (action === "interview") {
        const brief = result.stage === "review" ? result.brief : undefined;
        const accepted = update((s) => ({
          ...s,
          interview: {
            ...interview,
            format: result.format,
            pending: false,
            notes: brief || result.notes,
            quickReplies: result.quickReplies,
            brief,
          },
          messages: [
            ...s.messages,
            message("assistant", brief || result.reply),
          ],
        }));
        if (!accepted) throw Error("capacity");
        // The reply is visible now. The next turn will await the shared save
        // queue before it asks the server to read the updated conversation.
        void flush().then((saved) => {
          if (!saved && live.current.interview?.turnId === interview.turnId)
            setError(tr("retrySave"));
        });
      } else {
        const id = result.format + "/" + interview.id;
        const draft = {
          id,
          title: result.title,
          markers: [],
          text: [
            result.lead,
            ...result.sections.map(
              (section) => "## " + section.heading + "\n" + section.body,
            ),
          ].join("\n\n"),
        };
        const accepted = update((s) => ({
          ...s,
          interview: undefined,
          purpose: result.format,
          activeDraft: id,
          drafts: [...s.drafts.filter(keepDraft), draft],
          messages: [
            ...s.messages,
            message("user", t("confirmAndDraft")),
            message("assistant", result.reply),
          ],
        }));
        if (!accepted) throw Error("capacity");
        if (!(await flush())) throw Error("retrySave");
        onDraft(id);
      }
    } catch (e) {
      setError(tr.has(e.message) ? tr(e.message) : e.message);
    } finally {
      setBusy("");
      lock.current = false;
    }
  }

  function ask(input, newPurpose) {
    const text = input.trim();
    if (!text) return;
    return run("interview", () => {
      const previous = newPurpose ? undefined : live.current.interview;
      const id = previous?.id ?? crypto.randomUUID();
      const saved = update((s) => ({
        ...s,
        interview: {
          id,
          turnId: crypto.randomUUID(),
          format: previous?.format ?? newPurpose?.format,
          notes: previous?.notes ?? "",
          pending: true,
        },
        messages: [
          ...s.messages,
          ...(!s.messages.length
            ? [{ role: "assistant", text: t("purpose", { name }) }]
            : []),
          { role: "user", text, interviewId: id },
        ],
      }));
      if (saved) onSend();
      return saved;
    });
  }
  return {
    ask,
    loadQuickReplies,
    loadingReplies,
    busy,
    error,
    returnToDraft() {
      if (lock.current) return;
      if (update((s) => ({ ...s, interview: undefined }))) {
        setError("");
        onDraft(live.current.activeDraft || live.current.drafts[0].id);
      }
    },
    retry: () => run("interview"),
    // Claim this confirmed revision before paying for generation. Competing tabs
    // must pass the same compare-and-swap the rest of the project uses.
    confirm: () =>
      run("starter", () =>
        update((s) => ({
          ...s,
          interview: {
            ...s.interview,
            confirmed: true,
            turnId: crypto.randomUUID(),
          },
        })),
      ),
  };
}
