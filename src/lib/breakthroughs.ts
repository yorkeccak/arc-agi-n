import catalogue from "@/generated/catalogue.json";

export type BreakthroughKind =
  | "Benchmark"
  | "Algorithm"
  | "Construction"
  | "Counterexample"
  | "Proof"
  | "Formalization"
  | "Bound"
  | "Prediction"
  | "Experiment"
  | "Control"
  | "Portfolio";

interface BreakthroughSource {
  title: string;
  url: string;
}

export interface Breakthrough {
  id: string;
  date: string;
  displayDate: string;
  title: string;
  field: string;
  kind: BreakthroughKind;
  result: string;
  context: string;
  verificationLevel: string;
  aiRole: string;
  sourceTitle: string;
  sourceUrl: string;
  additionalSources?: BreakthroughSource[];
}

export const breakthroughs = catalogue.breakthroughs as Breakthrough[];
