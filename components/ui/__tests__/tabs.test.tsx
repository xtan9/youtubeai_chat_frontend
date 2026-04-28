// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Tabs", () => {
  describe("default render", () => {
    it("renders a tablist with triggers and shows the default tab's panel", () => {
      renderWithProviders(
        <Tabs defaultValue="account">
          <TabsList>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
          </TabsList>
          <TabsContent value="account">account-panel</TabsContent>
          <TabsContent value="password">password-panel</TabsContent>
        </Tabs>,
      );
      expect(screen.getByRole("tablist")).toBeTruthy();
      expect(screen.getAllByRole("tab")).toHaveLength(2);
      expect(screen.getByText("account-panel")).toBeTruthy();
      // Inactive panel is hidden via `hidden` attribute, but Radix still
      // mounts it; it's not visible to AT.
      expect(screen.queryByText("password-panel")).toBeNull();
    });

    it("emits data-slot on every part", () => {
      renderWithProviders(
        <Tabs defaultValue="a" data-testid="root">
          <TabsList data-testid="list">
            <TabsTrigger value="a" data-testid="trig-a">
              A
            </TabsTrigger>
            <TabsTrigger value="b" data-testid="trig-b">
              B
            </TabsTrigger>
          </TabsList>
          <TabsContent value="a" data-testid="content-a">
            A
          </TabsContent>
          <TabsContent value="b" data-testid="content-b">
            B
          </TabsContent>
        </Tabs>,
      );
      expect(screen.getByTestId("root").getAttribute("data-slot")).toBe("tabs");
      expect(screen.getByTestId("list").getAttribute("data-slot")).toBe(
        "tabs-list",
      );
      expect(screen.getByTestId("trig-a").getAttribute("data-slot")).toBe(
        "tabs-trigger",
      );
      expect(screen.getByTestId("content-a").getAttribute("data-slot")).toBe(
        "tabs-content",
      );
    });
  });

  describe("interaction", () => {
    it("activating a trigger switches the active panel", () => {
      // Radix tabs activate on `mousedown` (not the click event) to feel
      // snappy. happy-dom doesn't synthesize mousedown from click(), so
      // we fire it directly. Mirror this in any test that flips tabs.
      renderWithProviders(
        <Tabs defaultValue="account">
          <TabsList>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
          </TabsList>
          <TabsContent value="account">account-panel</TabsContent>
          <TabsContent value="password">password-panel</TabsContent>
        </Tabs>,
      );
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Password" }), {
        button: 0,
      });
      expect(screen.getByText("password-panel")).toBeTruthy();
      expect(screen.queryByText("account-panel")).toBeNull();
    });

    it("active tab carries data-state=active and aria-selected=true", () => {
      renderWithProviders(
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">A</TabsTrigger>
            <TabsTrigger value="b">B</TabsTrigger>
          </TabsList>
          <TabsContent value="a">A</TabsContent>
          <TabsContent value="b">B</TabsContent>
        </Tabs>,
      );
      const tabA = screen.getByRole("tab", { name: "A" });
      const tabB = screen.getByRole("tab", { name: "B" });
      expect(tabA.getAttribute("data-state")).toBe("active");
      expect(tabA.getAttribute("aria-selected")).toBe("true");
      expect(tabB.getAttribute("data-state")).toBe("inactive");
      expect(tabB.getAttribute("aria-selected")).toBe("false");
    });
  });

  describe("controlled mode", () => {
    function Harness() {
      const [value, setValue] = useState("a");
      return (
        <>
          <button type="button" onClick={() => setValue("b")}>
            external-b
          </button>
          <Tabs value={value} onValueChange={setValue}>
            <TabsList>
              <TabsTrigger value="a">A</TabsTrigger>
              <TabsTrigger value="b">B</TabsTrigger>
            </TabsList>
            <TabsContent value="a">a-panel</TabsContent>
            <TabsContent value="b">b-panel</TabsContent>
          </Tabs>
        </>
      );
    }

    it("respects external value updates", () => {
      renderWithProviders(<Harness />);
      expect(screen.getByText("a-panel")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "external-b" }));
      expect(screen.getByText("b-panel")).toBeTruthy();
    });

    it("calls onValueChange when a trigger is activated", () => {
      const onValueChange = vi.fn();
      renderWithProviders(
        <Tabs value="a" onValueChange={onValueChange}>
          <TabsList>
            <TabsTrigger value="a">A</TabsTrigger>
            <TabsTrigger value="b">B</TabsTrigger>
          </TabsList>
          <TabsContent value="a">a</TabsContent>
          <TabsContent value="b">b</TabsContent>
        </Tabs>,
      );
      fireEvent.mouseDown(screen.getByRole("tab", { name: "B" }), {
        button: 0,
      });
      expect(onValueChange).toHaveBeenCalledWith("b");
    });
  });

  describe("disabled trigger", () => {
    it("clicking a disabled trigger does not change the active panel", () => {
      const onValueChange = vi.fn();
      renderWithProviders(
        <Tabs defaultValue="a" onValueChange={onValueChange}>
          <TabsList>
            <TabsTrigger value="a">A</TabsTrigger>
            <TabsTrigger value="b" disabled>
              B
            </TabsTrigger>
          </TabsList>
          <TabsContent value="a">a-panel</TabsContent>
          <TabsContent value="b">b-panel</TabsContent>
        </Tabs>,
      );
      const tabB = screen.getByRole("tab", { name: "B" });
      expect(tabB.getAttribute("data-disabled")).toBe("");
      fireEvent.mouseDown(tabB, { button: 0 });
      expect(onValueChange).not.toHaveBeenCalled();
      expect(screen.getByText("a-panel")).toBeTruthy();
    });
  });

  describe("native prop forwarding", () => {
    it("merges consumer className onto root + list + trigger + content", () => {
      renderWithProviders(
        <Tabs defaultValue="a" className="my-tabs" data-testid="root">
          <TabsList className="my-list" data-testid="list">
            <TabsTrigger value="a" className="my-trig" data-testid="trig">
              A
            </TabsTrigger>
          </TabsList>
          <TabsContent value="a" className="my-content" data-testid="content">
            A
          </TabsContent>
        </Tabs>,
      );
      expect(screen.getByTestId("root").className).toContain("my-tabs");
      expect(screen.getByTestId("root").className).toContain("flex-col");
      expect(screen.getByTestId("list").className).toContain("my-list");
      expect(screen.getByTestId("list").className).toContain("bg-surface-sunken");
      expect(screen.getByTestId("trig").className).toContain("my-trig");
      expect(screen.getByTestId("content").className).toContain("my-content");
    });
  });

  describe("orientation", () => {
    it("vertical orientation propagates aria-orientation to the tablist", () => {
      renderWithProviders(
        <Tabs defaultValue="a" orientation="vertical">
          <TabsList>
            <TabsTrigger value="a">A</TabsTrigger>
            <TabsTrigger value="b">B</TabsTrigger>
          </TabsList>
          <TabsContent value="a">a</TabsContent>
          <TabsContent value="b">b</TabsContent>
        </Tabs>,
      );
      expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe(
        "vertical",
      );
    });
  });
});
