import type { Config } from "tailwindcss";

const config: Config = {
  // Theme is a class on <html>, set server-side from profiles.theme_preference.
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    // lib/ too, because class names live there: STATUS_STYLE in lib/duty-status.ts
    // is the one place the roster's colours are written. Without this path the
    // scanner never sees them and Tailwind emits no rule, so the cell renders
    // with no background at all.
    //
    // It failed silently and only partly, which is why it survived: four of the
    // six colours happened to appear in some component too and were emitted for
    // that reason, while bg-violet-600 (TRAINING) and bg-orange-600 (SUSPENDED)
    // appeared nowhere else and simply vanished. A colour working by coincidence
    // is not a colour that works.
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      // So `font-sans` and `font-mono` mean the fonts this app actually loads.
      // Without these, Tailwind's own stacks win wherever a utility is used and
      // the page ends up in two typefaces depending on the element.
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Arial", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
