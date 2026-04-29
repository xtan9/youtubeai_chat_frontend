"use client";

import { useEffect } from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin] route error boundary", error);
  }, [error]);

  return (
    <div
      style={{
        padding: "48px 24px",
        maxWidth: 480,
        margin: "0 auto",
        fontFamily:
          '"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        Admin console unavailable
      </h1>
      <p style={{ color: "#737373", fontSize: 14, marginBottom: 16 }}>
        The auth service or a downstream dependency is temporarily
        unreachable. The console will return when it&apos;s back.
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          padding: "8px 14px",
          fontSize: 13,
          fontWeight: 500,
          border: "1px solid #d4d4d4",
          borderRadius: 6,
          background: "#fff",
          cursor: "pointer",
        }}
      >
        Retry
      </button>
      {error.digest && (
        <div
          style={{
            marginTop: 16,
            fontFamily: "ui-monospace, monospace",
            fontSize: 11,
            color: "#a3a3a3",
          }}
        >
          ref {error.digest}
        </div>
      )}
    </div>
  );
}
