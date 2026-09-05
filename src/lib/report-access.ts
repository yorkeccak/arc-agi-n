import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

interface ReportAccessClaims {
  expiresAt: number;
  scope: "research-report";
  taskId: string;
}

const reportSecret = () => (
  process.env.RESEARCH_TOKEN_SECRET ||
  process.env.VALYU_CLIENT_SECRET ||
  process.env.VALYU_API_KEY
);

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function issueReportAccessToken(taskId: string) {
  const secret = reportSecret();
  if (!secret) return undefined;
  const claims: ReportAccessClaims = {
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    scope: "research-report",
    taskId,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyReportAccessToken(token: string | null, taskId: string) {
  const secret = reportSecret();
  if (!secret || !token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = Buffer.from(sign(payload, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ReportAccessClaims;
    return claims.scope === "research-report" &&
      claims.expiresAt >= Date.now() &&
      claims.taskId === taskId;
  } catch {
    return false;
  }
}
