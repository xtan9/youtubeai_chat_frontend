// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { renderWithProviders } from "@/tests-utils/renderWithProviders";

type FormValues = { email: string; name: string };

function TestForm({
  defaultValues = { email: "", name: "" },
  onValidSubmit,
  showDescription = true,
}: {
  defaultValues?: FormValues;
  onValidSubmit?: (v: FormValues) => void;
  showDescription?: boolean;
}) {
  const form = useForm<FormValues>({ defaultValues });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) => onValidSubmit?.(v))}
        noValidate
      >
        <FormField
          control={form.control}
          name="email"
          rules={{
            required: "Email is required",
            pattern: { value: /@/, message: "Must contain @" },
          }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              {showDescription ? (
                <FormDescription>Your work email.</FormDescription>
              ) : null}
              <FormMessage />
            </FormItem>
          )}
        />
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
        <button type="submit">Submit</button>
      </form>
    </Form>
  );
}

describe("Form", () => {
  describe("structure + slots", () => {
    it("FormItem renders with data-slot", () => {
      const { container } = renderWithProviders(<TestForm />);
      const items = container.querySelectorAll('[data-slot="form-item"]');
      expect(items).toHaveLength(2);
    });

    it("FormLabel renders with data-slot=form-label and htmlFor wired to FormControl", () => {
      const { container } = renderWithProviders(<TestForm />);
      const labels = container.querySelectorAll(
        '[data-slot="form-label"]',
      ) as NodeListOf<HTMLLabelElement>;
      const controls = container.querySelectorAll(
        '[data-slot="form-control"]',
      );
      expect(labels.length).toBeGreaterThan(0);
      expect(controls.length).toBeGreaterThan(0);
      // Label.htmlFor must match the corresponding control's id
      labels.forEach((label, i) => {
        expect(controls[i].getAttribute("id")).toBe(label.htmlFor);
      });
    });

    it("FormDescription renders with data-slot and a stable id", () => {
      const { container } = renderWithProviders(<TestForm />);
      const desc = container.querySelector('[data-slot="form-description"]');
      expect(desc).not.toBeNull();
      expect(desc?.getAttribute("id")).toMatch(/-form-item-description$/);
    });

    it("FormDescription is omitted when not rendered", () => {
      const { container } = renderWithProviders(
        <TestForm showDescription={false} />,
      );
      const descs = container.querySelectorAll(
        '[data-slot="form-description"]',
      );
      // Neither field renders FormDescription in this configuration.
      expect(descs.length).toBe(0);
    });
  });

  describe("aria wiring", () => {
    it("FormControl gets aria-describedby pointing at the description in the unvalidated state", () => {
      const { container } = renderWithProviders(<TestForm />);
      const control = container.querySelector(
        '[data-slot="form-control"]',
      ) as HTMLElement;
      const describedby = control.getAttribute("aria-describedby");
      expect(describedby).toBeTruthy();
      expect(describedby).toMatch(/-form-item-description$/);
      expect(control.getAttribute("aria-invalid")).toBe("false");
    });

    it("FormControl flips aria-invalid=true and chains description + message ids on validation error", async () => {
      const { container } = renderWithProviders(<TestForm />);
      // Submit empty — RHF will fire required validation asynchronously.
      fireEvent.click(screen.getByText("Submit"));
      // Wait for the error message to render.
      const messageEl = await waitFor(() => {
        const el = container.querySelector('[data-slot="form-message"]');
        if (!el) throw new Error("FormMessage not yet rendered");
        return el as HTMLElement;
      });
      expect(messageEl.textContent).toContain("Email is required");

      const control = container.querySelector(
        '[data-slot="form-control"]',
      ) as HTMLElement;
      expect(control.getAttribute("aria-invalid")).toBe("true");
      const describedBy = control.getAttribute("aria-describedby") ?? "";
      expect(describedBy).toContain("form-item-message");
    });

    it("FormLabel gets data-error=true on validation error", async () => {
      const { container } = renderWithProviders(<TestForm />);
      fireEvent.click(screen.getByText("Submit"));
      const label = await waitFor(() => {
        const el = container.querySelector(
          'label[data-slot="form-label"]',
        ) as HTMLLabelElement | null;
        if (!el || el.getAttribute("data-error") !== "true") {
          throw new Error("FormLabel data-error not yet flipped");
        }
        return el;
      });
      expect(label.className).toContain("data-[error=true]:text-destructive");
    });
  });

  describe("FormMessage rendering", () => {
    it("returns null when there is no error and no children", () => {
      const { container } = renderWithProviders(<TestForm />);
      // The name field has no description, no children, no error → no message rendered
      const allMessages = container.querySelectorAll(
        '[data-slot="form-message"]',
      );
      // Both fields have FormMessage rendered, but with no body it returns null.
      expect(allMessages.length).toBe(0);
    });

    it("renders explicit children when provided", () => {
      function CustomMessage() {
        const form = useForm<{ x: string }>({ defaultValues: { x: "" } });
        return (
          <Form {...form}>
            <FormField
              control={form.control}
              name="x"
              render={() => (
                <FormItem>
                  <FormLabel>X</FormLabel>
                  <FormControl>
                    <Input />
                  </FormControl>
                  <FormMessage>This is a custom hint.</FormMessage>
                </FormItem>
              )}
            />
          </Form>
        );
      }
      renderWithProviders(<CustomMessage />);
      expect(screen.getByText("This is a custom hint.")).toBeTruthy();
    });
  });

  describe("useFormField hook", () => {
    it("throws when used outside a FormField (the documented contract)", () => {
      // useFormField is consumed inside FormLabel/FormControl/etc. Without the
      // FormFieldContext.Provider around it, `useFormContext` returns null and
      // the hook should fail loudly. We assert by rendering a component that
      // calls it outside any Form provider.
      function Bare() {
        useFormField();
        return null;
      }
      // Suppress React's error output for this expected throw
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => renderWithProviders(<Bare />)).toThrow();
      spy.mockRestore();
    });
  });

  describe("submission flow", () => {
    it("valid submission calls onValidSubmit with form values", async () => {
      const handler = vi.fn();
      renderWithProviders(
        <TestForm
          defaultValues={{ email: "user@example.com", name: "Jane" }}
          onValidSubmit={handler}
        />,
      );
      fireEvent.click(screen.getByText("Submit"));
      await waitFor(() => {
        expect(handler).toHaveBeenCalledWith({
          email: "user@example.com",
          name: "Jane",
        });
      });
    });
  });
});

