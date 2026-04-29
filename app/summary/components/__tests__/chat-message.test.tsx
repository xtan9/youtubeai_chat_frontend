// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { ChatMessage } from "../chat-message";
import { PlayerRefProvider, usePlayerRef } from "@/lib/contexts/player-ref";
import { useEffect } from "react";

afterEach(() => cleanup());

function PlayerRegister({ seekTo }: { seekTo: (s: number, b?: boolean) => void }) {
  const { registerPlayer } = usePlayerRef();
  useEffect(() => {
    registerPlayer({ seekTo });
  }, [registerPlayer, seekTo]);
  return null;
}

describe("ChatMessage", () => {
  it("renders user content as plain text in a right-aligned bubble", () => {
    render(<ChatMessage role="user" content="What's the main argument?" />);
    expect(screen.getByText("What's the main argument?")).toBeTruthy();
  });

  it("renders assistant timestamps as clickable chips that seek the player", () => {
    const seekTo = vi.fn();
    render(
      <PlayerRefProvider>
        <PlayerRegister seekTo={seekTo} />
        <ChatMessage
          role="assistant"
          content="They explain it [4:32] very clearly."
        />
      </PlayerRefProvider>
    );
    const chip = screen.getByRole("button", { name: /Seek video to \[4:32\]/i });
    fireEvent.click(chip);
    expect(seekTo).toHaveBeenCalledWith(4 * 60 + 32, true);
  });

  it("keeps malformed timestamps as plain text (no chip)", () => {
    render(<ChatMessage role="assistant" content="Look at [99:99]" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
