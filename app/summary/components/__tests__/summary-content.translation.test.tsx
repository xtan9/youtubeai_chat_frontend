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
  });

  it.each(["First sentence. Second sentence.", "第一句。第二句。", "x".repeat(501)])(
    "rejects a selection beyond the one-sentence limit before calling AI",
    async text => {
      show(true, text);
      fireEvent.click(screen.getByRole("switch"));
      selectWord(text);
      await screen.findByText("Select up to one sentence in one paragraph.");
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
    await screen.findByText("Select up to one sentence in one paragraph.");
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
});
