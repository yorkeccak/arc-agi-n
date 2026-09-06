export const researchEfforts = [
  { value: "fast", label: "Fast", estimate: "About 5 minutes", description: "A focused starting plan" },
  { value: "standard", label: "Medium", estimate: "10–20 minutes", description: "Broader reading and cross-checking" },
  { value: "heavy", label: "High", estimate: "About 60 minutes", description: "A more detailed review of the papers" },
] as const;

export type ResearchEffort = typeof researchEfforts[number]["value"];

export function parseResearchEffort(value: unknown): ResearchEffort | undefined {
  if (value === undefined) return "fast";
  return researchEfforts.find((effort) => effort.value === value)?.value;
}
