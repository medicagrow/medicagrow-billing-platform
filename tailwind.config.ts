import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eefbf5",
          100: "#d6f5e6",
          200: "#b0e9d1",
          300: "#7bd7b5",
          400: "#45bd95",
          500: "#21a37c",
          600: "#138364",
          700: "#106953",
          800: "#105343",
          900: "#0f4438",
        },
        sidebar: {
          DEFAULT: "#0f172a",
          hover: "#1e293b",
          active: "#1e3a34",
          border: "#1e293b",
          muted: "#94a3b8",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
      },
    },
  },
  plugins: [],
};
export default config;
