import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";

const HEADING_STYLES =
  "scroll-mt-24 font-bold text-text-primary tracking-tight";

// `/`-prefixed paths get next/link for client-side nav. Bare `#anchor`
// fragments fall through to a plain <a> — `<Link href="#x">` triggers a
// React warning and doesn't actually navigate.
function isInternalHref(href: string | undefined): boolean {
  if (!href) return false;
  return href.startsWith("/");
}

export function BlogMarkdown({ children }: { children: string }) {
  return (
    <div className="max-w-3xl mx-auto text-text-primary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className={`${HEADING_STYLES} text-h1 mt-12 mb-6`}>
              {children}
            </h1>
          ),
          h2: ({ children, id }) => (
            <h2
              id={id}
              className={`${HEADING_STYLES} text-h2 mt-12 mb-4 border-b border-border-subtle pb-2`}
            >
              {children}
            </h2>
          ),
          h3: ({ children, id }) => (
            <h3
              id={id}
              className={`${HEADING_STYLES} text-h3 mt-8 mb-3`}
            >
              {children}
            </h3>
          ),
          h4: ({ children, id }) => (
            <h4
              id={id}
              className={`${HEADING_STYLES} text-h4 mt-6 mb-2`}
            >
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="text-body-md leading-relaxed text-text-primary my-4">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-6 my-4 space-y-2 text-body-md text-text-primary marker:text-text-muted">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 my-4 space-y-2 text-body-md text-text-primary marker:text-text-muted">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => {
            if (isInternalHref(href)) {
              return (
                <Link
                  href={href!}
                  className="text-accent-brand underline underline-offset-2 hover:no-underline"
                >
                  {children}
                </Link>
              );
            }
            const isHashAnchor = href?.startsWith("#");
            return (
              <a
                href={href}
                target={isHashAnchor ? undefined : "_blank"}
                rel={isHashAnchor ? undefined : "noopener noreferrer"}
                className="text-accent-brand underline underline-offset-2 hover:no-underline"
              >
                {children}
              </a>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-border-default bg-surface-raised pl-4 pr-2 py-2 my-6 text-text-secondary italic">
              {children}
            </blockquote>
          ),
          code: ({ children, className }) => {
            // Inline code only — fenced code is wrapped in <pre>.
            if (!className) {
              return (
                <code className="bg-surface-raised border border-border-subtle rounded px-1.5 py-0.5 text-sm font-mono text-text-primary">
                  {children}
                </code>
              );
            }
            return <code className={className}>{children}</code>;
          },
          pre: ({ children }) => (
            <pre className="bg-surface-sunken border border-border-subtle rounded-lg p-4 my-6 overflow-x-auto text-sm font-mono text-text-primary">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-6">
              <table className="w-full border-collapse text-body-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border-subtle bg-surface-raised px-4 py-2 text-left font-semibold text-text-primary">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border-subtle px-4 py-2 text-text-primary">
              {children}
            </td>
          ),
          hr: () => <hr className="my-10 border-border-subtle" />,
          strong: ({ children }) => (
            <strong className="font-semibold text-text-primary">
              {children}
            </strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
