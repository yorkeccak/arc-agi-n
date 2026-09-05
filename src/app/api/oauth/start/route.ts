import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { safeReturnPath, valyuAuthUrl } from "@/lib/oauth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "oauth-start", 20, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many sign-in attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const authUrl = valyuAuthUrl();
  const clientId = process.env.NEXT_PUBLIC_VALYU_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;
  if (!authUrl || !clientId || !redirectUri) {
    return NextResponse.json({ error: "OAuth is not configured." }, { status: 503 });
  }

  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const requestUrl = new URL(request.url);
  const returnTo = safeReturnPath(requestUrl.searchParams.get("returnTo"), requestUrl.origin);
  const url = new URL("/auth/v1/oauth/authorize", authUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 10 * 60,
  };
  const response = NextResponse.redirect(url);
  response.cookies.set("unsolved_oauth_verifier", verifier, cookieOptions);
  response.cookies.set("unsolved_oauth_state", state, cookieOptions);
  response.cookies.set("unsolved_oauth_created", Date.now().toString(), cookieOptions);
  response.cookies.set("unsolved_oauth_return", returnTo, cookieOptions);
  return response;
}
