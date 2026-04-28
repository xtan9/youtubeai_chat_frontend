"use client";

import { Toaster as Sonner, ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--color-surface-overlay)",
          "--normal-text": "var(--color-text-primary)",
          "--normal-border": "var(--color-border-subtle)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
