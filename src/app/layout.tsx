import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kairox — Autonomous AI trading on HashKey Chain",
  description:
    "Kairox is an autonomous AI DeFi trading terminal for HSKSwap on HashKey Chain, with on-chain vault guardrails, a conversational strategy copilot and a judge sandbox.",
};

export const viewport: Viewport = {
  themeColor: "#0B0E14",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // lets the mobile tab bar sit above the iPhone home indicator
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
