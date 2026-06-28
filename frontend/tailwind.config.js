/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#18181b",
          elevated: "#1f1f23",
        },
        border: {
          DEFAULT: "#27272a",
          subtle: "#1f1f23",
        },
        accent: {
          DEFAULT: "#e4e4e7",
          hover: "#fafafa",
          muted: "#a1a1aa",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        lg: "0.625rem",
        xl: "0.75rem",
      },
    },
  },
  plugins: [],
};
