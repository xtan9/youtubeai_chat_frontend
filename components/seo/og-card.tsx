// Shared layout for `opengraph-image.tsx` route handlers.
//
// `next/og` ImageResponse uses Satori under the hood, which renders a
// strict subset of CSS-in-JS:
//   - every element with multiple children must explicitly set
//     display: 'flex' (Satori errors otherwise)
//   - no Tailwind classes — inline style objects only
//   - no system fonts beyond what Satori bundles, so we stick to the
//     default sans-serif fallback
//
// Returns an ImageResponse the route handler can directly return.
import { ImageResponse } from "next/og";

export const ogSize = { width: 1200, height: 630 };
export const ogContentType = "image/png";

type OgCardInput = {
  title: string;
  /** Optional — supports up to ~140 chars before clipping. */
  subtitle?: string;
  /** Optional category/eyebrow above the title (e.g. "Tutorial", "FAQ"). */
  eyebrow?: string;
};

export function buildOgCard({ title, subtitle, eyebrow }: OgCardInput) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          // Dark base + brand-accent radial overlay; matches the
          // bg-gradient-brand-accent feel of the homepage hero in dark mode.
          backgroundColor: "#0a0420",
          backgroundImage:
            "linear-gradient(135deg, #0f0726 0%, #1a0942 50%, #0a1830 100%)",
          padding: "72px",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        {/* Wordmark — gradient text matching bg-gradient-brand-accent */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 28,
            fontWeight: 600,
          }}
        >
          <span
            style={{
              backgroundImage:
                "linear-gradient(90deg, #a78bfa 0%, #f472b6 50%, #67e8f9 100%)",
              // Satori needs the WebKit-prefixed property explicitly —
              // unprefixed `backgroundClip: "text"` alone leaves the
              // wordmark transparent on some Satori versions.
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              color: "transparent",
            }}
          >
            youtubeai.chat
          </span>
        </div>

        {/* Spacer — pushes content to lower portion of card */}
        <div style={{ flex: 1, display: "flex" }} />

        {eyebrow && (
          <div
            style={{
              display: "flex",
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#a78bfa",
              marginBottom: 16,
            }}
          >
            {eyebrow}
          </div>
        )}

        <div
          style={{
            display: "flex",
            fontSize: 64,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            maxWidth: 1056,
            marginBottom: subtitle ? 24 : 0,
          }}
        >
          {title}
        </div>

        {subtitle && (
          <div
            style={{
              display: "flex",
              fontSize: 28,
              lineHeight: 1.35,
              color: "rgba(255, 255, 255, 0.72)",
              maxWidth: 1056,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    ),
    { ...ogSize },
  );
}
