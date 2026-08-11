// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { EvidenceWorkspacePrototype } from "../evidence-workspace-prototype";

afterEach(cleanup);

describe("EvidenceWorkspacePrototype", () => {
  it("presents Evidence as a peer workspace tab with report coverage, claims, and exact source context", () => {
    render(<EvidenceWorkspacePrototype />);

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Summary",
      "Transcript",
      "Chat",
      "Evidence",
    ]);
    expect(screen.getByRole("tab", { name: "Evidence" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "Evidence Check" })).toBeTruthy();
    expect(screen.getByText("10 of 12 material claims examined")).toBeTruthy();
    expect(screen.getByText("Confidence: unavailable")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /battery recycling/i }));

    expect(screen.getByRole("heading", { name: /battery recycling mandates/i })).toBeTruthy();
    expect(screen.getByText("Material Inventory Entry MIE-04")).toBeTruthy();
    expect(screen.getAllByText("Claim Unit MCU-04").length).toBeGreaterThan(0);
    expect(screen.getByText("Evidence record for MIE-04 · MCU-04")).toBeTruthy();
    expect(
      screen.getAllByText("Conflicts with retrieved evidence").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/published 18 June 2026/i)).toBeTruthy();
    expect(screen.getByText(/collection improved after the mandate/i)).toBeTruthy();
    expect(screen.queryByText(/accuracy score/i)).toBeNull();
  });

  it("reconciles every Finding and governed exclusion to the 12-entry inventory", () => {
    render(<EvidenceWorkspacePrototype initialVariant="coverage-ledger" />);

    fireEvent.click(
      screen.getByText("Full material inventory · 12 entries"),
    );

    const inventory = screen.getByRole("list", {
      name: "Full material inventory",
    });
    const inventoryEntries = within(inventory).getAllByRole("listitem");
    expect(inventoryEntries).toHaveLength(12);
    expect(
      inventoryEntries.every((entry) => /MIE-\d{2}/.test(entry.textContent ?? "")),
    ).toBe(true);
    expect(
      inventoryEntries.slice(0, 10).every((entry) =>
        /Claim Unit MCU-\d{2}/.test(entry.textContent ?? ""),
      ),
    ).toBe(true);
    expect(
      inventoryEntries.slice(10).every((entry) =>
        !/Claim Unit MCU-/.test(entry.textContent ?? ""),
      ),
    ).toBe(true);
    const materialInventoryEntryIds = inventoryEntries.flatMap((entry) =>
      entry.textContent?.match(/MIE-\d{2}/g) ?? [],
    );
    const claimUnitIds = inventoryEntries.flatMap((entry) =>
      entry.textContent?.match(/MCU-\d{2}/g) ?? [],
    );
    expect(new Set(materialInventoryEntryIds).size).toBe(12);
    expect(new Set(claimUnitIds).size).toBe(10);
    expect(within(inventory).getAllByText(/— Finding complete ·/)).toHaveLength(10);
    expect(screen.getByText(/visual_dependency/)).toBeTruthy();
    expect(screen.getByText(/pending_prediction/)).toBeTruthy();
    expect(screen.getByText(/MIE-10 · Consequential · 18:22–18:34/)).toBeTruthy();
    expect(screen.getByText(/MIE-11 · Consequential · 19:45–19:57/)).toBeTruthy();
    expect(screen.queryByText(/source acquisition/i)).toBeNull();
    expect(screen.queryByText(/cap_omitted/i)).toBeNull();
  });

  it("discloses every governed origin for a multi-source Finding", () => {
    render(<EvidenceWorkspacePrototype />);

    fireEvent.click(screen.getByRole("button", { name: /used ev prices/i }));

    expect(screen.getByText("All material evidence origins · 2")).toBeTruthy();
    expect(
      screen.getByText(/SRC-09-A · Transport Economics Observatory/),
    ).toBeTruthy();
    expect(
      screen.getByText(/SRC-09-B · UK Vehicle Valuation Institute/),
    ).toBeTruthy();
    expect(screen.getByText("ESP-2026-08-11.v1")).toBeTruthy();
    expect(screen.getAllByText("Conflicts with retrieved evidence").length).toBeGreaterThan(0);
  });

  it("uses two independent claim-complete origins for every directional Finding", () => {
    render(<EvidenceWorkspacePrototype />);

    const directionalFindings = [
      /manufacturing emissions/i,
      /lifetime emissions/i,
      /mineral demand/i,
      /battery recycling mandates/i,
      /home charging cost/i,
      /cold-weather range/i,
      /grid demand timing/i,
      /used ev prices/i,
    ];
    for (const name of directionalFindings) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.getByText("All material evidence origins · 2")).toBeTruthy();
    }
  });

  it("uses Conflicts for contradicted quantities and Qualified only for a supported bounded claim", () => {
    render(<EvidenceWorkspacePrototype initialVariant="coverage-ledger" />);

    expect(screen.getByText("Qualified").parentElement?.textContent).toBe("1Qualified");
    expect(screen.getByText("Conflicts").parentElement?.textContent).toBe("4Conflicts");

    fireEvent.click(screen.getByRole("button", { name: /building an electric car always/i }));
    expect(screen.getAllByText("Conflicts with retrieved evidence").length).toBeGreaterThan(0);
    expect(screen.getByText("Sufficient for a directional conflict under the source policy.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /battery recycling mandates/i }));
    expect(screen.getAllByText("Conflicts with retrieved evidence").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /cold-weather road tests/i }));
    expect(screen.getAllByText("Qualified by retrieved evidence").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/8% to 24%/i)).toHaveLength(2);
  });

  it("keeps the prior dated report visible when recheck is due and while a recheck runs", () => {
    render(<EvidenceWorkspacePrototype initialFixture="recheck" />);

    expect(screen.getAllByText("Recheck due").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/report dated 8 august 2026/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Request recheck" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Request recheck" }));

    expect(screen.getByRole("status").textContent).toMatch(/reviewing evidence/i);
    expect(screen.getAllByText(/report dated 8 august 2026/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Cancel recheck" })).toBeTruthy();
  });

  it("shows an append-only correction history with a before-and-after finding", () => {
    render(<EvidenceWorkspacePrototype initialFixture="corrected" />);

    expect(screen.getByRole("heading", { name: "Report history" })).toBeTruthy();
    expect(screen.getByText("Current · version 2")).toBeTruthy();
    expect(screen.getByText("Superseded · version 1")).toBeTruthy();
    expect(screen.getByText(/before: supported by retrieved evidence/i)).toBeTruthy();
    expect(
      screen.getByText(/after: conflicts with retrieved evidence/i),
    ).toBeTruthy();
  });

  it.each([
    ["expired", "This dated report can no longer be presented as current evidence"],
    ["suppressed", "This complete report is temporarily unavailable"],
    ["withdrawn", "There is no active Evidence report"],
  ] as const)("keeps %s distinct and exposes only its governed history shell", (fixture, title) => {
    render(<EvidenceWorkspacePrototype initialFixture={fixture} />);

    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getByText("Report history shell")).toBeTruthy();
    expect(screen.queryByText(/collection improved after the mandate/i)).toBeNull();
  });

  it("offers Retry only for the bounded retryable failure fixture", () => {
    render(<EvidenceWorkspacePrototype initialFixture="failed" />);

    expect(screen.getByRole("heading", { name: "A technical problem stopped this check" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry Evidence Check" })).toBeTruthy();
    expect(screen.getByText(/no finding or partial report was published/i)).toBeTruthy();
  });

  it("makes waiting, abstention, and no-report states explicit without provider internals", () => {
    const view = render(<EvidenceWorkspacePrototype initialFixture="progress" />);

    expect(screen.getByRole("status").textContent).toMatch(/reviewing evidence/i);
    expect(screen.getByText(/you can leave this page/i)).toBeTruthy();
    expect(screen.queryByText(/percent|provider|model/i)).toBeNull();

    view.unmount();
    render(<EvidenceWorkspacePrototype initialFixture="not-eligible" />);
    expect(screen.getByRole("heading", { name: "No report was created" })).toBeTruthy();
    expect(screen.getByText(/visual demonstration/i)).toBeTruthy();
    expect(screen.getByText(/no Finding or Evidence Relationship exists/i)).toBeTruthy();
  });

  it("describes visual dependency as an eligibility exclusion, never abstention", () => {
    render(<EvidenceWorkspacePrototype initialFixture="request" />);

    expect(screen.getByText(/visual dependency may be ineligible or excluded/i)).toBeTruthy();
    expect(screen.queryByText(/may abstain/i)).toBeNull();
  });

  it("models durable waiting and private notices behind reauthorization", () => {
    const view = render(
      <EvidenceWorkspacePrototype initialFixture="waiting" />,
    );

    expect(screen.getByRole("status").textContent).toMatch(/waiting for sources/i);
    expect(screen.getByText(/durable stage is saved/i)).toBeTruthy();
    expect(screen.queryByText(/percentage|completion estimate/i)).not.toBeNull();

    view.unmount();
    render(<EvidenceWorkspacePrototype initialFixture="notices" />);
    const noticeButtons = screen.getAllByRole("button", {
      name: /review private update/i,
    });
    expect(noticeButtons).toHaveLength(9);
    const noticeChecks = [
      /10 of 12 inventory entries/i,
      /one bounded Retry authorization/i,
      /not current-status evidence/i,
      /version 1 is superseded/i,
      /authorized review is pending/i,
      /no Finding exists/i,
      /report display was restored/i,
      /no active report can be displayed/i,
      /authorized Case disposition/i,
    ] as const;
    for (const [index, privateDetail] of noticeChecks.entries()) {
      fireEvent.click(noticeButtons[index]!);
      expect(screen.getByText("Reauthorization required")).toBeTruthy();
      expect(screen.queryByText(privateDetail)).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue as demo learner" }),
      );
      expect(screen.getByText(privateDetail)).toBeTruthy();
    }
  });

  it("executes the simulated seeded-error comprehension protocol across six concepts", () => {
    render(<EvidenceWorkspacePrototype initialFixture="comprehension" />);

    expect(
      screen.getByText(/simulated protocol.*no human participant or launch evidence/i),
    ).toBeTruthy();

    const answers = [
      [/bounded claim scope/i, "uk-three-year"],
      [/which correction/i, "conflicts"],
      [/what does Unresolved mean/i, "abstains"],
      [/what does 10 of 12 Coverage mean/i, "ten-plus-two"],
      [/what may you conclude/i, "evidence-not-honesty"],
      [/what does Confidence: unavailable mean/i, "not-estimated"],
    ] as const;
    for (const [label, value] of answers) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(screen.getByLabelText(/bounded claim scope/i), {
      target: { value: "global" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Evaluate simulated response" }));
    expect(screen.getByRole("status").textContent).toMatch(/observation incomplete/i);

    for (const [label, value] of answers) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Evaluate simulated response" }));
    expect(screen.getByRole("status").textContent).toMatch(
      /six concepts demonstrated.*overreliance check passed/i,
    );
  });

  it("switches variants only from the explicit canvas and leaves workspace tabs and form controls alone", () => {
    window.history.replaceState({}, "", "/summary?evidencePrototype=1");
    const { container } = render(<EvidenceWorkspacePrototype />);
    const prototypeBar = screen.getByRole("region", { name: "Prototype controls" });
    const canvas = screen.getByRole("region", {
      name: /Evidence prototype canvas/i,
    });

    expect(container.querySelector('[data-evidence-layout="claim-desk"]')).toBeTruthy();
    const evidenceTab = screen.getByRole("tab", { name: "Evidence" });
    evidenceTab.focus();
    fireEvent.keyDown(evidenceTab, { key: "ArrowRight" });
    expect(container.querySelector('[data-evidence-layout="claim-desk"]')).toBeTruthy();

    canvas.focus();
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(container.querySelector('[data-evidence-layout="coverage-ledger"]')).toBeTruthy();
    expect(new URL(window.location.href).searchParams.get("variant")).toBe(
      "coverage-ledger",
    );
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(container.querySelector('[data-evidence-layout="guided-dossier"]')).toBeTruthy();

    const fixtureSelect = screen.getByRole("combobox", { name: "Fixture state" });
    fixtureSelect.focus();
    fireEvent.change(fixtureSelect, { target: { value: "corrected" } });
    expect(new URL(window.location.href).searchParams.get("fixture")).toBe(
      "corrected",
    );
    fireEvent.keyDown(fixtureSelect, { key: "ArrowLeft" });
    expect(container.querySelector('[data-evidence-layout="guided-dossier"]')).toBeTruthy();
    expect(prototypeBar).toBeTruthy();
  });

  it("honors a pre-cancelled arrow event on the explicit canvas", () => {
    const { container } = render(<EvidenceWorkspacePrototype />);
    const canvas = screen.getByRole("region", {
      name: /Evidence prototype canvas/i,
    });
    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();

    fireEvent(canvas, event);

    expect(container.querySelector('[data-evidence-layout="claim-desk"]')).toBeTruthy();
  });
});
