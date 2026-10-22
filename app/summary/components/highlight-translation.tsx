"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Copy, Languages, LoaderCircle, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import { SUPPORTED_OUTPUT_LANGUAGES, isSupportedLanguageCode, type SupportedLanguageCode } from "@/lib/constants/languages";
import { hasTranslationAccess, TranslationResultSchema, type TranslationRequest, type TranslationResult } from "@/lib/highlight-translation/contract";
import { positionTranslation, readPassageSelection } from "./highlight-selection";

const STORAGE_KEY = "highlight-translation:v1";
const PREFERENCES_EVENT = "highlight-translation-preferences";
function readPreferences() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function subscribePreferences(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PREFERENCES_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PREFERENCES_EVENT, onChange);
  };
}
const serverPreferences = () => null;
function decodePreferences(raw: string | null) {
  try {
    const value = JSON.parse(raw ?? "null");
    return {
      enabled: value?.enabled === true,
      language: typeof value?.language === "string" && isSupportedLanguageCode(value.language) ? value.language : null,
    };
  } catch { return { enabled: false, language: null }; }
}

type Card = {
  range: Range;
  payload?: TranslationRequest;
  status: "ready" | "loading" | "success" | "error" | "hint";
  result?: TranslationResult;
  message?: string;
  retryAt?: number;
};
type Props = {
  readingRef: RefObject<HTMLDivElement | null>;
  sourceUrl: string;
  outputLanguage: SupportedLanguageCode | null;
  browserLanguage: SupportedLanguageCode;
};

export function HighlightTranslation(props: Props) {
  const entitlements = useEntitlements();
  const eligible = entitlements.data?.tier === "pro" && hasTranslationAccess(entitlements.subscriptionPresentation);
  if (eligible) return <PaidHighlightTranslation {...props} />;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-border-default bg-surface-raised/60 px-4 py-3 text-body-sm text-text-primary">
      {entitlements.isPending ? <span>Checking translation access…</span>
        : entitlements.isError ? <span>Translation access is temporarily unavailable.</span>
        : <><Languages className="h-4 w-4" aria-hidden="true" /><span>Highlight translation · Pro</span><Link href="/pricing" className="font-medium underline underline-offset-4">Upgrade to Pro</Link></>}
    </div>
  );
}

