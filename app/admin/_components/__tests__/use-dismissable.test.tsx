// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef, type RefObject } from "react";
import { useDismissable } from "../use-dismissable";

function setup(open: boolean, anchor: HTMLElement | null) {
  const onClose = vi.fn();
  const { unmount, rerender } = renderHook(
    ({ o }: { o: boolean }) => {
      const ref = useRef<HTMLElement>(anchor);
      useDismissable(o, ref as RefObject<HTMLElement | null>, onClose);
    },
    { initialProps: { o: open } },
  );
  return { onClose, unmount, rerender };
}

describe("useDismissable", () => {
  it("does not attach listeners while closed", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    const { onClose } = setup(false, anchor);
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose on outside mousedown when open", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const { onClose } = setup(true, anchor);
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when click is inside the anchor", () => {
    const anchor = document.createElement("div");
    const inner = document.createElement("button");
    anchor.appendChild(inner);
    document.body.appendChild(anchor);
    const { onClose } = setup(true, anchor);
    inner.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose on Escape when open", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    const { onClose } = setup(true, anchor);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("removes listeners on unmount", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    const { onClose, unmount } = setup(true, anchor);
    unmount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
