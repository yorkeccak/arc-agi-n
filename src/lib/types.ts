export type Field =
  | "Mathematics"
  | "Physics"
  | "Computer science"
  | "Biology"
  | "Chemistry";

export type ProblemScale = "foothold" | "frontier" | "monument";

export interface ProblemSource {
  title: string;
  url: string;
  kind: "primary" | "survey" | "index";
  passage?: string;
  publishedAt?: string;
  sourceType?: string;
  doi?: string;
}

export interface OpenProblem {
  id: string;
  title: string;
  field: Field;
  subfield: string;
  summary: string;
  statement: string;
  whyOpen: string;
  smallestStep: string;
  agentFit: number;
  scale: ProblemScale;
  introduced: number;
  location: { name: string; longitude: number; latitude: number };
  tags: string[];
  tools: string[];
  sources: ProblemSource[];
  starterPrompt: string;
  verified: string;
  provisional?: boolean;
  researchToken?: string;
  agentReadiness?: "agent-ready" | "hybrid" | "physical-world";
  executionResources?: string;
  successCriterion?: string;
}

export interface SearchLead {
  title: string;
  url: string;
  snippet: string;
  source: string;
  relevance: number;
  authoritative?: boolean;
  publishedAt?: string;
  sourceType?: string;
  doi?: string;
}

export interface ProblemEvidence {
  url: string;
  passage: string;
}

export interface DiscoveredProblem {
  title: string;
  question: string;
  whyOpen: string;
  firstStep: string;
  field: Field;
  subfield: string;
  sourceUrls: string[];
  sourceEvidence: ProblemEvidence[];
  agentReadiness: "agent-ready" | "hybrid" | "physical-world";
  executionResources: string;
  successCriterion: string;
  evidenceStrength?: "strong" | "provisional";
  evidenceNote?: string;
  researchToken?: string;
}
