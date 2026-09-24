import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Circuit Studio — EDA & SPICE",
  description: "Präzise Schaltplanentwicklung, SPICE-Simulation und virtuelle Messgeräte.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="antialiased">{children}</body>
    </html>
  );
}
