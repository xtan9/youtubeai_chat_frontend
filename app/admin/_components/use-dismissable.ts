"use client";

import { useEffect, type RefObject } from "react";

/**
 * Closes a popover when the user clicks outside its anchor or presses Escape.
 * Wire from the consumer: `useDismissable(open, anchorRef, onClose)`.
 */
export function useDismissable(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (!anchorRef.current?.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, anchorRef, onClose]);
}
