// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { axe } from "@/tests-utils/axe";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

function LoginForm({ withErrors = false }: { withErrors?: boolean }) {
  const form = useForm<{ email: string; password: string }>({
    defaultValues: withErrors ? { email: "", password: "" } : { email: "user@example.com", password: "secret123" },
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(() => {})}
        noValidate
      >
        <FormField
          control={form.control}
          name="email"
          rules={{ required: "Email is required" }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormDescription>Your work email.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          rules={{ required: "Password is required" }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Sign in</Button>
      </form>
    </Form>
  );
}

function MultiFieldForm() {
  const form = useForm<{ name: string; bio: string }>({
    defaultValues: { name: "Jane", bio: "" },
  });
  return (
    <Form {...form}>
      <form>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="bio"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Bio</FormLabel>
              <FormControl>
                <Textarea {...field} />
              </FormControl>
              <FormDescription>Up to 280 characters.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

describe("Form a11y", () => {
  it("login form (clean state) has no axe violations", async () => {
    const { container } = renderWithProviders(<LoginForm />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("login form (validation errors visible) has no axe violations", async () => {
    const { container } = renderWithProviders(<LoginForm withErrors />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    // Let RHF emit validation errors
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // Axe against the rendered container only — the bare test document isn't
    // a full landmark-bearing page, but the form's a11y is what we're pinning.
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("multi-field form (Input + Textarea) has no axe violations", async () => {
    const { container } = renderWithProviders(<MultiFieldForm />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("FormDescription contributes to aria-describedby", async () => {
    const { container } = renderWithProviders(<LoginForm />);
    const emailControl = container.querySelector(
      'input[type="email"]',
    ) as HTMLInputElement;
    const describedBy = emailControl.getAttribute("aria-describedby") ?? "";
    const descId = `${describedBy.split(/\s+/)[0]}`;
    const desc = container.querySelector(`#${descId}`);
    expect(desc?.textContent).toBe("Your work email.");
  });
});
