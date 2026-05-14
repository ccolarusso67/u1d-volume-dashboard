/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pg and exceljs are CommonJS — Next 15 handles these as external server packages
  serverExternalPackages: ["pg", "exceljs"],
};

module.exports = nextConfig;
