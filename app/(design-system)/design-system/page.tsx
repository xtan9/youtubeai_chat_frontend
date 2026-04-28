// app/(design-system)/design-system/page.tsx
import * as React from "react";
import Link from "next/link";
import { ShowcaseLayout } from "../_components/ShowcaseLayout";

export default function DesignSystemHome() {
  const sections = [
    {
      href: "/design-system/tokens",
      label: "Tokens",
      desc: "Colors, typography, motion, gradients, spacing, radius, shadow, blur — every design token rendered.",
    },
    {
      href: "/design-system/forms",
      label: "Forms",
      desc: "Buttons, inputs, selects, checkboxes, radios, switches, sliders, OTP, textareas, labels, forms.",
    },
    {
      href: "/design-system/containers",
      label: "Containers",
      desc: "Cards, alerts, dialogs, sheets, drawers, popovers, tooltips, hover-cards, scroll areas, separators, aspect ratios, resizable.",
    },
    {
      href: "/design-system/navigation",
      label: "Navigation",
      desc: "Tabs, breadcrumb, pagination, navigation menu, menubar, dropdown menu, context menu, command, sidebar.",
    },
    {
      href: "/design-system/data-display",
      label: "Data display",
      desc: "Avatar, badge, table, progress, skeleton, calendar, charts, accordion, collapsible, toggle, toggle group.",
    },
    {
      href: "/design-system/composites",
      label: "Composites",
      desc: "Carousel, sonner toaster.",
    },
  ];

  return (
    <ShowcaseLayout title="Design System">
      <p className="text-body-lg text-text-secondary">
        Visual reference for every component and token in the design system.
        Each cluster page renders components with their variants in light + dark
        modes (toggle via the system theme switcher).
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="block rounded-lg border border-border-subtle bg-surface-raised p-6 hover:bg-state-hover transition-colors"
          >
            <h2 className="text-h4 mb-2">{s.label}</h2>
            <p className="text-body-md text-text-muted">{s.desc}</p>
          </Link>
        ))}
      </div>
    </ShowcaseLayout>
  );
}
