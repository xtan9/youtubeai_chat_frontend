// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildSummaryMarkdownComponents } from "../summary-markdown-renderer";

describe("buildSummaryMarkdownComponents", () => {
  it("renders h2 with brand-secondary token", () => {
    const components = buildSummaryMarkdownComponents({ isDark: false });
    render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {"## Hello"}
      </ReactMarkdown>
    );
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(h2.className).toContain("text-accent-brand-secondary");
  });

  it("renders strong with brand-secondary token", () => {
    const components = buildSummaryMarkdownComponents({ isDark: false });
    render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {"**bold**"}
      </ReactMarkdown>
    );
    const strong = screen.getByText("bold");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.className).toContain("text-accent-brand-secondary");
  });

  it("renders blockquote with accent-brand border in light mode", () => {
    const components = buildSummaryMarkdownComponents({ isDark: false });
    const { container } = render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {"> quoted"}
      </ReactMarkdown>
    );
    const blockquote = container.querySelector("blockquote");
    expect(blockquote?.className).toContain("border-accent-brand");
    expect(blockquote?.className).toContain("text-slate-800");
  });

  it("switches paragraph text color in dark mode", () => {
    const components = buildSummaryMarkdownComponents({ isDark: true });
    const { container } = render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {"text"}
      </ReactMarkdown>
    );
    const p = container.querySelector("p");
    expect(p?.className).toContain("text-white");
  });

  it("renders h1 with brand-secondary border-bottom", () => {
    const components = buildSummaryMarkdownComponents({ isDark: false });
    render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {"# Heading"}
      </ReactMarkdown>
    );
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toContain("border-accent-brand-secondary");
  });

  it("renders code inline with accent-brand-secondary text", () => {
    const components = buildSummaryMarkdownComponents({ isDark: false });
    const { container } = render(
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {"`code`"}
      </ReactMarkdown>
    );
    const code = container.querySelector("code");
    expect(code?.className).toContain("text-accent-brand-secondary");
  });
});
