import type { SVGProps } from "react";

/**
 * Compact "YT / AI" wordmark used inside the gradient brand square in
 * the header. Two-line lockup with a hairline divider keeps the mark
 * legible at small header sizes while staying recognizable when scaled
 * up.
 *
 * The mark uses `currentColor` so the parent controls foreground; the
 * gradient background is drawn by the wrapping container, not this SVG.
 * For the standalone Organization-schema logo (gradient included), use
 * `/public/logo.svg`.
 */
export function YtAiMark({
  className,
  ...rest
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 40 40"
      role="img"
      aria-label="YT AI"
      fill="currentColor"
      className={className}
      {...rest}
    >
      <text
        x="20"
        y="18"
        textAnchor="middle"
        fontWeight={900}
        fontSize={13}
        letterSpacing={-0.5}
        fontFamily="inherit"
      >
        YT
      </text>
      <line
        x1="9"
        y1="20.5"
        x2="31"
        y2="20.5"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
      />
      <text
        x="20"
        y="33"
        textAnchor="middle"
        fontWeight={900}
        fontSize={13}
        letterSpacing={-0.5}
        fontFamily="inherit"
      >
        AI
      </text>
    </svg>
  );
}
