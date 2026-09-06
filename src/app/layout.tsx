import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SiteAnalytics } from "@/components/site-analytics";
import "@fontsource-variable/instrument-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARC-AGI-N - Find more problems to solve",
  description: "AI solved the benchmarks. Find open problems in mathematics and science, copy a prompt, or get a DeepResearch plan.",
  metadataBase: new URL("https://arc-agi-n.com"),
  openGraph: {
    title: "ARC-AGI-N - AI solved the benchmarks. Now find more problems to solve.",
    description: "Find an open problem, read the papers, and give your agent a place to start.",
    url: "https://arc-agi-n.com",
    siteName: "ARC-AGI-N",
    images: [{ url: "/share-card.png", width: 1730, height: 909, alt: "ARC-AGI-N: Find open problems. Take a stab at them." }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ARC-AGI-N - Find more problems to solve",
    description: "AI solved the benchmarks. Now find more problems to solve.",
    images: [{ url: "/share-card.png", alt: "ARC-AGI-N: Find open problems. Take a stab at them." }],
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#07090a",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}<SiteAnalytics /></body>
    </html>
  );
}
