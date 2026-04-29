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
    // Log error class + message so the operator can grep logs by class.
    // The digest matches the Vercel runtime log entry for the throw.
    console.error("[admin] route error boundary", {
      name: error.name,
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  const headline = errorHeadline(error);
  const explanation = errorExplanation(error);

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
        {headline}
      </h1>
      <p style={{ color: "#737373", fontSize: 14, marginBottom: 16 }}>
        {explanation}
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

function errorHeadline(error: Error): string {
  if (error.name === "AdminClientUnavailableError") {
    return "Admin console unavailable";
  }
  if (error.name === "QueryError") return "Admin query failed";
  if (error.name === "AuthInfraError") return "Auth service unavailable";
  return "Admin console error";
}

function errorExplanation(error: Error): string {
  if (error.name === "AdminClientUnavailableError") {
    return "Service-role credentials are missing in this environment. The console will return when the env var is set and a redeploy lands.";
  }
  if (error.name === "QueryError") {
    return "A database query backing this page failed. Retry; if it persists, check Supabase status and the runtime log.";
  }
  if (error.name === "AuthInfraError") {
    return "The auth service or a downstream dependency is temporarily unreachable. The console will return when it's back.";
  }
  return "An unexpected error occurred. Retry; if it persists, check the runtime log for the ref below.";
}
