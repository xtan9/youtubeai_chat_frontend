"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { defaultDraftTitle, resourceSchema } from "@/lib/video-space/contract";
import { HighlightTranslation } from "@/app/summary/components/highlight-translation";
import { pickDefaultLanguage } from "@/lib/utils/browser-locale";
import { SUPPORTED_LANGUAGE_CODES } from "@/lib/constants/languages";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Plus,
  PanelLeftClose,
  PanelRightClose,
  PanelLeftOpen,
  PanelRightOpen,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Library } from "@/app/workspace/projects/[projectId]/library";
import { ClaimLinks } from "@/app/workspace/projects/[projectId]/source-claims";
import {
  ClaimRoom,
  ClaimRoomHeader,
} from "@/app/workspace/projects/[projectId]/claim-room";
import { useWriting } from "@/app/workspace/projects/[projectId]/writing";
import { groupClaimSpaces } from "@/lib/video-space/claim-spaces";

import { getFormats, answerId, researchRecords } from "./question-sources";
import {
  requestJson,
  SpaceRequestError,
} from "@/app/workspace/projects/[projectId]/use-space";
import { Document, paragraphRanges } from "./document";
import { InkIcon } from "./ink-icon";
import { useIntentInterview } from "./use-intent-interview";
import { reviseOutline, writeOutlineBody } from "@/lib/video-space/outline-manuscript";
import { VideoOutline } from "./video-outline";
import { ProjectChat } from "./project-chat";
import { FindingList } from "./finding-list";
import {
  QuestionList,
  QuestionSheet,
  ResearchSource,
  ResearchSourceList,
} from "./question-research";

const EMPTY_HISTORY = [];

