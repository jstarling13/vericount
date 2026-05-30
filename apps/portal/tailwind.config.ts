import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#e8f0f8",
          100: "#c3d5ed",
          500: "#2563eb",
          700: "#1d4ed8",
          900: "#0f4c81",
        },
      },
    },
  },
  plugins: [],
};

export default config;
