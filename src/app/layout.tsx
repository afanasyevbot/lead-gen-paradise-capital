import type { Metadata } from "next";
import Sidebar from "./sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paradise Capital — Lead Intelligence",
  description: "M&A advisory lead discovery and enrichment tool",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 p-8 overflow-auto">{children}</main>
      </body>
    </html>
  );
}
