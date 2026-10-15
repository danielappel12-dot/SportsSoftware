/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#0b0b0d", 900: "#121215", 850: "#17171b", 800: "#1c1c21", 700: "#26262d", 600: "#33333c", 500: "#4a4a55" },
        accent: { DEFAULT: "#f97316", soft: "#fb923c", dim: "#c2570c" },
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'], mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'] },
    },
  },
  plugins: [],
};
