import type { ResearchEffort } from "@/lib/research-effort";

export interface ResearchHistoryJob {
  id: string;
  title: string;
  status: string;
  effort?: ResearchEffort;
  createdAt?: string;
  completedAt?: string;
}

export interface ResearchHistoryResponse {
  jobs: ResearchHistoryJob[];
  truncated: boolean;
}
