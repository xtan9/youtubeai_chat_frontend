// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { axe, axePortalOverlay } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

// Closed Select renders only the trigger inside the consumer's
// landmark — use the default `axe` runner.
// Open Select portals the listbox content out of the landmark and
// uses Radix focus guards — use `axePortalOverlay` (suppresses
// `aria-hidden-focus` and `region`).

describe("Select a11y", () => {
  it("closed select with a label has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <label htmlFor="fruit">Favorite fruit</label>
        <Select>
          <SelectTrigger id="fruit">
            <SelectValue placeholder="Pick a fruit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
          </SelectContent>
        </Select>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("open select (forced) with options has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <label htmlFor="fruit2">Pick a fruit</label>
        <Select open>
          <SelectTrigger id="fruit2">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectItem value="banana">Banana</SelectItem>
          </SelectContent>
        </Select>
      </main>,
    );
    const results = await axePortalOverlay(container);
    expect(results).toHaveNoViolations();
  });

  it("open select with a labeled group + separator has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <label htmlFor="food">Pick something</label>
        <Select open>
          <SelectTrigger id="food">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Fruits</SelectLabel>
              <SelectItem value="apple">Apple</SelectItem>
              <SelectItem value="banana">Banana</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Dairy</SelectLabel>
              <SelectItem value="cheese">Cheese</SelectItem>
              <SelectItem value="yogurt">Yogurt</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </main>,
    );
    const results = await axePortalOverlay(container);
    expect(results).toHaveNoViolations();
  });

  it("disabled select has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <label htmlFor="locked">Locked select</label>
        <Select disabled>
          <SelectTrigger id="locked">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
          </SelectContent>
        </Select>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("size='sm' select has no axe violations", async () => {
    const { container } = renderWithProviders(
      <main>
        <label htmlFor="sm">Compact select</label>
        <Select>
          <SelectTrigger size="sm" id="sm">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="apple">Apple</SelectItem>
          </SelectContent>
        </Select>
      </main>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
