import type { ResearchHistoryJob } from "@/lib/research-history";

export interface LocalResearchJob extends ResearchHistoryJob {
  reportPath: string;
}

const prefix = "arc-agi-n:report:";
const validId = /^[a-zA-Z0-9_-]{6,128}$/;

export function readLocalResearchHistory(storage: Storage): LocalResearchJob[] {
  const jobs: LocalResearchJob[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    if (!validId.test(id)) continue;
    try {
      const value = JSON.parse(storage.getItem(key) || "null");
      if (!value || typeof value.title !== "string" || typeof value.reportPath !== "string") continue;
      const url = new URL(value.reportPath, "https://local.invalid");
      if (url.origin !== "https://local.invalid" || url.pathname !== `/research/${id}` || !url.searchParams.get("access")) continue;
      jobs.push({
        id,
        title: value.title.slice(0, 240),
        status: typeof value.status === "string" ? value.status : "unknown",
        createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
        completedAt: typeof value.completedAt === "string" ? value.completedAt : undefined,
        reportPath: `${url.pathname}?access=${encodeURIComponent(url.searchParams.get("access")!)}`,
      });
    } catch {
      // A malformed entry must not hide other reports.
    }
  }
  return jobs.sort((a, b) => (Date.parse(b.createdAt || "") || 0) - (Date.parse(a.createdAt || "") || 0));
}

export function rememberLocalResearch(job: LocalResearchJob) {
  if (!validId.test(job.id)) return;
  try {
    const key = `${prefix}${job.id}`;
    const previous = JSON.parse(window.localStorage.getItem(key) || "{}");
    window.localStorage.setItem(key, JSON.stringify({ ...previous, ...job, createdAt: job.createdAt ?? previous?.createdAt }));
  } catch {
    // Private browsing may disable storage; the report URL still works.
  }
}
