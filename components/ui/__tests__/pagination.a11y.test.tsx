// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Pagination a11y", () => {
  it("standard pagination has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious href="?page=1" />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="?page=1">1</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="?page=2" isActive>
              2
            </PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="?page=3">3</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext href="?page=3" />
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("pagination with ellipsis has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationLink href="?page=1">1</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationEllipsis />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="?page=12" isActive>
              12
            </PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationEllipsis />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="?page=24">24</PaginationLink>
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("first-page (no Previous link) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationLink href="?page=1" isActive>
              1
            </PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="?page=2">2</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationNext href="?page=2" />
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