function PaidHighlightTranslation({ readingRef, sourceUrl, outputLanguage, browserLanguage }: Props) {
  const stored = useSyncExternalStore(subscribePreferences, readPreferences, serverPreferences);
  const [volatilePreferences, setVolatilePreferences] = useState<string | null>(null);
  const preferences = decodePreferences(volatilePreferences ?? stored);
  const language = preferences.language ?? browserLanguage;
  const enabled = preferences.enabled;
  const [card, setCard] = useState<Card | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [position, setPosition] = useState<ReturnType<typeof positionTranslation>>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const interactingWithCard = useRef(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const signature = useRef("");
  const id = useId();

  const cancelRequest = useCallback(() => {
    generation.current++;
    requestRef.current?.abort();
  }, []);

  const dismiss = useCallback(() => {
    cancelRequest();
    interactingWithCard.current = false;
    setCard(null);
    setCopied(false);
    setCopyFailed(false);
  }, [cancelRequest]);

  const translate = useCallback(async (next: Card) => {
    if (!next.payload || (next.retryAt ?? 0) > Date.now()) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const current = ++generation.current;
    setCard({ ...next, status: "loading", result: undefined, message: undefined, retryAt: undefined });
    setCopied(false);
    setCopyFailed(false);
    try {
      const response = await fetch("/api/translate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next.payload), signal: controller.signal, cache: "no-store",
      });
      const body: unknown = await response.json();
      if (controller.signal.aborted || current !== generation.current) return;
      if (!response.ok) {
        const delay = response.status === 429 ? Math.max(1, Math.min(60, Number(response.headers.get("Retry-After")) || 60)) : 0;
        const message = response.status === 403 ? "Highlight translation is included with Pro."
          : response.status === 401 ? "Sign in with a paid account to translate."
          : response.status === 409 ? "Refresh the Summary and select the text again."
          : response.status === 429 ? "Too many requests."
          : "Translation could not be completed. Try again.";
        setCard({ ...next, status: "error", message, retryAt: delay ? Date.now() + delay * 1000 : undefined,
          payload: [401, 403, 409].includes(response.status) ? undefined : next.payload });
        return;
      }
      const result = TranslationResultSchema.parse(body);
      setCard({ ...next, status: "success", result, message: undefined, retryAt: undefined });
    } catch {
      if (!controller.signal.aborted && current === generation.current) {
        setCard({ ...next, status: "error", message: "Translation could not be completed. Try again." });
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const root = readingRef.current;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dragging = false;
    let touch = window.matchMedia("(pointer: coarse)").matches;
    function capture() {
      if (dragging) return;
      if (cardRef.current?.contains(document.activeElement)) return;
      const selected = readPassageSelection(root!);
      if (!selected) {
        // Native touch selection may collapse while a card action receives focus.
        // Keep the captured Range until an outside action or a new selection.
        if (interactingWithCard.current) return;
        signature.current = "";
        dismiss();
        return;
      }
      const nextSignature = JSON.stringify(selected.passage ?? { invalid: selected.range.toString() });
      if (signature.current === nextSignature) return;
      signature.current = nextSignature;
      dismiss();
      if (!selected.passage) {
        setCard({ range: selected.range, status: "hint", message: "Select up to one sentence within a paragraph or heading." });
        return;
      }
      const next: Card = {
        range: selected.range, status: "ready",
        payload: { ...selected.passage, youtubeUrl: sourceUrl, outputLanguage, targetLanguage: language },
      };
      if (touch) setCard(next);
      else void translate(next);
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(capture, 250); }
    function pointerDown(event: PointerEvent) {
      if (event.target instanceof Node && (cardRef.current?.contains(event.target) || controlsRef.current?.contains(event.target))) return;
      if (event.target instanceof Node && root!.contains(event.target)) {
        dismiss();
        signature.current = "";
        dragging = true;
        touch = event.pointerType === "touch";
      }
    }
    // Let outside controls finish their pointer/click sequence before removing
    // the portal; closing on pointerdown can interfere with native activation.
    function outsideClick(event: MouseEvent) {
      if (!(event.target instanceof Node) || root!.contains(event.target) ||
          cardRef.current?.contains(event.target) || controlsRef.current?.contains(event.target)) return;
      clearTimeout(timer);
      dismiss();
    }

    function pointerUp() { if (dragging) { dragging = false; schedule(); } }
    function keyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { clearTimeout(timer); dismiss(); }
    }
    document.addEventListener("selectionchange", schedule);
    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("click", outsideClick);
    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointercancel", pointerUp);
    document.addEventListener("keydown", keyDown);
    return () => {
      clearTimeout(timer);
      cancelRequest();
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("click", outsideClick);
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointercancel", pointerUp);
      document.removeEventListener("keydown", keyDown);
    };
  }, [enabled, language, sourceUrl, outputLanguage, readingRef, dismiss, translate, cancelRequest]);

  useLayoutEffect(() => {
    if (!card || !enabled) return;
    const root = readingRef.current;
    if (!root) return;
    let frame = 0;
    const update = () => {
      const next = positionTranslation(card.range, root, cardRef.current?.offsetHeight || 280);
      if (!next) { dismiss(); return; }
      setPosition(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    if (cardRef.current) observer.observe(cardRef.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [card, enabled, dismiss, readingRef]);

  useEffect(() => {
    if (!card?.retryAt) return;
    const retryAt = card.retryAt;
    const timer = setTimeout(() => setCard(previous => previous?.retryAt === retryAt ? { ...previous, retryAt: undefined } : previous), Math.max(0, retryAt - Date.now()) + 10);
    return () => clearTimeout(timer);
  }, [card?.retryAt]);

  function save(enabled: boolean, target: SupportedLanguageCode) {
    dismiss();
    signature.current = "";
    const raw = JSON.stringify({ enabled, language: target });
    setVolatilePreferences(raw);
    try { localStorage.setItem(STORAGE_KEY, raw); window.dispatchEvent(new Event(PREFERENCES_EVENT)); } catch { /* Memory-only preferences remain usable. */ }
  }
  async function copy() {
    if (!card?.result) return;
    try {
      await navigator.clipboard.writeText(card.result.translation + "\n\n" + card.result.explanation);
      setCopied(true);
      setCopyFailed(false);
    } catch { setCopyFailed(true); }
  }
  const visible = enabled ? card : null;
  const isRtl = language === "ar";
  return (
    <>
      <div ref={controlsRef} className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border-default bg-surface-raised/60 px-4 py-3 text-body-sm text-text-primary">
        <>
          <div className="flex items-center gap-2">
            <Switch id={id} checked={preferences.enabled} onCheckedChange={value => save(value, language)} aria-describedby={id + "-help"} />
            <label htmlFor={id} className="cursor-pointer font-medium">Highlight to translate</label>
          </div>
          <label className="flex items-center gap-2" htmlFor={id + "-language"}>
            Translate to:
            <select id={id + "-language"} value={language} onChange={event => {
              if (isSupportedLanguageCode(event.target.value)) save(preferences.enabled, event.target.value);
            }} className="max-w-[190px] rounded-md border border-border-default bg-surface-base px-2 py-1.5 text-body-sm">
              {SUPPORTED_OUTPUT_LANGUAGES.map(option => <option key={option.code} value={option.code}>{option.native}</option>)}
            </select>
          </label>
          <p id={id + "-help"} className="basis-full text-body-xs text-text-secondary">Uses selected text and nearby context for AI translation.</p>
        </>
      </div>
      {visible && createPortal(
        <div ref={cardRef} role="region" aria-label="Highlight translation" onPointerDown={event => { interactingWithCard.current = true; event.stopPropagation(); }}
          onFocusCapture={() => { interactingWithCard.current = true; }} onClick={event => event.stopPropagation()}
          className="fixed z-50 overflow-auto rounded-xl border border-border-subtle border-t-[3px] border-t-accent-brand-secondary bg-surface-overlay p-4 text-text-primary shadow-xl"
          style={{ ...position, visibility: position ? "visible" : "hidden" }}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0 break-words font-semibold">{visible.payload?.text ?? "Highlight translation"}
              {visible.result?.partOfSpeech && <span className="ml-2 text-body-xs font-normal italic text-text-muted">{visible.result.partOfSpeech}</span>}
            </div>
            <button type="button" aria-label="Close translation" onClick={dismiss} className="rounded p-1 hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-offset-2"><X className="h-4 w-4" /></button>
          </div>
          <div aria-live="polite" aria-atomic="true">
            {visible.status === "ready" && <Button onClick={() => void translate(visible)} size="sm"><Languages className="mr-2 h-4 w-4" />Translate</Button>}
            {visible.status === "loading" && <p className="flex items-center gap-2 text-body-sm"><LoaderCircle className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />Translating in context…</p>}
            {visible.result && <>
              <p lang={language} dir={isRtl ? "rtl" : "auto"} className="break-words text-h4 font-semibold">{visible.result.translation}</p>
              <div className="mt-4 border-t border-border-subtle pt-3">
                <p className="mb-2 text-body-xs font-medium text-text-muted">Meaning in this passage</p>
                <p lang={language} dir={isRtl ? "rtl" : "auto"} className="break-words text-body-sm leading-relaxed">{visible.result.explanation}</p>
              </div>
            </>}
            {visible.message && <p className="text-body-sm">{visible.message}</p>}
            {visible.retryAt && <p className="mt-2 text-body-xs">Retry after {new Date(visible.retryAt).toLocaleTimeString()}.</p>}
          </div>
          {visible.status === "error" && visible.payload && <Button className="mt-3" variant="outline" size="sm" disabled={visible.retryAt !== undefined} onClick={() => void translate(visible)}>Retry</Button>}
          {visible.result && <div className="mt-4 flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
            <span className="text-body-xs text-text-muted">Based on this passage</span>
            <Button size="sm" variant="ghost" onClick={() => void copy()}><Copy className="mr-1.5 h-4 w-4" />{copied ? "Copied" : "Copy"}</Button>
          </div>}
          {copyFailed && <p role="status" className="mt-2 text-body-xs">Copy failed. Select and copy the translation manually.</p>}
        </div>, document.body)}
    </>
  );
}
