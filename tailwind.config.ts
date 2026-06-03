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
          DEFAULT: "#15385D",
          deep: "#102E4D",
        },
        brand: {
          red: "#E1261C",
          orange: "#ED8B00",
          green: "#067A46",
        },
        paper: "#F6F8FB",
        line: "#E6E9EE",
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
