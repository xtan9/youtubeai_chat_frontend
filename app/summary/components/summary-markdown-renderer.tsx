"use client";

import type { Components } from "react-markdown";

interface RendererOptions {
  isDark: boolean;
}

/**
 * Brand-token markdown component map used by the AI-generated video summary
 * (long-form) wherever it renders. Centralised so the hero demo widget on /
 * and the full summary card on /summary share exactly one styling source.
 *
 * Why a function: the light/dark conditionals are interleaved with
 * structural classes (e.g. h1 border + body text colour), so a function of
 * `isDark` is simpler than parameterising every call site with a CSS
 * variable. Token usage stays semantic everywhere it doesn't depend on
 * `isDark`.
 */
export function buildSummaryMarkdownComponents(
  opts: RendererOptions
): Components {
  const { isDark } = opts;
  return {
    h1: ({ children }) => (
      <h1
        className={`text-xl font-bold border-accent-brand-secondary/30 ${
          isDark ? "text-white" : "text-slate-900"
        } border-b pb-2 mb-4`}
      >
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-lg font-semibold text-accent-brand-secondary mt-6 mb-3">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-base font-medium text-accent-brand mt-4 mb-2">
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p
        className={`${
          isDark ? "text-white" : "text-slate-800"
        } leading-relaxed mb-4 text-base`}
      >
        {children}
      </p>
    ),
    ul: ({ children }) => (
      <ul
        className={`list-disc list-inside space-y-2 ${
          isDark ? "text-white" : "text-slate-800"
        } mb-4 ml-4`}
      >
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol
        className={`list-decimal list-inside space-y-2 ${
          isDark ? "text-white" : "text-slate-800"
        } mb-4 ml-4`}
      >
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li
        className={`${
          isDark ? "text-white" : "text-slate-800"
        } leading-relaxed`}
      >
        {children}
      </li>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-accent-brand-secondary">
        {children}
      </strong>
    ),
    em: ({ children }) => (
      <em className="italic text-accent-brand-secondary">{children}</em>
    ),
    blockquote: ({ children }) => (
      <blockquote
        className={`border-l-4 border-accent-brand pl-4 italic bg-accent-brand/10 ${
          isDark ? "text-white" : "text-slate-800"
        } py-2 rounded-r-lg`}
      >
        {children}
      </blockquote>
    ),
    code: ({ children }) => (
      <code
        className={`${
          isDark ? "bg-slate-700" : "bg-slate-100"
        } text-accent-brand-secondary px-2 py-1 rounded text-sm font-mono`}
      >
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre
        className={`${
          isDark
            ? "bg-slate-900 text-white border-slate-600"
            : "bg-slate-100 text-slate-800 border-slate-300"
        } p-4 rounded-lg overflow-x-auto border`}
      >
        {children}
      </pre>
    ),
  };
}
