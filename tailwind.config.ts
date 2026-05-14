import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#003C71",
          deep: "#002647",
        },
        brand: {
          red: "#E1261C",
        },
      },
      fontFamily: {
        heading: ["Georgia", '"Times New Roman"', "serif"],
        body: ["Calibri", '"Segoe UI"', "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
