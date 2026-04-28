// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Breadcrumb", () => {
  describe("default render", () => {
    it("emits a nav with aria-label='breadcrumb' wrapping an ordered list", () => {
      renderWithProviders(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Library</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>,
      );
      const nav = screen.getByRole("navigation", { name: "breadcrumb" });
      expect(nav.tagName).toBe("NAV");
      expect(nav.querySelector("ol")).toBeTruthy();
    });

    it("emits data-slot on every part", () => {
      renderWithProviders(
        <Breadcrumb data-testid="root">
          <BreadcrumbList data-testid="list">
            <BreadcrumbItem data-testid="item">
              <BreadcrumbLink href="/" data-testid="link">
                Home
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator data-testid="sep" />
            <BreadcrumbItem>
              <BreadcrumbEllipsis data-testid="ellipsis" />
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage data-testid="page">Now</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>,
      );
      expect(screen.getByTestId("root").getAttribute("data-slot")).toBe(
        "breadcrumb",
      );
      expect(screen.getByTestId("list").getAttribute("data-slot")).toBe(
        "breadcrumb-list",
      );
      expect(screen.getByTestId("item").getAttribute("data-slot")).toBe(
        "breadcrumb-item",
      );
      expect(screen.getByTestId("link").getAttribute("data-slot")).toBe(
        "breadcrumb-link",
      );
      expect(screen.getByTestId("sep").getAttribute("data-slot")).toBe(
        "breadcrumb-separator",
      );
      expect(screen.getByTestId("ellipsis").getAttribute("data-slot")).toBe(
        "breadcrumb-ellipsis",
      );
      expect(screen.getByTestId("page").getAttribute("data-slot")).toBe(
        "breadcrumb-page",
      );
    });
  });

  describe("BreadcrumbPage semantics", () => {
    it("BreadcrumbPage has aria-current='page' and role='link' aria-disabled", () => {
      renderWithProviders(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Current</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>,
      );
      const page = screen.getByText("Current");
      expect(page.getAttribute("aria-current")).toBe("page");
      expect(page.getAttribute("role")).toBe("link");
      expect(page.getAttribute("aria-disabled")).toBe("true");
    });
  });

  describe("BreadcrumbSeparator", () => {
    it("is presentation, aria-hidden, and renders the default chevron when no children", () => {
      renderWithProviders(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/">Home</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator data-testid="sep" />
            <BreadcrumbItem>
              <BreadcrumbPage>Now</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>,
      );
      const sep = screen.getByTestId("sep");
      expect(sep.getAttribute("role")).toBe("presentation");
      expect(sep.getAttribute("aria-hidden")).toBe("true");
      expect(sep.querySelector("svg")).toBeTruthy();
    });

    it("renders custom children when provided", () => {
      renderWithProviders(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbSeparator>/</BreadcrumbSeparator>
          </BreadcrumbList>
        </Breadcrumb>,
      );
      expect(screen.getByText("/")).toBeTruthy();
    });
  });

  describe("BreadcrumbEllipsis", () => {
    it("renders with sr-only 'More' text and is aria-hidden", () => {
      renderWithProviders(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbEllipsis data-testid="ellipsis" />
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>,
      );
      const e = screen.getByTestId("ellipsis");
      expect(e.getAttribute("aria-hidden")).toBe("true");
      expect(e.textContent).toContain("More");
    });
  });

  describe("BreadcrumbLink", () => {
    it("renders an anchor by default", () => {
      renderWithProviders(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/library">Library</BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>,
      );
      const link = screen.getByRole("link", { name: "Library" });
      expect(link.tagName).toBe("A");
      expect(link.getAttribute("href")).toBe("/library");
    });

    it("forwards onto a child via asChild for Next.js Link composition", () => {
      renderWithProviders(
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <a href="/library" data-testid="custom-link">
                  Library
                </a>
              </BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>,
      );
      const link = screen.getByTestId("custom-link");
      expect(link.tagName).toBe("A");
      expect(link.getAttribute("data-slot")).toBe("breadcrumb-link");
    });
  });

  describe("native prop forwarding", () => {
    it("merges consumer className onto every part", () => {
      renderWithProviders(
        <Breadcrumb className="my-bc" data-testid="root">
          <BreadcrumbList className="my-list" data-testid="list">
            <BreadcrumbItem className="my-item" data-testid="item">
              <BreadcrumbLink
                href="/"
                className="my-link"
                data-testid="link"
              >
                Home
              </BreadcrumbLink>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>,
      );
      expect(screen.getByTestId("root").className).toBe("my-bc");
      expect(screen.getByTestId("list").className).toContain("my-list");
      expect(screen.getByTestId("list").className).toContain("flex-wrap");
      expect(screen.getByTestId("item").className).toContain("my-item");
      expect(screen.getByTestId("link").className).toContain("my-link");
    });
  });
});
