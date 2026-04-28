import type { Config } from "tailwindcss";

// Tailwind 4 reads most config from CSS (`@theme`, `@custom-variant`) in
// `app/globals.css`. The dark-mode strategy lives there as
// `@custom-variant dark (&:where(.dark, .dark *))`. The `theme.extend` block
// below is also v3-shaped and largely ignored by v4; it's kept only because
// the plugins still load via this file. See `docs/design-system/README.md`.
export default {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("tailwind-scrollbar")({ nocompatible: true }),
  ],
} satisfies Config;
