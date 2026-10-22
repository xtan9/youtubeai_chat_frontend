// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SummaryContent } from "../summary-content";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("posthog-js/react", () => ({ usePostHog: () => null }));
const summary = {
  title: "Practical decisions", duration: "10:00",
  summary: "## Practical decisions\n\nDeng Xiaoping, a **pragmatist**, focused on economic results.",
  transcriptionTime: 1, summaryTime: 1,
};
const result = { translation: "务实派", explanation: "这里指重视实际经济成果的人。", sameLanguage: false, partOfSpeech: "noun" };
const fetchMock = vi.fn();

function show(paid = true, markdown = summary.summary) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["entitlements"], {
    tier: paid ? "pro" : "free",
    subscriptionPresentation: { state: paid ? "active_pro" : "free", plan: "monthly", renewsAt: null },
  });
  const view = render(<QueryClientProvider client={client}>
    <SummaryContent summary={{ ...summary, summary: markdown }} sourceUrl="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      browserLanguage="zh" onCopySummary={() => {}} onNewSummary={() => {}} highlightTranslationEnabled />
  </QueryClientProvider>);
  return { ...view, client };
}
function selectWord(word = "pragmatist") {
  const root = screen.getByTestId("summary-markdown-surface");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const start = node.textContent?.indexOf(word) ?? -1;
    if (start < 0) continue;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + word.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent(document, new Event("selectionchange"));
    return;
  }
  throw new Error("Word missing from Summary");
}
beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(Response.json(result));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(120, 240, 80, 24));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 900, 600));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.getSelection()?.removeAllRanges(); });

