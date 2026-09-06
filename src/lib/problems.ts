import catalogue from "@/generated/catalogue.json";
import type { Field, OpenProblem } from "@/lib/types";

export const fieldColors: Record<Field, string> = {
  Mathematics: "#e7a863",
  Physics: "#8fb8cf",
  "Computer science": "#b8aca0",
  Biology: "#b77d73",
  Chemistry: "#a997bf",
};

export const problems = catalogue.problems as OpenProblem[];
export const problemById = new Map(problems.map((problem) => [problem.id, problem]));
export const fields = Object.keys(fieldColors) as Field[];
