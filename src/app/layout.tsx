import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "U1Dynamics — Volume Dashboard",
  description: "Monthly volume operations dashboard for U1Dynamics Manufacturing LLC",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-body antialiased min-h-screen bg-gray-50 text-gray-900">
        {children}
      </body>
    </html>
  );
}
