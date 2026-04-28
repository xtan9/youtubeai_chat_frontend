// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

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
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Table", () => {
  describe("default render", () => {
    it("wraps the table in a scroll container with data-slot=table-container", () => {
      renderWithProviders(
        <Table data-testid="t">
          <TableBody>
            <TableRow>
              <TableCell>x</TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      );
      const table = screen.getByTestId("t");
      expect(table.tagName).toBe("TABLE");
      expect(table.getAttribute("data-slot")).toBe("table");
      const wrapper = table.parentElement;
      expect(wrapper?.getAttribute("data-slot")).toBe("table-container");
      expect(wrapper?.className).toContain("overflow-x-auto");
    });

    it("emits data-slot on every part", () => {
      renderWithProviders(
        <Table>
          <TableCaption data-testid="cap">caption</TableCaption>
          <TableHeader data-testid="head">
            <TableRow data-testid="hrow">
              <TableHead data-testid="th">Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody data-testid="body">
            <TableRow data-testid="brow">
              <TableCell data-testid="td">x</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter data-testid="foot">
            <TableRow>
              <TableCell>total</TableCell>
            </TableRow>
          </TableFooter>
        </Table>,
      );
      expect(screen.getByTestId("cap").getAttribute("data-slot")).toBe(
        "table-caption",
      );
      expect(screen.getByTestId("head").getAttribute("data-slot")).toBe(
        "table-header",
      );
      expect(screen.getByTestId("hrow").getAttribute("data-slot")).toBe(
        "table-row",
      );
      expect(screen.getByTestId("th").getAttribute("data-slot")).toBe(
        "table-head",
      );
      expect(screen.getByTestId("body").getAttribute("data-slot")).toBe(
        "table-body",
      );
      expect(screen.getByTestId("td").getAttribute("data-slot")).toBe(
        "table-cell",
      );
      expect(screen.getByTestId("foot").getAttribute("data-slot")).toBe(
        "table-footer",
      );
    });
  });

  describe("semantic structure", () => {
    it("renders <table>, <thead>, <tbody>, <tr>, <th>, <td>, <caption>, <tfoot>", () => {
      const { container } = renderWithProviders(
        <Table>
          <TableCaption>cap</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>H</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>D</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>F</TableCell>
            </TableRow>
          </TableFooter>
        </Table>,
      );
      expect(container.querySelector("table")).toBeTruthy();
      expect(container.querySelector("thead")).toBeTruthy();
      expect(container.querySelector("tbody")).toBeTruthy();
      expect(container.querySelector("tfoot")).toBeTruthy();
      expect(container.querySelector("caption")).toBeTruthy();
      expect(container.querySelectorAll("tr")).toHaveLength(3);
      expect(container.querySelector("th")).toBeTruthy();
      expect(container.querySelector("td")).toBeTruthy();
    });

    it("retrieves rows by role=row and headers/cells by their accessible name", () => {
      renderWithProviders(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Alice</TableCell>
              <TableCell>alice@example.com</TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      );
      expect(screen.getAllByRole("row")).toHaveLength(2);
      expect(screen.getByRole("columnheader", { name: "Name" })).toBeTruthy();
      expect(
        screen.getByRole("cell", { name: "alice@example.com" }),
      ).toBeTruthy();
    });
  });

  describe("native prop forwarding", () => {
    it("merges className across every part", () => {
      renderWithProviders(
        <Table className="my-table" data-testid="t">
          <TableHeader className="my-head" data-testid="head">
            <TableRow className="my-hrow" data-testid="hrow">
              <TableHead className="my-th" data-testid="th">
                H
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="my-body" data-testid="body">
            <TableRow className="my-brow" data-testid="brow">
              <TableCell className="my-td" data-testid="td">
                C
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      );
      expect(screen.getByTestId("t").className).toContain("my-table");
      expect(screen.getByTestId("head").className).toContain("my-head");
      expect(screen.getByTestId("hrow").className).toContain("my-hrow");
      expect(screen.getByTestId("th").className).toContain("my-th");
      expect(screen.getByTestId("body").className).toContain("my-body");
      expect(screen.getByTestId("brow").className).toContain("my-brow");
      expect(screen.getByTestId("td").className).toContain("my-td");
    });
  });

  describe("selected row state", () => {
    it("data-state=selected on a row reads the selected styling (background hook)", () => {
      renderWithProviders(
        <Table>
          <TableBody>
            <TableRow data-state="selected" data-testid="row">
              <TableCell>x</TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      );
      const row = screen.getByTestId("row");
      expect(row.getAttribute("data-state")).toBe("selected");
      // The class string includes the conditional hook; the actual color
      // is a CSS variable resolved at runtime.
      expect(row.className).toContain("data-[state=selected]:bg-surface-sunken");
    });
  });
});
