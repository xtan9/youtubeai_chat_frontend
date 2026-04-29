// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChatInput } from "../chat-input";

afterEach(() => cleanup());

interface RenderProps {
  value?: string;
  streaming?: boolean;
  disabled?: boolean;
  onSend?: () => void;
  onStop?: () => void;
  onChange?: (v: string) => void;
}

function renderInput(props: RenderProps = {}) {
  const onSend = props.onSend ?? vi.fn();
  const onStop = props.onStop ?? vi.fn();
  const onChange = props.onChange ?? vi.fn();
  render(
    <ChatInput
      value={props.value ?? ""}
      onChange={onChange}
      onSend={onSend}
      onStop={onStop}
      streaming={props.streaming ?? false}
      disabled={props.disabled ?? false}
    />
  );
  return { onSend, onStop, onChange };
}

describe("ChatInput", () => {
  it("submits on Enter with non-empty value", () => {
    const { onSend } = renderInput({ value: "Hello?" });
    const textarea = screen.getByRole("textbox", { name: /chat message/i });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("does NOT submit on Shift+Enter (newline)", () => {
    const { onSend } = renderInput({ value: "Hello?" });
    const textarea = screen.getByRole("textbox", { name: /chat message/i });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does NOT submit on Enter when value is empty/whitespace", () => {
    const { onSend } = renderInput({ value: "   " });
    const textarea = screen.getByRole("textbox", { name: /chat message/i });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does NOT submit on Enter while streaming", () => {
    const { onSend } = renderInput({ value: "Hi", streaming: true });
    const textarea = screen.getByRole("textbox", { name: /chat message/i });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("renders Stop button while streaming and clicking it calls onStop", () => {
    const { onStop, onSend } = renderInput({ value: "Hi", streaming: true });
    const stopButton = screen.getByRole("button", { name: /stop generating/i });
    fireEvent.click(stopButton);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    // No Send button while streaming.
    expect(
      screen.queryByRole("button", { name: /send message/i })
    ).toBeNull();
  });

  it("Send button is disabled when value is empty", () => {
    renderInput({ value: "" });
    const sendButton = screen.getByRole("button", {
      name: /send message/i,
    }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
  });

  it("does NOT submit Enter during IME composition", () => {
    const { onSend } = renderInput({ value: "你好" });
    const textarea = screen.getByRole("textbox", { name: /chat message/i });
    // happy-dom passes the inits straight through to the underlying
    // KeyboardEvent; nativeEvent.isComposing is read off the keyboard
    // event itself, so set it on the dispatched event.
    const evt = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    Object.defineProperty(evt, "isComposing", { value: true });
    textarea.dispatchEvent(evt);
    expect(onSend).not.toHaveBeenCalled();
  });
});
