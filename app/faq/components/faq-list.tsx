"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import type { FaqEntry } from "@/lib/content/faq";

// Client component because the accordion needs interactivity. The
// answer text still ships in the SSR HTML (Radix renders all panels and
// just hides them), so crawlers + the FAQPage JSON-LD see the full
// content even when collapsed.
export function FaqList({
  groups,
}: {
  groups: { category: string; label: string; entries: FaqEntry[] }[];
}) {
  return (
    <div className="space-y-12">
      {groups.map((group) => (
        <section key={group.category} id={group.category} className="scroll-mt-24">
          <h2 className="text-h2 font-bold text-text-primary mb-4">
            {group.label}
          </h2>
          <div className="rounded-xl border border-border-subtle bg-surface-raised">
            <Accordion type="multiple" className="w-full">
              {group.entries.map((entry) => (
                <AccordionItem
                  key={entry.slug}
                  value={entry.slug}
                  className="border-border-subtle"
                >
                  <AccordionTrigger className="px-6 py-5 hover:no-underline hover:bg-state-hover">
                    <h3 className="text-body-lg font-medium text-text-primary text-left">
                      {entry.question}
                    </h3>
                  </AccordionTrigger>
                  <AccordionContent className="px-6 pb-6 pt-2">
                    <div className="text-body-md text-text-secondary leading-relaxed space-y-3">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p>{children}</p>,
                          a: ({ href, children }) => {
                            const internal =
                              href?.startsWith("/") || href?.startsWith("#");
                            return internal ? (
                              <Link
                                href={href!}
                                className="text-accent-brand underline underline-offset-2 hover:no-underline"
                              >
                                {children}
                              </Link>
                            ) : (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent-brand underline underline-offset-2 hover:no-underline"
                              >
                                {children}
                              </a>
                            );
                          },
                          strong: ({ children }) => (
                            <strong className="font-semibold text-text-primary">
                              {children}
                            </strong>
                          ),
                          ul: ({ children }) => (
                            <ul className="list-disc pl-5 space-y-1">
                              {children}
                            </ul>
                          ),
                          li: ({ children }) => <li>{children}</li>,
                        }}
                      >
                        {entry.body}
                      </ReactMarkdown>
                    </div>
                    {entry.relatedBlogSlugs.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-border-subtle">
                        <p className="text-caption uppercase tracking-wider text-text-muted mb-2">
                          Related reading
                        </p>
                        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm">
                          {entry.relatedBlogSlugs.map((s) => (
                            <li key={s}>
                              <Link
                                href={`/blog/${s}`}
                                className="text-accent-brand hover:underline"
                              >
                                /blog/{s}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>
      ))}
    </div>
  );
}
