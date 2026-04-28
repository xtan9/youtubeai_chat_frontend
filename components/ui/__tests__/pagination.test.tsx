// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Pagination", () => {
  describe("default render", () => {
    it("emits a nav with role='navigation' and aria-label='pagination'", () => {
      renderWithProviders(
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#" />
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#" isActive>
                1
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext href="#" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>,
      );
      const nav = screen.getByRole("navigation", { name: "pagination" });
      expect(nav.tagName).toBe("NAV");
      expect(nav.querySelector("ul")).toBeTruthy();
    });

    it("emits data-slot on every part", () => {
      renderWithProviders(
        <Pagination data-testid="root">
          <PaginationContent data-testid="content">
            <PaginationItem data-testid="item">
              <PaginationLink href="#" data-testid="link">
                1
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationEllipsis data-testid="ellipsis" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>,
      );
      expect(screen.getByTestId("root").getAttribute("data-slot")).toBe(
        "pagination",
      );
      expect(screen.getByTestId("content").getAttribute("data-slot")).toBe(
        "pagination-content",
      );
      expect(screen.getByTestId("item").getAttribute("data-slot")).toBe(
        "pagination-item",
      );
      expect(screen.getByTestId("link").getAttribute("data-slot")).toBe(
        "pagination-link",
      );
      expect(screen.getByTestId("ellipsis").getAttribute("data-slot")).toBe(
        "pagination-ellipsis",
      );
    });
  });

  describe("PaginationLink active state", () => {
    it("active link gets aria-current='page' and data-active='true'", () => {
      renderWithProviders(
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationLink href="#1" isActive>
                1
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#2">2</PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>,
      );
      const active = screen.getByRole("link", { name: "1" });
      const inactive = screen.getByRole("link", { name: "2" });
      expect(active.getAttribute("aria-current")).toBe("page");
      expect(active.getAttribute("data-active")).toBe("true");
      expect(inactive.getAttribute("aria-current")).toBeNull();
      // React serializes `data-active={undefined}` (the default for
      // isActive) by omitting the attribute entirely.
      expect(inactive.getAttribute("data-active")).toBeNull();
    });

    it("active link uses the outline button variant; inactive uses ghost", () => {
      renderWithProviders(
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationLink href="#1" isActive data-testid="active">
                1
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink href="#2" data-testid="inactive">
                2
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>,
      );
      // Outline variant has `border` baseline; ghost does not.
      expect(screen.getByTestId("active").className).toContain("border");
      expect(screen.getByTestId("inactive").className).not.toContain(
        "border-input",
      );
    });
  });

  describe("PaginationPrevious / Next", () => {
    it("Previous renders with aria-label 'Go to previous page'", () => {
      renderWithProviders(
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious href="#" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>,
      );
      const link = screen.getByRole("link", {
        name: /go to previous page/i,
      });
      expect(link.getAttribute("aria-label")).toBe("Go to previous page");
    });

    it("Next renders with aria-label 'Go to next page'", () => {
      renderWithProviders(
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationNext href="#" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>,
      );
      const link = screen.getByRole("link", { name: /go to next page/i });
      expect(link.getAttribute("aria-label")).toBe("Go to next page");
    });
  });

  describe("PaginationEllipsis", () => {
    it("is aria-hidden and ships an sr-only 'More pages' label", () => {
      renderWithProviders(
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationEllipsis data-testid="el" />
            </PaginationItem>
          </PaginationContent>
        </Pagination>,
      );
      const e = screen.getByTestId("el");
      expect(e.getAttribute("aria-hidden")).toBeTruthy();
      expect(e.textContent).toContain("More pages");
    });
  });

  describe("native prop forwarding", () => {
    it("merges consumer className onto root + content + link", () => {
      renderWithProviders(
        <Pagination className="my-pag" data-testid="root">
          <PaginationContent className="my-content" data-testid="content">
            <PaginationItem>
              <PaginationLink
                href="#"
                className="my-link"
                data-testid="link"
              >
                1
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>,
      );
      expect(screen.getByTestId("root").className).toContain("my-pag");
      expect(screen.getByTestId("root").className).toContain("justify-center");
      expect(screen.getByTestId("content").className).toContain("my-content");
      expect(screen.getByTestId("link").className).toContain("my-link");
    });
  });
});
