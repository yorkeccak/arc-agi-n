import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ResearchReport } from "@/components/research-report";
import { isSelfHostedMode } from "@/lib/app-mode";

interface ResearchPageProps {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ access?: string | string[] }>;
}

export async function generateMetadata({ params }: ResearchPageProps): Promise<Metadata> {
  const { taskId } = await params;
  const reportTitle = "DeepResearch report";
  const description = "A sourced research plan covering foundations, prior attempts, open questions and promising routes.";
  const canonical = `/research/${encodeURIComponent(taskId)}`;

  return {
    title: `${reportTitle} | ARC-AGI-N`,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical },
    openGraph: {
      title: reportTitle,
      description,
      url: canonical,
      siteName: "ARC-AGI-N",
      images: [{ url: "/share-card.png", width: 1730, height: 909, alt: "ARC-AGI-N: Find open problems. Take a stab at them." }],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: reportTitle,
      description,
      images: ["/share-card.png"],
    },
  };
}

export default async function ResearchPage({ params, searchParams }: ResearchPageProps) {
  const { taskId } = await params;
  const { access: rawAccess } = await searchParams;
  const access = typeof rawAccess === "string" ? rawAccess : undefined;
  if (!/^[a-zA-Z0-9_-]{6,128}$/.test(taskId)) notFound();

  return (
    <ResearchReport
      taskId={taskId}
      access={access}
      selfHosted={isSelfHostedMode()}
    />
  );
}