describe("Summary highlight translation", () => {
  it.each([
    "# What the controversy is about",
    "## What the controversy is about",
    "### What the **controversy** is about",
    "#### What the controversy is about",
    "##### What the controversy is about",
    "###### What the controversy is about",
    "What the controversy is about\n============================",
    "What the controversy is about\n----------------------------",
  ])("translates a word selected inside a Summary heading: %s", async markdown => {
    fetchMock.mockResolvedValue(Response.json({ translation: "争议", explanation: "这里指该主题存在的不同观点。", sameLanguage: false }));
    show(true, markdown);
    fireEvent.click(screen.getByRole("switch", { name: "Highlight to translate" }));
    selectWord("controversy");
    const card = await screen.findByRole("region", { name: "Highlight translation" });
    expect(card.textContent).not.toContain("Select up to one sentence within a paragraph or heading.");
    expect(await screen.findByText("争议")).toBeTruthy();
    expect(screen.queryByText("Select up to one sentence within a paragraph or heading.")).toBeNull();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      text: "controversy", context: "What the controversy is about", heading: "What the controversy is about", blockStart: 0, selectionStart: 9,
    });
  });

  it("stays off until enabled, then shows a contextual floating translation for a paid learner", async () => {
    show();
    const toggle = screen.getByRole("switch", { name: "Highlight to translate" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    selectWord();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    selectWord();
    expect(await screen.findByText("务实派")).toBeTruthy();
    expect(screen.getByText(result.explanation)).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      text: "pragmatist", targetLanguage: "zh", heading: "Practical decisions",
      context: "Deng Xiaoping, a pragmatist, focused on economic results.",
    });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("务实派")).toBeNull());
  });

  it("clears old results when paid access disappears and does not resurrect them", async () => {
    const { client } = show();
    fireEvent.click(screen.getByRole("switch", { name: "Highlight to translate" }));
    selectWord();
    await screen.findByText("务实派");
    act(() => client.setQueryData(["entitlements"], { tier: "free", subscriptionPresentation: { state: "free" } }));
    await screen.findByRole("link", { name: "Upgrade to Pro" });
    expect(screen.queryByText("务实派")).toBeNull();
    act(() => client.setQueryData(["entitlements"], { tier: "pro", subscriptionPresentation: { state: "active_pro", plan: "monthly", renewsAt: null } }));
    await screen.findByRole("switch", { name: "Highlight to translate" });
    expect(screen.queryByText("务实派")).toBeNull();
  });

  it("keeps Free users locked out even with an enabled browser preference", async () => {
    localStorage.setItem("highlight-translation:v1", JSON.stringify({ enabled: true, language: "zh" }));
    show(false);
    expect(screen.getByRole("link", { name: "Upgrade to Pro" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Highlight to translate" })).toBeNull();
    selectWord();
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires an explicit Translate action for touch selections", async () => {
    show();
    fireEvent.click(screen.getByRole("switch", { name: "Highlight to translate" }));
    const root = screen.getByTestId("summary-markdown-surface");
    fireEvent.pointerDown(root, { pointerType: "touch" });
    selectWord();
    fireEvent.pointerUp(root, { pointerType: "touch" });
    const action = await screen.findByRole("button", { name: "Translate" });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(action);
    expect(await screen.findByText("务实派")).toBeTruthy();
  });

  it("never lets a late response replace a newer selection", async () => {
    let resolveOld!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; }));
    show();
    fireEvent.click(screen.getByRole("switch", { name: "Highlight to translate" }));
    selectWord();
    await screen.findByText("Translating in context…");
    selectWord("economic results");
    await screen.findByText("务实派");
    await act(async () => resolveOld(Response.json({ ...result, translation: "STALE" })));
    expect(screen.queryByText("STALE")).toBeNull();
    expect(screen.getByRole("region", { name: "Highlight translation" }).textContent).toContain("economic results");
  });

  it("invalidates a pending response when disabled and remembers both preferences", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const { unmount } = show();
    fireEvent.change(screen.getByLabelText("Translate to:"), { target: { value: "fr" } });
    fireEvent.click(screen.getByRole("switch", { name: "Highlight to translate" }));
    selectWord();
    await screen.findByText("Translating in context…");
    fireEvent.click(screen.getByRole("switch", { name: "Highlight to translate" }));
    await act(async () => finish(Response.json(result)));
    expect(screen.queryByRole("region", { name: "Highlight translation" })).toBeNull();
    unmount();
    show();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect((screen.getByLabelText("Translate to:") as HTMLSelectElement).value).toBe("fr");
  });

  it("shows a safe rate-limit state, waits, and retries only on request", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ message: "PRIVATE" }, { status: 429, headers: { "Retry-After": "1" } }));
    show();
    fireEvent.click(screen.getByRole("switch"));
    selectWord();
    await screen.findByText("Too many requests.");
    const retry = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(screen.queryByText("PRIVATE")).toBeNull();
    await waitFor(() => expect(retry.disabled).toBe(false), { timeout: 2000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await screen.findByText("务实派");
    expect(screen.queryByText("Too many requests.")).toBeNull();
    expect(screen.queryByText(/^Retry after /)).toBeNull();
  });

  it("replaces a failed translation with a successful result even without auxiliary metadata", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ code: "TRANSLATION_FAILED" }, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ translation: result.translation, explanation: result.explanation }));
    show();
    fireEvent.click(screen.getByRole("switch", { name: "Highlight to translate" }));
    selectWord();
    const message = "Translation could not be completed. Try again.";
    await screen.findByText(message);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText(result.translation);
    expect(screen.getByText(result.explanation)).toBeTruthy();
    expect(screen.getByText("Meaning in this passage")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.queryByText(message)).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByText(/^Retry after /)).toBeNull();
  });

  it.each(["First sentence. Second sentence.", "第一句。第二句。", "x".repeat(501)])(
    "rejects a selection beyond the one-sentence limit before calling AI",
    async text => {
      show(true, text);
      fireEvent.click(screen.getByRole("switch"));
      selectWord(text);
      await screen.findByText("Select up to one sentence within a paragraph or heading.");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects selections crossing paragraph boundaries", async () => {
    show(true, "First paragraph.\n\nSecond paragraph.");
    fireEvent.click(screen.getByRole("switch"));
    const root = screen.getByTestId("summary-markdown-surface");
    const paragraphs = root.querySelectorAll("p");
    const range = document.createRange();
    range.setStart(paragraphs[0].firstChild!, 0);
    range.setEnd(paragraphs[1].firstChild!, 6);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent(document, new Event("selectionchange"));
    await screen.findByText("Select up to one sentence within a paragraph or heading.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a selection spanning a heading and its following paragraph", async () => {
    show(true, "## What the controversy is about\n\nResearchers disagree about the evidence.");
    fireEvent.click(screen.getByRole("switch"));
    const root = screen.getByTestId("summary-markdown-surface");
    const range = document.createRange();
    range.setStart(root.querySelector("h2")!.firstChild!, 9);
    range.setEnd(root.querySelector("p")!.firstChild!, 11);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent(document, new Event("selectionchange"));
    await screen.findByText("Select up to one sentence within a paragraph or heading.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("dismisses when its selection scrolls out of view", async () => {
    show();
    fireEvent.click(screen.getByRole("switch"));
    selectWord();
    await screen.findByText("务实派");
    vi.mocked(Range.prototype.getBoundingClientRect).mockReturnValue(new DOMRect(120, -60, 80, 20));
    fireEvent.scroll(screen.getByTestId("summary-markdown-surface"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Highlight translation" })).toBeNull());
  });

  it("recovers when native touch selection cancels the pointer sequence", async () => {
    show();
    fireEvent.click(screen.getByRole("switch"));
    const root = screen.getByTestId("summary-markdown-surface");
    fireEvent.pointerDown(root, { pointerType: "touch" });
    fireEvent.pointerCancel(root, { pointerType: "touch" });
    selectWord();
    expect(await screen.findByRole("button", { name: "Translate" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels a pending selection when an outside control is clicked", async () => {
    show();
    fireEvent.click(screen.getByRole("switch"));
    selectWord();
    fireEvent.click(screen.getByRole("button", { name: "Copy Summary" }));
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Highlight translation" })).toBeNull();
  });

  it("keeps the captured passage when tapping Translate collapses native selection", async () => {
    show();
    fireEvent.click(screen.getByRole("switch"));
    const root = screen.getByTestId("summary-markdown-surface");
    fireEvent.pointerDown(root, { pointerType: "touch" });
    selectWord();
    fireEvent.pointerUp(root, { pointerType: "touch" });
    const action = await screen.findByRole("button", { name: "Translate" });
    fireEvent.pointerDown(action, { pointerType: "touch" });
    window.getSelection()!.removeAllRanges();
    fireEvent(document, new Event("selectionchange"));
    fireEvent.click(action);
    await screen.findByText("务实派");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    expect(screen.getByRole("region", { name: "Highlight translation" })).toBeTruthy();
  });

  it.each(["succeeds", "fails"])("does not change a new card when an older clipboard write %s", async outcome => {
    let finishCopy!: () => void;
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      finishCopy = outcome === "succeeds" ? resolve : () => reject(new Error("Clipboard unavailable"));
    }));
    fetchMock.mockResolvedValueOnce(Response.json(result)).mockResolvedValueOnce(Response.json({
      translation: "经济成果", explanation: "这里指经济方面取得的实际成效。",
    }));
    show();
    fireEvent.click(screen.getByRole("switch"));
    selectWord();
    await screen.findByText(result.translation);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(result.translation + "\n\n" + result.explanation);
    const root = screen.getByTestId("summary-markdown-surface");
    fireEvent.pointerDown(root, { pointerType: "mouse" });
    selectWord("economic results");
    fireEvent.pointerUp(root, { pointerType: "mouse" });
    await screen.findByText("经济成果");
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    await act(async () => finishCopy());
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.queryByText("Copy failed. Select and copy the translation manually.")).toBeNull();
    expect(writeText).toHaveBeenCalledTimes(1);
  });
  it("allows keyboard re-selection of the same word after dismissing its card", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json(result)));
    show();
    fireEvent.click(screen.getByRole("switch"));
    selectWord();
    await screen.findByText(result.translation);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Highlight translation" })).toBeNull();
    const selection = window.getSelection()!;
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    selection.collapseToStart();
    fireEvent(document, new Event("selectionchange"));
    fireEvent.keyDown(document, { key: "ArrowRight", shiftKey: true, ctrlKey: true });
    selectWord();
    expect(await screen.findByText(result.translation)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("does not show an old response while keyboard selection settles (return to original: %s)", async returnToOriginal => {
    let finishOld!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce(Response.json({ translation: "经济成果", explanation: "这里指经济方面取得的实际成效。" }));
    show();
    fireEvent.click(screen.getByRole("switch"));
    selectWord();
    await screen.findByText("Translating in context…");
    fireEvent.keyDown(document, { key: "ArrowRight", shiftKey: true, ctrlKey: true });
    if (returnToOriginal) {
      const selection = window.getSelection()!;
      const endNode = selection.focusNode!;
      const endOffset = selection.focusOffset;
      selection.extend(endNode, endOffset - 1);
      fireEvent(document, new Event("selectionchange"));
      selection.extend(endNode, endOffset);
      fireEvent(document, new Event("selectionchange"));
    } else {
      selectWord("economic results");
    }
    await act(async () => finishOld(Response.json({ ...result, translation: "OUTDATED_RESULT" })));
    expect(screen.queryByText("OUTDATED_RESULT")).toBeNull();
    expect(await screen.findByText("经济成果")).toBeTruthy();
  });

  it("keeps a pending translation alive when the selection has not changed", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    show();
    fireEvent.click(screen.getByRole("switch"));
    selectWord();
    await screen.findByText("Translating in context…");
    fireEvent(document, new Event("selectionchange"));
    await act(async () => finish(Response.json(result)));
    expect(await screen.findByText(result.translation)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["collapsed", "outside Summary"])("invalidates a pending result immediately when the selection is %s", async nextSelection => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    show();
    fireEvent.click(screen.getByRole("switch"));
    selectWord();
    await screen.findByText("Translating in context…");
    const selection = window.getSelection()!;
    if (nextSelection === "collapsed") {
      fireEvent.keyDown(document, { key: "ArrowLeft" });
      selection.collapseToStart();
    } else {
      const range = document.createRange();
      range.selectNodeContents(screen.getByRole("heading", { name: "AI-Generated Video Summary" }));
      selection.removeAllRanges();
      selection.addRange(range);
    }
    fireEvent(document, new Event("selectionchange"));
    await act(async () => finish(Response.json({ ...result, translation: "OUTDATED_AFTER_SELECTION_EXIT" })));
    expect(screen.queryByText("OUTDATED_AFTER_SELECTION_EXIT")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a pending touch request when its Translate action collapses selection", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    show();
    fireEvent.click(screen.getByRole("switch"));
    const root = screen.getByTestId("summary-markdown-surface");
    fireEvent.pointerDown(root, { pointerType: "touch" });
    selectWord();
    fireEvent.pointerUp(root, { pointerType: "touch" });
    const action = await screen.findByRole("button", { name: "Translate" });
    fireEvent.pointerDown(action, { pointerType: "touch" });
    fireEvent.click(action);
    await screen.findByText("Translating in context…");
    window.getSelection()!.collapseToStart();
    fireEvent(document, new Event("selectionchange"));
    await act(async () => finish(Response.json(result)));
    expect(await screen.findByText(result.translation)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
