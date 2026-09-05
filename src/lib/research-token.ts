import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { DiscoveredProblem } from "@/lib/types";

interface ResearchTokenClaims {
  expiresAt: number;
  title: string;
  question: string;
  firstStep: string;
  field: string;
  subfield: string;
  whyOpen: string;
  sourceUrls: string[];
  sourceEvidence: Array<{ url: string; passage: string }>;
  agentReadiness: string;
  executionResources: string;
  successCriterion: string;
}

const tokenSecret = () => (
  process.env.RESEARCH_TOKEN_SECRET ||
  process.env.VALYU_CLIENT_SECRET ||
  process.env.VALYU_API_KEY
);

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function issueResearchToken(problem: DiscoveredProblem) {
  const secret = tokenSecret();
  if (!secret) return undefined;
  const claims: ResearchTokenClaims = {
    expiresAt: Date.now() + 60 * 60 * 1000,
    title: problem.title,
    question: problem.question,
    firstStep: problem.firstStep,
    field: problem.field,
    subfield: problem.subfield,
    whyOpen: problem.whyOpen,
    sourceUrls: problem.sourceUrls,
    sourceEvidence: problem.sourceEvidence,
    agentReadiness: problem.agentReadiness,
    executionResources: problem.executionResources,
    successCriterion: problem.successCriterion,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyResearchToken(token: string | undefined) {
  const secret = tokenSecret();
  if (!secret || !token) return undefined;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return undefined;
  const expected = Buffer.from(sign(payload, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ResearchTokenClaims;
    if (!claims || claims.expiresAt < Date.now()) return undefined;
    return claims;
  } catch {
    return undefined;
  }
}
