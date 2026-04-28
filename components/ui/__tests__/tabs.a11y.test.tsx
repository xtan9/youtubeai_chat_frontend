// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

describe("Tabs a11y", () => {
  it("default tabs render with no axe violations", async () => {
    const { container } = renderWithProviders(
      <Tabs defaultValue="account">
        <TabsList aria-label="Settings sections">
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="password">Password</TabsTrigger>
        </TabsList>
        <TabsContent value="account">
          <p>Update your account email and display name.</p>
        </TabsContent>
        <TabsContent value="password">
          <p>Change your password.</p>
        </TabsContent>
      </Tabs>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("vertical orientation has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Tabs defaultValue="overview" orientation="vertical">
        <TabsList aria-label="Project nav">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">overview</TabsContent>
        <TabsContent value="reports">reports</TabsContent>
        <TabsContent value="settings">settings</TabsContent>
      </Tabs>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("disabled trigger has no axe violations", async () => {
    const { container } = renderWithProviders(
      <Tabs defaultValue="a">
        <TabsList aria-label="Demo">
          <TabsTrigger value="a">Available</TabsTrigger>
          <TabsTrigger value="b" disabled>
            Coming soon
          </TabsTrigger>
        </TabsList>
        <TabsContent value="a">a</TabsContent>
        <TabsContent value="b">b</TabsContent>
      </Tabs>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
