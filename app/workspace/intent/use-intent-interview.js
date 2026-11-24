import { useRef, useState } from "react";
import { requestJson } from "@/app/new-workspace/projects/[projectId]/use-space";

export function useIntentInterview({ api, store, locale, name, t, tr, onSend, onDraft }) {
  const { live, update, flush } = store;
  const lock = useRef(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function run(action, prepare) {
    if (lock.current) return;
    lock.current = true;
    setBusy(action);
    setError("");
    try {
      if (prepare && !prepare()) return;
      if (!await flush()) throw Error("retrySave");
      const interview = live.current.interview;
      const result = await requestJson(api + "/space", "POST", {
        action, locale, turnId: interview.turnId,
        ...(action === "starter" && { confirmBrief: true }),
      });
      if (live.current.interview?.turnId !== interview.turnId) return;
      const message = (role, text) => ({ role, text, interviewId: interview.id });
      if (action === "interview") {
        const brief = result.stage === "review" ? result.brief : undefined;
        update(s => ({
          ...s,
          interview: { ...interview, format: result.format, pending: false, notes: brief || result.notes, brief },
          messages: [...s.messages, message("assistant", brief || result.reply)],
        }));
      } else {
        const id = result.format + "/" + crypto.randomUUID();
        const draft = {
          id, title: result.title, markers: [],
          text: [result.lead, ...result.sections.map(section => "## " + section.heading + "\n" + section.body)].join("\n\n"),
        };
        if (update(s => ({
          ...s, interview: undefined, purpose: result.format, activeDraft: id,
          drafts: [...s.drafts.filter(d => d.id !== "opening" || d.text || d.markers.length || !d.defaultTitle), draft],
          messages: [...s.messages, message("user", t("confirmAndDraft")), message("assistant", result.reply)],
        }))) onDraft(id);
      }
      if (!await flush()) throw Error("retrySave");
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
      const saved = update(s => ({
        ...s,
        interview: {
          id, turnId: crypto.randomUUID(), format: previous?.format ?? newPurpose?.format,
          notes: previous?.notes ?? "", pending: true,
        },
        messages: [
          ...s.messages,
          ...(!s.messages.length ? [{ role: "assistant", text: t("purpose", { name }) }] : []),
          { role: "user", text, interviewId: id },
        ],
      }));
      if (saved) onSend();
      return saved;
    });
  }
  return {
    ask, busy, error,
    returnToDraft() {
      if (lock.current) return;
      if (update(s => ({ ...s, interview: undefined }))) {
        setError("");
        onDraft(live.current.activeDraft || live.current.drafts[0].id);
      }
    },
    retry: () => run("interview"),
    confirm: () => run("starter"),
  };
}