export function IntentDesk({ name, projectId, store, initial, onSourcesChange, onResearch }) {
  const t = useTranslations("intent");
  const formats = getFormats(t);
  const activeTabName = {
    side: t("drafts"),
    paper: t("editor"),
    chat: t("projectAssistant"),
    room: t("claimResearch"),
  };

  const api = "/api/projects/" + projectId;
  const { space, live, update, flush, status, attachPdf } = store;
  const locale = useLocale();
  const tr = useTranslations("ui");
  const params = useSearchParams();
  const route = Object.fromEntries(params.entries());
  const versions = initial.history ?? EMPTY_HISTORY;
  const [pending, setPending] = useState("");
  const [failure, setFailure] = useState({});
  const lock = useRef(false);
  const { runs, sources: aiSources } = useMemo(
    () => researchRecords(versions, t),
    [versions, t],
  );
  const projectQuestions = (space.questions || []).map((q) => {
    const version = versions.find(
      (v) =>
        v.document.space?.questionId === q.id &&
        v.document.space.questionRevision === q.revision &&
        v.document.question === q.title,
    );
    return { ...q, versionId: version?.id };
  });
  function setProjectQuestions(change) {
    return update(s => {
      const previous = s.questions || [];
      const questions = change(previous);
      const current = new Map(questions.map(q => [q.id, q]));
      const changed = new Set(previous.filter(q => current.get(q.id) !== q).map(q => q.id));
      // A script in flight must still match the questions and findings the author sees.
      const drafts = s.drafts.map(d => {
        const outline = d.outline;
        if (!outline || ![...outline.sections, ...(outline.removed ?? [])].some(
          section => section.questionIds.some(id => changed.has(id)))) return d;
        const keepQuestions = section => ({
          ...section, questionIds: section.questionIds.filter(id => current.has(id)),
        });
        return { ...d, version: crypto.randomUUID(), outline: { ...outline,
          sections: outline.sections.map(keepQuestions), removed: outline.removed?.map(keepQuestions) } };
      });
      return { ...s, questions, drafts };
    });
  }
  const libraryTitle = t("questionsAndSources");
  const returnMarker = useRef(null);
  const fresh =
    !space.interview && !space.purpose &&
    !space.drafts.some((d, i) => d.text || defaultDraftTitle(d, i) === null);
  const [mobile, setMobile] = useState(
    route.claim || route.source !== undefined || (route.finding && !route.question)
      ? "room"
      : route.question
        ? "paper"
        : fresh || space.interview
          ? "chat"
          : "paper",
  );
  const [materials, setMaterials] = useState(true);
  const [changePurpose, setChoosing] = useState(false),
    [answer, setAnswer] = useState("");
  const [view, setView] = useState("rich"),
    [adding, setAdding] = useState(false),
    [showExcerpt, setShowExcerpt] = useState(false);
  const [questions, setQuestions] = useState({}),
    [targets, setTargets] = useState({});
  const [destination, setDestination] = useState(null);
  const [fold, setFold] = useState({ side: false, chat: false }),
    [focus, setFocus] = useState(null);
  function panelControls(id) {
    const title =
        id === "side" && showMaterials ? libraryTitle : activeTabName[id],
      Fold = id === "side" ? PanelLeftClose : PanelRightClose,
      Expand = id === "side" ? PanelLeftOpen : PanelRightOpen;
    if (fold[id])
      return (
        <button
          className="rail"
          aria-label={t("expand") + title}
          title={t("expand") + title}
          onClick={() => setFold((old) => ({ ...old, [id]: false }))}
        >
          <Expand size={16} />
          <span>{title}</span>
        </button>
      );
    return (
      <div className="panel-controls">
        {!focus && (
          <button
            aria-label={t("collapse") + title}
            title={t("collapse") + title}
            onClick={() => setFold((old) => ({ ...old, [id]: true }))}
          >
            <Fold size={14} />
          </button>
        )}
        <button
          aria-label={
            focus === id ? t("restoreWorkspace") : t("focusOn") + title
          }
          title={focus === id ? t("restoreWorkspace") : t("focusOn") + title}
          onClick={() => setFocus(focus === id ? null : id)}
        >
          {focus === id ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
    );
  }
  const left = useRef(null),
    deskReturn = useRef(null);
  const w = useWriting({ space, live, update, api, versions });
  const [bodyFocus, setBodyFocus] = useState(null);
  const [outlineError, setOutlineError] = useState("");
  const [outlineChatDraft, setOutlineChatDraft] = useState(null);
  const requiresPurpose = !space.interview && !w.draft.outline && !w.draft.text.trim() && !formats[w.draft.id.split("/")[0]];
  const choosing = changePurpose || requiresPurpose;
  const index = useMemo(
    () =>
      groupClaimSpaces(
        space.resources,
        space.customClaims,
        versions.filter((v) => !v.document.space?.questionId),
        space.researchAttempts,
      ),
    [space.resources, space.customClaims, space.researchAttempts, versions],
  );

  const materialClaims = useMemo(
    () => new Map([...index.bySource].filter(([id]) => id)),
    [index],
  );
  const room =
      index.rooms.get(route.claim) ||
      (!route.question && !route.source
        ? index.byFinding.get(route.finding)
        : undefined),
    inRoom = !!room || !!route.claim || (!!route.finding && !route.question) || route.source !== undefined,
    selected = room?.versions.find((v) => v.id === route.finding);
  const currentQuestion = projectQuestions.find((q) => q.id === route.question);
  const historicRun = route.question && runs[route.finding];
  const archived = Boolean(
    historicRun?.question?.id === route.question &&
      route.question &&
      (!currentQuestion ||
        currentQuestion.gap ||
        answerId(currentQuestion) !== route.finding),
  );
  const projectQuestion = archived ? historicRun.question : currentQuestion;
  const activeRun =
    projectQuestion &&
    (!archived && projectQuestion.gap
      ? { question: { ...projectQuestion, answer: "" }, context: [] }
      : runs[answerId(projectQuestion)]);
  const researchSource = aiSources.find((s) => s.id === route.source);
  const written =
    projectQuestion &&
    w.draft.markers.some((m) => m.finding === answerId(projectQuestion));
  const linkedExcerpt = activeRun?.question.references?.includes(route.excerpt)
    ? route.excerpt
    : undefined;
  const currentFinding = selected || room?.versions.at(-1);
  const selectedSource = space.resources.find((r) => r.id === route.source);
  const docs = space.drafts.filter(
    (d) => d.id !== "blank" || d.text || space.drafts.length > 1,
  );
  const question = questions[room?.id] || "";
  function showRoute(next, method = "pushState") {
    const url = new URL(location.href);
    for (const k of [
      "claim",
      "finding",
      "source",
      "question",
      "excerpt",
      "section",
      "draft",
    ]) {
      url.searchParams.delete(k);
      if (next[k] !== undefined) url.searchParams.set(k, next[k]);
    }
    if (url.href !== location.href) history[method](null, "", url);
    setFocus(null);

    setMobile(next.claim || next.source !== undefined || (next.finding && !next.question) ? "room" : "paper");
  }
  useEffect(() => {
    function readRoute() {
      const next = Object.fromEntries(new URLSearchParams(location.search));

      setMobile(next.claim || next.source !== undefined || (next.finding && !next.question) ? "room" : "paper");
    }
    window.addEventListener("popstate", readRoute);
    return () => window.removeEventListener("popstate", readRoute);
  }, []);
  useLayoutEffect(() => {
    if (!inRoom && deskReturn.current) {
      const previous = deskReturn.current;
      deskReturn.current = null;
      if (left.current) left.current.scrollTop = previous.scroll;
      if (previous.trigger?.isConnected)
        previous.trigger.focus({ preventScroll: true });
    }
  }, [inRoom]);
  function openClaim(id, paragraph = null) {
    if (!inRoom)
      deskReturn.current = {
        scroll: left.current?.scrollTop || 0,
        trigger: document.activeElement,
      };
    setDestination(paragraph ? { ...paragraph, claim: id } : null);
    showRoute({ claim: id });
  }
  function openQuestion(q, section) {
    setMaterials(true);
    setDestination(null);
    showRoute({ question: q.id, section });
  }

  function saveQuestion(id, title) {
    const key = id || crypto.randomUUID();
    const ok = setProjectQuestions((items) =>
      id
        ? items.map((q) =>
            q.id === id && q.title !== title
              ? { ...q, title, revision: crypto.randomUUID(), gap: undefined, startingPoint: undefined }
              : q,
          )
        : [...items, { id: key, title }],
    );
    if (ok) openQuestion({ id: key });
  }
  function removeQuestion(q) {
    setProjectQuestions((items) => items.filter((item) => item.id !== q.id));
    if (route.question === q.id) {
      showRoute({}, "replaceState");
      setMobile("side");
    }
  }
  async function investigate(question, context, key, retry) {
    if (lock.current || initial.history === null) return;
    lock.current = true;
    setPending(key);
    setFailure((old) => ({ ...old, [key]: "" }));
    try {
      if (!(await flush())) return;
      const result = await requestJson(api + "/research", "POST", {
        question,
        baseVersionId: versions[0]?.id || null,
        space: context,
      });
      onResearch(result.versions[0]);
      if (context.questionId)
        setProjectQuestions((items) =>
          items.map((q) =>
            q.id === key &&
            q.revision === context.questionRevision &&
            q.title === question
              ? { ...q, gap: undefined }
              : q,
          ),
        );
      if (retry)
        update((s) => ({
          ...s,
          researchAttempts: s.researchAttempts?.filter(
            (a) => a.id !== retry.id,
          ),
        }));
      return result.versions[0];
    } catch (err) {
      const gap = err instanceof SpaceRequestError && err.status === 422;
      const message = tr.has(err.message) ? tr(err.message) : err.message;
      if (context.questionId && gap)
        setProjectQuestions((items) =>
          items.map((q) =>
            q.id === key &&
            q.revision === context.questionRevision &&
            q.title === question
              ? { ...q, gap: message.slice(0, 1000) }
              : q,
          ),
        );
      else if (!context.questionId)
        update((s) => ({
          ...s,
          researchAttempts: [
            ...(s.researchAttempts || [])
              .filter((a) => a.id !== retry?.id)
              .slice(-149),
            {
              id: retry?.id || crypto.randomUUID(),
              question,
              claimId: key,
              origin: context.origin,
              parent: context.followUpTo,
              message: err.message.slice(0, 1000),
              evidenceGap: gap,
              created: new Date().toISOString(),
            },
          ],
        }));
      else setFailure((old) => ({ ...old, [key]: message }));
    } finally {
      lock.current = false;
      setPending("");
    }
  }
  function startResearch(q) {
    const background = space.resources.slice(0, 8).map((m) => ({
      title: m.title.slice(0, 140),
      excerpt: (m.pages[0]?.text || m.digest?.summary || "").slice(0, 320),
    }));
    return investigate(
      q.title,
      {
        questionId: q.id,
        questionRevision: q.revision,
        hypothesis: q.hypothesis,
        background,
      },
      q.id,
    );
  }
  function show(id, excerpt, draft) {
    const q = runs[id]?.question;
    if (q) {
      showRoute({
        question: q.id,
        draft,
        finding: id,
        excerpt: excerpt || q.references[0],
      });
      return;
    }
    const r = index.byFinding.get(id);
    if (r) showRoute({ claim: r.id, finding: id });
  }
  function insertionTargets() {
    const targets = paragraphRanges(w.draft.text)
      .filter((r) => r.chunk.startsWith("## "))
      .map((r) => ({
        value: String(r.start),
        label: r.chunk.split("\n")[0].slice(3),
        offset: r.start + r.chunk.length,
      }));
    return [
      ...targets,
      { value: "end", label: t("endOfDraft"), offset: w.draft.text.length },
    ];
  }
  function returnToDraft(q) {
    const target = space.drafts.find((d) => d.id === route.draft) || w.draft;
    if (q && target.markers.some((m) => m.finding === answerId(q))) {
      if (target.id !== w.draft.id) w.changeDraft(target.id);
      returnMarker.current = answerId(q);
      setView(current => current === "source" ? "rich" : current);
    }
    showRoute({});
  }
  function writeAnswer(target) {
    const q = projectQuestion,
      d = w.draft;
    if (archived || !activeRun?.question.answer) return;
    if (!d.markers.some((m) => m.finding === answerId(q))) {
      const position = insertionTargets().find((t) => t.value === target);
      if (!position) return;
      w.apply(
        { draft: d.id, version: d.version, start: position.offset, length: 0 },
        activeRun.question.answer,
        answerId(q),
      );
      if (
        !live.current.drafts
          .find((doc) => doc.id === d.id)
          ?.markers.some((m) => m.finding === answerId(q))
      )
        return;
    }
    returnMarker.current = answerId(q);
    setView(current => current === "source" ? "rich" : current);
    showRoute({});
  }
  function focusReturnedMarker(marker) {
    if (!marker || !returnMarker.current || marker.dataset.answerId !== returnMarker.current) return;
    marker.focus({ preventScroll: true });
    marker.scrollIntoView({ block: "nearest" });
    returnMarker.current = null;
  }
  function toChat() {
    if (inRoom) showRoute({});
    setFocus(null);
    setFold((old) => ({ ...old, chat: false }));
    setMobile("chat");
  }

  const interview = useIntentInterview({
    api, store, locale, name, t, tr,
    onSend() {
      setChoosing(false);
      setAnswer("");
      toChat();
    },
    onDraft(id) {
      setOutlineChatDraft(null);
      w.changeDraft(id);
      setView("rich");
      setDestination(null);
      showRoute({});
    },
  });
  const writingOutline = interview.busy === "draftOutline";
  const canStartQuestionResearch = !pending && !writingOutline && initial.history !== null;
  const researchStatus = pending
    ? t(pending === projectQuestion?.id ? "searchingAndCheckingSources" : "anotherInvestigationInProgress")
    : writingOutline ? t("researchAfterDraft") : "";
  function research(q, parent, retry) {
    return investigate(
      q,
      {
        claimId: room.id,
        claimTitle: room.title,
        origin: room.origin,
        followUpTo: parent,
      },
      room.id,
      retry,
    );
  }
  const roomRef = useRef(null);
  const discussionLock = useRef(false);
  const [chatBusy, setChatBusy] = useState(false);
  async function discuss(q, finding) {
    if (
      !room ||
      discussionLock.current ||
      !q.trim() ||
      initial.history === null
    )
      return;
    if ((live.current.claimDiscussion?.length || 0) >= 2000) {
      setFailure((prev) => ({ ...prev, [room.id]: tr("discussionFull") }));
      return;
    }
    discussionLock.current = true;
    setFailure((prev) => ({ ...prev, [room.id]: "" }));
    const key = room.id;
    setChatBusy(true);
    try {
      const history = (space.claimDiscussion || [])
        .filter((t) => t.claimId === key)
        .slice(-6)
        .map(({ question, reply }) => ({ question, reply }));
      const { reply } = await requestJson(api + "/space", "POST", {
        action: "discussClaim",
        question: q,
        claim: room.title,
        origin: room.origin?.quote,
        history,
        finding:
          finding && JSON.stringify(finding.document.synthesis).slice(0, 12000),
      });
      const accepted = update((s) => ({
        ...s,
        claimDiscussion: [
          ...(s.claimDiscussion || []),
          {
            id: crypto.randomUUID(),
            claimId: key,
            question: q,
            reply,
            created: new Date().toISOString(),
            finding: finding?.id,
          },
        ],
      }));
      if (!accepted) throw Error("discussionSave");
      setQuestions((prev) => (prev[key] === q ? { ...prev, [key]: "" } : prev));
      await flush();
    } catch (e) {
      setFailure((prev) => ({
        ...prev,
        [key]: tr.has(e.message) ? tr(e.message) : e.message,
      }));
    } finally {
      discussionLock.current = false;
      setChatBusy(false);
    }
  }
  function handoff(v) {
    if (!space.messages.some((m) => m.role === "handoff" && m.finding === v.id))
      w.append({
        role: "handoff",
        text: v.document.question + "\n" + v.document.synthesis.judgment.text,
        finding: v.id,
      });
    if (destination?.claim === v.document.space?.claimId)
      setDestination({ ...destination, finding: v });
    showRoute({});
    setFold((old) => ({ ...old, chat: false }));
    setMobile("chat");
    setChoosing(false);
  }
  function applyToParagraph() {
    const v = destination.finding;
    w.apply(
      {
        draft: destination.draft,
        version: destination.version,
        start: destination.start,
        length: 0,
      },
      v.document.synthesis.judgment.text,
      v.id,
    );
    setDestination(null);
    setMobile("paper");
  }
  const [excerptError, setExcerptError] = useState("");
  function addExcerpt(e) {
    setExcerptError("");
    e.preventDefault();
    const data = new FormData(e.currentTarget),
      text = String(data.get("quote")).trim(),
      title = String(data.get("name")).trim();
    if (!text || !title) return;
    const id = crypto.randomUUID(),
      location = String(data.get("location")).trim() || t("originalExcerpt"),
      url = String(data.get("url")).trim();
    if (url && !/^https?:\/\//i.test(url)) {
      e.currentTarget.elements.url.setCustomValidity(
        t("enterAnHTTPOrHTTPSLink"),
      );
      e.currentTarget.reportValidity();
      return;
    }
    const resource = {
      id,
      title,
      kind: "web",
      url: url || undefined,
      pages: [{ label: location, text }],
      analyzed: true,
      coverage: t("savedExcerpt"),
      digest: {
        summary: text,
        claims: [
          {
            id: crypto.randomUUID(),
            text: text.slice(0, 100),
            quote: text,
            location,
          },
        ],
      },
    };
    if (!resourceSchema.safeParse(resource).success) {
      setExcerptError(tr("invalidSpaceRequest"));
      return;
    }
    if (update((s) => ({ ...s, resources: [...s.resources, resource] })))
      setShowExcerpt(false);
  }
  const showMaterials = inRoom || materials;
  const tabNames = inRoom
    ? ["room", "paper", "side"]
    : ["side", "paper", "chat"];
  return (
    <>
      {initial.history === null && (
        <p role="alert">{tr("researchHistoryCouldNotBeLoadedPleaseReload")}</p>
      )}
      {status !== tr("saved") && status !== tr("saving") && (
        <p role="status">
          {status}{" "}
          {status !== tr("saving") && (
            <button onClick={flush}>{tr("saveAgain")}</button>
          )}
        </p>
      )}
      <nav className="mobile-tabs" aria-label={t("workspacePanels")}>
        {tabNames.map((tab) => (
          <button
            key={tab}
            aria-controls={"project-pane-" + tab}
            aria-pressed={mobile === tab}
            onClick={() => setMobile(tab)}
          >
            {tab === "paper" && projectQuestion
              ? t("questionResearch")
              : tab === "side" && showMaterials
                ? libraryTitle
                : activeTabName[tab]}
          </button>
        ))}
      </nav>
      <div
        className={"grid integrated" + (inRoom ? " investigating" : "")}
        data-mobile={mobile}
        data-fold-side={!inRoom && fold.side}
        data-fold-chat={!inRoom && fold.chat}
        data-focus={!inRoom ? focus : undefined}
      >
        <aside id="project-pane-side" className="pane side">
          <div className="pane-head directory-heading">
            <InkIcon name="folder" />
            {inRoom ? (
              <h2>{libraryTitle}</h2>
            ) : (
              <nav className="side-tabs" aria-label={t("projectDirectory")}>
                <button
                  aria-controls="project-materials-list"
                  onClick={() => setMaterials(true)}
                  aria-pressed={showMaterials}
                >
                  {libraryTitle}
                </button>
                <button
                  aria-controls="project-drafts-list"
                  onClick={() => setMaterials(false)}
                  aria-pressed={!showMaterials}
                >
                  {t("draft")}{" "}
                </button>
              </nav>
            )}
            {!inRoom && panelControls("side")}
          </div>
          <nav
            className="side-scroll"
            id="project-drafts-list" aria-label={t("draftList")}
            hidden={showMaterials}
          >
            <button
              className="mini"
              onClick={() => {
                if (!w.addDraft()) return;
                setView("rich");
                showRoute({});
              }}
            >
              <Plus size={12} />
              {t("newDraft")}
            </button>
            {docs.length ? (
              docs.map((d) => (
                <button
                  key={d.id}
                  className={"file" + (d.id === w.draft.id ? " active" : "")}
                  onClick={() => {
                    w.changeDraft(d.id);
                    setView("rich");
                    showRoute({});
                  }}
                >
                  <InkIcon name={formats[d.id.split("/")[0]]?.icon || "page"} />
                  {w.titleFor(d.id, d.title)}
                </button>
              ))
            ) : (
              <p className="side-empty">{t("yourDraftsWillAppearHere")}</p>
            )}
          </nav>
          <nav
            className="side-scroll material-nav"
            ref={left}
            id="project-materials-list" aria-label={t("sourceDirectory")}
            hidden={!showMaterials}
          >
            <QuestionList
              questions={projectQuestions}
              current={projectQuestion?.id}
              runs={runs}
              draft={w.draft}
              open={openQuestion}
              save={saveQuestion}
              remove={removeQuestion}
            />
            <section className="source-lane" aria-label={t("sourcesCitedByAI")}>
              <h3 className="side-label">
                {t("sourcesCitedByAI")} <small>{aiSources.length}</small>
              </h3>
              {aiSources.length ? (
                <ResearchSourceList
                  sources={aiSources}
                  open={(s) =>
                    showRoute({
                      source: s.id,
                      finding: s.passages[0].uses[0].id,
                    })
                  }
                />
              ) : (
                <p className="lane-empty">
                  {t("sourcesCitedInResearchAnswersWillAppearHere")}{" "}
                </p>
              )}
            </section>
            <section className="source-lane" aria-label={t("sourcesIAdded")}>
              <div className="side-line">
                <h3 className="side-label">
                  {t("sourcesIAdded")}{" "}
                  <small>
                    {
                      new Set([
                        ...space.resources.map((r) => r.id),
                        ...(initial.sources?.videos || []).map(
                          (v) => v.videoId,
                        ),
                      ]).size
                    }
                  </small>
                </h3>
                <button
                  className="mini"
                  onClick={() => {
                    setAdding(!adding);
                    setShowExcerpt(false);
                  }}
                  aria-expanded={adding}
                >
                  <Plus size={12} />
                  {t("addSource")}{" "}
                </button>
              </div>
              {adding && (
                <div className="import-note">
                  <small>{t("importAPDFOrSaveAnExcerptOrLink")}</small>
                  <button
                    className="link"
                    onClick={() => {
                      setAdding(false);
                      setShowExcerpt(true);
                    }}
                  >
                    {t("pasteAnExcerpt")}{" "}
                  </button>
                </div>
              )}
              {showExcerpt && (
                <form className="excerpt-form" onSubmit={addExcerpt}>
                  <label>
                    {t("sourceTitle")}{" "}
                    <input required name="name" maxLength={120} />
                  </label>
                  <label>
                    {t("originalExcerpt")}{" "}
                    <textarea required name="quote" maxLength={1500} />
                  </label>
                  <label>
                    {t("linkOptional")}{" "}
                    <input
                      type="url"
                      name="url"
                      maxLength={3000}
                      onInput={(e) => e.target.setCustomValidity("")}
                    />
                  </label>
                  <label>
                    {t("locationInOriginalOptional")}{" "}
                    <input
                      name="location"
                      maxLength={140}
                      placeholder={t("pageParagraphOrTimestamp")}
                    />
                  </label>
                  {excerptError && <p role="alert">{excerptError}</p>}
                  <button className="secondary">{t("saveExcerpt")}</button>{" "}
                  <button
                    type="button"
                    className="link"
                    onClick={() => setShowExcerpt(false)}
                  >
                    {t("cancel")}{" "}
                  </button>
                </form>
              )}
              <div className="native vs native-library">
                <Library
                  emptyHint={t("optionalMaterial")}
                  space={space}
                  update={update}
                  attachPdf={attachPdf}
                  api={api}
                  versions={versions}
                  bySource={materialClaims}
                  selected={room?.id}
                  activeSource={room?.origin?.id ?? route.source}
                  ready
                  adding={adding}
                  setAdding={setAdding}
                  show={show}
                  openClaim={openClaim}
                  sources={initial.sources}
                  onSourcesChange={onSourcesChange}
                />
              </div>
            </section>
            {versions.some((v) => !v.document.space?.questionId) && (
              <FindingList
                versions={versions.filter((v) => !v.document.space?.questionId)}
                show={show}
              />
            )}
            {index.bySource.get("")?.length > 0 && (
              <div className="native">
                <p className="side-label">{t("projectClaims")}</p>
                <ClaimLinks
                  rooms={index.bySource.get("")}
                  ready
                  openClaim={openClaim}
                />
              </div>
            )}
          </nav>
        </aside>
        {inRoom && (
          <section
            ref={roomRef}
            data-translation-room=""
            data-translation-version={
              room &&
              !room.resource &&
              !space.customClaims?.some((c) => c.id === room.id)
                ? room.versions[0]?.id
                : undefined
            }
            id="project-pane-room" className="pane room"
            aria-label={t("claimResearch")}
          >
            <div
              className="native vs native-room"
              key={room?.id || route.source}
            >
              {room ? (
                <>
                  <ClaimRoomHeader
                    room={room}
                    onParent={() =>
                      showRoute({ source: room.origin?.id ?? "" })
                    }
                    onBack={() => showRoute({})}
                  >
                    <HighlightTranslation
                      key={room.id}
                      projectId={projectId}
                      claimId={room.id}
                      ensureSaved={store.ensureReadingSaved}
                      readingRef={roomRef}
                      browserLanguage={pickDefaultLanguage(
                        Array.from(navigator.languages || []),
                        SUPPORTED_LANGUAGE_CODES,
                      )}
                    />
                  </ClaimRoomHeader>
                  {failure[room.id] && <p role="alert">{failure[room.id]}</p>}
                  <ClaimRoom
                    room={room}
                    selected={selected}
                    question={question}
                    setQuestion={(v) =>
                      setQuestions((prev) => ({ ...prev, [room.id]: v }))
                    }
                    search={research}
                    ready={initial.history !== null}
                    busy={pending === room.id}
                    handoff={handoff}
                    handed={
                      !destination &&
                      !!currentFinding &&
                      space.messages.some(
                        (m) =>
                          m.finding === currentFinding.id &&
                          m.role === "handoff",
                      )
                    }
                    select={show}
                    discuss={discuss}
                    turns={(space.claimDiscussion || []).filter(
                      (t) => t.claimId === room.id,
                    )}
                    chatBusy={chatBusy}
                    target={targets[room.id]}
                    setTarget={(id) =>
                      setTargets((prev) => ({ ...prev, [room.id]: id }))
                    }
                  />
                </>
              ) : (
                <>
                  <button className="link" onClick={() => showRoute({})}>
                    {t("backToWorkspace")}{" "}
                  </button>
                  {route.source === undefined ? <p role="status">{tr("missingClaim")}</p> : researchSource ? (
                    <ResearchSource source={researchSource} show={show} />
                  ) : (
                    <>
                      <h2>{selectedSource?.title || t("projectClaims")}</h2>
                      {selectedSource?.pages[0] && (
                        <div className="source-passage">
                          <small>{selectedSource.pages[0].label}</small>
                          <blockquote>
                            {selectedSource.pages[0].text}
                          </blockquote>
                        </div>
                      )}
                      <ClaimLinks
                        rooms={index.bySource.get(route.source) || []}
                        ready
                        openClaim={openClaim}
                      />
                    </>
                  )}
                </>
              )}
            </div>
          </section>
        )}
        <section
          id="project-pane-paper" className="pane paper"
          aria-label={
            projectQuestion ? t("questionResearch") : t(w.draft.outline && !w.draft.text ? "videoOutline" : "currentDraft")
          }
        >
          {projectQuestion ? (
            <>
              <QuestionSheet
                key={
                  answerId(projectQuestion) +
                  "/" +
                  (linkedExcerpt || "") +
                  "/" +
                  w.draft.id
                }
                question={projectQuestion}
                archived={archived}
                hypothesis={projectQuestion.hypothesis ?? ""}
                onHypothesisChange={(text) =>
                  setProjectQuestions((items) =>
                    items.map((q) =>
                      q.id === projectQuestion.id
                        ? { ...q, hypothesis: text }
                        : q,
                    ),
                  )
                }
                draft={w.draft}
                excerpt={linkedExcerpt}
                run={activeRun}
                materials={space.resources.slice(0, 8)}
                targets={insertionTargets()}
                written={written}
                section={route.section}
                busy={!canStartQuestionResearch}
                researchStatus={researchStatus}
                error={failure[projectQuestion.id]}
                research={() => startResearch(projectQuestion)}
                write={writeAnswer}
                back={() => returnToDraft(projectQuestion)}
              />
              {w.error && <p role="alert">{w.error}</p>}
            </>
          ) : (<>
            {(w.draft.outline || w.draft.id.startsWith("video/") || !w.draft.text && choosing) &&
              <VideoOutline key={w.draft.id} draft={w.draft} questions={projectQuestions} flush={flush} status={status}
                save={form => {
                  const d = live.current.drafts.find(d => d.id === w.draft.id);
                  if (!d || d.version !== form.version) return "interviewChanged";
                  const sections = form.sections.map(s => ({...s, heading:s.heading.trim(), note:s.note.trim()}));
                  const next = reviseOutline(d, sections, form.angle.trim(), form.interviewId);
                  const ok = update(s => ({ ...s, purpose: s.purpose ?? "video", drafts: s.drafts.map(item =>
                    item.id === d.id ? {...next, title:form.title.trim(), defaultTitle:null} : item) }));
                  if (ok) {setChoosing(false);setOutlineError("")}
                  return ok ? null : "capacity";
                }}
                busy={Boolean(interview.busy || space.interview || pending || w.busy)}
                writing={writingOutline} pending={pending} error={outlineError || interview.error}
                open={q => {
                  openQuestion(q);
                  if (!q.versionId && !q.gap && canStartQuestionResearch) void startResearch(q);
                }}
                discuss={() => {setOutlineChatDraft(w.draft.id);setAnswer("");toChat()}}
                write={section => interview.writeOutline(w.draft, section)}
                jump={offset => {setView("rich");setBodyFocus({draft:w.draft.id,offset})}}
                startSection={index => {
                  try {
                    const current = live.current.drafts.find(d => d.id === w.draft.id);
                    const next = writeOutlineBody(current, index);
                    if (!update(s => ({...s,drafts:s.drafts.map(d => d.id===next.id ? next : d)}))) throw Error("capacity");
                    setView("rich");setBodyFocus({draft:next.id,offset:next.outline.sections[index].bodyStart+3+next.outline.sections[index].heading.length+1});
                  } catch(e) {setOutlineError(tr.has(e.message)?tr(e.message):e.message)}
                }} />}
            <Document
              bodyFocus={bodyFocus?.draft===w.draft.id ? bodyFocus : null}
              w={w}
              status={status}
              flush={flush}
              space={space}
              show={(finding, excerpt) => show(finding, excerpt, w.draft.id)}
              view={view}
              onView={setView}
              focusReturnedMarker={focusReturnedMarker}
              rooms={inRoom ? [] : [...index.rooms.values()]}
              onResearch={openClaim}
              openQuestion={openQuestion}
              projectQuestions={projectQuestions}
              runs={runs}
              openWriter={() => {
                setChoosing(false);
                toChat();
              }}
              onAngle={(heading, body) =>
                interview.ask(t("angle", { angle: heading }) + "\n" + body.slice(0, 4000), { format: "research" })
              }
            />
          </>)}
        </section>
        {!inRoom && (
          <aside id="project-pane-chat" className="pane chat">
            <h2 className="pane-head">
              <InkIcon name="chat" />
              <span>{t("projectAssistant")}</span>
              {panelControls("chat")}
            </h2>
            <ProjectChat
              name={name}
              w={w}
              space={space}
              choosing={choosing}
              canCancelChoice={!requiresPurpose}
              setChoosing={setChoosing}
              answer={answer}
              setAnswer={setAnswer}
              interview={interview}
              discussingOutline={outlineChatDraft === w.draft.id}
              endOutlineDiscussion={() => {setOutlineChatDraft(null);setAnswer("")}}
              show={show}
              destination={destination}
              applyToParagraph={applyToParagraph}
            />
          </aside>
        )}
      </div>
    </>
  );
}
