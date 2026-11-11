/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--race-ink) / <alpha-value>)",
        paper: "rgb(var(--race-paper) / <alpha-value>)",
        brand: {
          DEFAULT: "rgb(var(--race-orange) / <alpha-value>)",
          50: "rgb(var(--race-orange-tint) / <alpha-value>)",
          100: "rgb(var(--race-orange-tint) / <alpha-value>)",
          200: "rgb(var(--race-orange) / <alpha-value>)",
          700: "rgb(var(--race-orange-text) / <alpha-value>)",
          dark: "rgb(var(--race-orange-pressed) / <alpha-value>)",
        },
      },
      fontFamily: { display: ["Barlow Condensed", "Arial Narrow", "sans-serif"] },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
      },
    },
  },
  plugins: [],
};
