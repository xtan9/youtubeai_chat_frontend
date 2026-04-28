// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Table a11y", () => {
  it("data table with caption + header + body has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Table>
          <TableCaption>Recent invoices.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>INV001</TableCell>
              <TableCell>Paid</TableCell>
              <TableCell>$250.00</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>INV002</TableCell>
              <TableCell>Pending</TableCell>
              <TableCell>$125.50</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("table with footer (totals row) has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Qty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Widget</TableCell>
              <TableCell>3</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Gadget</TableCell>
              <TableCell>2</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell>5</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("table with row-selection state has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow data-state="selected" aria-selected="true">
              <TableCell>Alice</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Bob</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
