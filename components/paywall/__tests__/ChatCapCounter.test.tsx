// @vitest-environment happy-dom
import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { ChatCapCounter } from "../ChatCapCounter";

afterEach(cleanup);

describe("ChatCapCounter", () => {
  it("renders nothing when used < limit - 2", () => {
    const { container } = render(<ChatCapCounter used={2} limit={5} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders at usage 3 of 5", () => {
    const { container, getByText } = render(
      <ChatCapCounter used={3} limit={5} />,
    );
    expect(container.firstChild).not.toBeNull();
    expect(getByText("3 of 5 free messages used")).not.toBeNull();
  });

  it("renders at boundary usage (5 of 5)", () => {
    const { getByText } = render(<ChatCapCounter used={5} limit={5} />);
    expect(getByText("5 of 5 free messages used")).not.toBeNull();
  });

  it("renders nothing for unlimited (limit=-1)", () => {
    const { container } = render(<ChatCapCounter used={50} limit={-1} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for unlimited (limit=Infinity)", () => {
    const { container } = render(
      <ChatCapCounter used={50} limit={Number.POSITIVE_INFINITY} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("exposes the data-paywall-counter attribute", () => {
    const { container } = render(<ChatCapCounter used={4} limit={5} />);
    expect(
      container.querySelector('[data-paywall-counter="chat"]'),
    ).not.toBeNull();
  });
});
