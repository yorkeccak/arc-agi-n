import type { Metadata } from "next";
import { AtlasApp } from "@/components/atlas-app";

export const metadata: Metadata = {
  alternates: { canonical: "/launch" },
  openGraph: {
    title: "ARC-AGI-N - Find more problems to solve",
    description: "Find open problems in mathematics and science, with papers and a plan to get started.",
    url: "https://arc-agi-n.com/launch",
    siteName: "ARC-AGI-N",
    type: "website",
    images: [{
      url: "/share-card.png",
      width: 1730,
      height: 909,
      alt: "ARC-AGI-N: Find open problems. Take a stab at them.",
    }],
  },
};

export default function Launch() {
  return <AtlasApp />;
}
