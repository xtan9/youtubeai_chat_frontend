// @vitest-environment happy-dom
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Footer } from "../footer";

afterEach(cleanup);

describe("Footer", () => {
  it("exposes a Contact mailto link to contact@youtubeai.chat", () => {
    render(<Footer />);
    const link = screen.getByRole("link", { name: /contact/i });
    expect(link.getAttribute("href")).toBe("mailto:contact@youtubeai.chat");
  });
});
