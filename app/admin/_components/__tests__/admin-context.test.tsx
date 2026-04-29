import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminProvider, useAdmin } from "../admin-context";

function ShowEmail() {
  const { email } = useAdmin();
  return <span data-testid="email">{email}</span>;
}

describe("useAdmin / AdminProvider", () => {
  it("returns the email when wrapped in AdminProvider", () => {
    const out = renderToStaticMarkup(
      <AdminProvider email="alice@example.com">
        <ShowEmail />
      </AdminProvider>,
    );
    expect(out).toContain("alice@example.com");
  });

  it("throws when called outside the provider", () => {
    expect(() => renderToStaticMarkup(<ShowEmail />)).toThrow(
      /useAdmin must be used inside <AdminProvider>/,
    );
  });
});
