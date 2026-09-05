import type { Metadata } from "next";
import { ResearchHistory } from "@/components/research-history";
import { isSelfHostedMode } from "@/lib/app-mode";

export const metadata: Metadata = {
  title: "Research history | ARC-AGI-N",
  description: "Return to your research plans and follow work in progress.",
  robots: { index: false, follow: false },
};

export default function ResearchHistoryPage() {
  return <ResearchHistory selfHosted={isSelfHostedMode()} />;
}
