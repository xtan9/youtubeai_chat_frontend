// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { ChatEmptyState } from "../chat-empty-state";

afterEach(() => cleanup());

describe("ChatEmptyState", () => {
  it("renders three suggestion buttons", () => {
    render(<ChatEmptyState onPickSuggestion={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
  });

  it("calls onPickSuggestion with the selected text", () => {
    const onPick = vi.fn();
    render(<ChatEmptyState onPickSuggestion={onPick} />);
    const button = screen.getByText("Summarize the key takeaways");
    fireEvent.click(button);
    expect(onPick).toHaveBeenCalledWith("Summarize the key takeaways");
  });
});
