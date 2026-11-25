import { useRef, useState } from "react";
import { requestJson } from "@/app/new-workspace/projects/[projectId]/use-space";

import { reviseOutline, writeOutlineBody } from "@/lib/video-space/outline-manuscript";

function keepDraft(draft) {
  return draft.id !== "opening" || draft.text || draft.markers.length || !draft.defaultTitle;
}

// Keep a question's identity and research when a revised outline reuses it.
function saveVideoOutline(space, interview, result) {
  const questions = [...(space.questions || [])];
  const existing = space.drafts.find(d => d.outline?.interviewId === interview.id);
  const remaining = new Set(existing?.outline.sections || []);
  const sections = result.sections.map(({ id, heading, note, questions: titles }) => {
    const questionIds = titles.map(({ title, startingPoint }) => {
      let q = questions.find(item => item.title === title);
      if (!q) {
        q = { id: crypto.randomUUID(), title, startingPoint };
        questions.push(q);
      } else if (q.startingPoint !== startingPoint) {
        questions[questions.indexOf(q)] = { ...q, startingPoint };
      }
      return q.id;
    });
    const old = [...remaining].find(s => id && s.id === id) ??
      [...remaining].find(s => s.heading === heading);
    if (old) remaining.delete(old);
    return { ...old, id: old?.id ?? crypto.randomUUID(), heading, note: note ?? old?.note, questionIds: [...new Set(questionIds)] };
  });
  if (questions.length > 150) throw Error("capacity");
  const id = existing?.id ?? "outline/" + interview.id;
  const outline = reviseOutline({ ...(existing ?? { id, text: "", markers: [] }), title: result.title }, sections, result.angle, interview.id);
  const drafts = space.drafts.filter(keepDraft);
  return { ...space, questions, purpose: "video", interview: undefined,
    drafts: drafts.some(d => d.id === id) ? drafts.map(d => d.id === id ? outline : d) : [...drafts, outline] };
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

  async function run(action, prepare, outlineRequest) {
    if (lock.current) return;
    lock.current = true;
    setBusy(action);
    setError("");
    try {
      const before = live.current;
      const writing = action !== "interview";
      const authorTurn = writing || Boolean(prepare);
      const purposePrompt = !before.messages.length && action === "interview" && authorTurn;
      const messagesNeeded = 1 + Number(authorTurn) + Number(purposePrompt);
      if (
        before.messages.length + messagesNeeded > 2000 ||
        (writing && !outlineRequest && before.drafts.filter(keepDraft).length >= 50)
      )
        throw Error("capacity");
      if (prepare && !prepare()) throw Error("capacity");
      const requestedInterview = live.current.interview;
      const initialOutline = before.drafts.find(d => d.outline && d.outline.interviewId === requestedInterview?.id);
      const startUrl = window.location.href;
      if (!(await flush())) throw Error("retrySave");
      const interview = live.current.interview;
      const result = await requestJson(api + "/space", "POST", {
        action,
        locale,
        ...(outlineRequest || { turnId: interview.turnId }),
        ...(action === "starter" && { confirmBrief: true }),
      });
      if (outlineRequest) {
        const current = live.current.drafts.find(d => d.id === outlineRequest.outlineId);
        if (current?.version !== outlineRequest.version) throw Error("interviewChanged");
      } else if (live.current.interview?.turnId !== interview.turnId) return;
      // Save a completed draft even if the author has since opened a question or another draft.
      // changeDraft records the new active draft only when we also reveal it on screen.
      const stillHere = window.location.href === startUrl && live.current.activeDraft === before.activeDraft;
      const message = (role, text) => ({
        role,
        text,
        interviewId: interview?.id,
      });
      if (action === "interview" && result.stage === "outline") {
        const previous = live.current.drafts.find(d => d.outline?.interviewId === interview.id);
        if (previous && previous.version !== initialOutline?.version) throw Error("interviewChanged");
        const accepted = update(s => ({
          ...saveVideoOutline(s, interview, result),
          messages: [...s.messages, message("assistant", t("outlineReady"))],
        }));
        if (!accepted) throw Error("capacity");
        if (stillHere) onDraft(previous?.id ?? "outline/" + interview.id);
        if (!(await flush())) throw Error("retrySave");
      } else if (action === "interview") {
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
        const id = outlineRequest?.outlineId ?? result.format + "/" + interview.id;
        const draft = {
          id,
          title: result.title,
          markers: result.markers ?? [],
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
          drafts: outlineRequest
            ? s.drafts.map(d => d.id === id ? writeOutlineBody(d, outlineRequest.section, result) : d)
            : [...s.drafts.filter(keepDraft), draft],
          messages: [
            ...s.messages,
            message("user", t(outlineRequest ? (outlineRequest.section === undefined ? "writeVideoScript" : "writeOutlineSection") : "confirmAndDraft")),
            message("assistant", result.reply),
          ],
        }));
        if (!accepted) throw Error("capacity");
        if (stillHere) onDraft(id);
        if (!(await flush())) throw Error("retrySave");
      }
    } catch (e) {
      setError(tr.has(e.message) ? tr(e.message) : e.message);
    } finally {
      setBusy("");
      lock.current = false;
    }
  }

  function ask(input, newPurpose, outline) {
    const text = input.trim();
    if (!text) return;
    return run("interview", () => {
      const previous = newPurpose ? undefined : live.current.interview;
      const id = previous?.id ?? outline?.interviewId ?? crypto.randomUUID();
      const saved = update((s) => ({
        ...s,
        interview: {
          id,
          turnId: crypto.randomUUID(),
          format: previous?.format ?? newPurpose?.format ?? (outline ? "video" : undefined),
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
    writeOutline(draft, section) {
      // Claim the saved snapshot using the store's revision check before paying for generation.
      const version = crypto.randomUUID();
      return run("draftOutline", () => {
        if (live.current.drafts.find(d => d.id === draft.id)?.version !== draft.version) throw Error("interviewChanged");
        return update(s => ({ ...s, drafts: s.drafts.map(d => d.id === draft.id ? { ...d, version } : d) }));
      }, { outlineId: draft.id, version, section });
    },
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
