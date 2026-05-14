import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: "#fbfaf7",
        paper:   "#ffffff",
        ink:     "#1a1a1a",
        muted:   "#696965",
        line:    "#e8e6e0",
        brand: {
          DEFAULT: "#151a22",
          soft:    "#eeece6",
          deep:    "#000000",
        },
        warn: {
          DEFAULT: "#7a5c14",
          vivid:   "#e8a200",   // kräftiges Gelb für Dots / Status-Indikatoren
          soft:    "#f5efe1",
        },
        danger: {
          DEFAULT: "#8a2a1d",
          soft:    "#f1e3e0",
        },
        ok: {
          DEFAULT: "#3d6948",
          soft:    "#e6ede7",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(16, 24, 40, 0.05)",
        pop: "0 8px 24px -8px rgba(16, 24, 40, 0.18), 0 2px 6px -2px rgba(16, 24, 40, 0.08)",
      },
      fontSize: {
        "2xs": ["11px", { lineHeight: "16px", letterSpacing: "0.01em" }],
        xs: ["12px", { lineHeight: "18px" }],
        sm: ["13px", { lineHeight: "20px" }],
        base: ["14px", { lineHeight: "22px" }],
        md: ["15px", { lineHeight: "24px" }],
        lg: ["17px", { lineHeight: "26px", letterSpacing: "-0.01em" }],
        xl: ["20px", { lineHeight: "28px", letterSpacing: "-0.015em" }],
        "2xl": ["24px", { lineHeight: "32px", letterSpacing: "-0.02em" }],
        "3xl": ["30px", { lineHeight: "38px", letterSpacing: "-0.025em" }],
      },
      fontFamily: {
        sans:    ["var(--font-geist)", "ui-sans-serif", "system-ui", "-apple-system", '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "sans-serif"],
        serif:   ['"Instrument Serif"', "ui-serif", "Georgia", '"Times New Roman"', "serif"],
        mono:    ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", '"SF Mono"', "Menlo", "Consolas", "monospace"],
        display: ["var(--font-geist)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      keyframes: {
        "ap-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(61, 105, 72, 0.45)" },
          "50%": { boxShadow: "0 0 0 6px rgba(61, 105, 72, 0)" },
        },
      },
      animation: {
        "ap-pulse": "ap-pulse 2.2s ease-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
