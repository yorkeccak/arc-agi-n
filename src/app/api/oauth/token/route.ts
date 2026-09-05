import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { safeReturnPath, valyuAuthUrl } from "@/lib/oauth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const limit = checkRateLimit(request, "oauth-token", 30, 10 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many authorization attempts. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
    }
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > 8_000) return NextResponse.json({ error: "Authorization response is too large." }, { status: 413 });
    const rawBody = await request.text();
    if (rawBody.length > 8_000) return NextResponse.json({ error: "Authorization response is too large." }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid authorization response." }, { status: 400 });
    }
    const { code, state } = body && typeof body === "object"
      ? body as Record<string, unknown>
      : {};
    const store = await cookies();
    const codeVerifier = store.get("unsolved_oauth_verifier")?.value;
    const expectedState = store.get("unsolved_oauth_state")?.value;
    const returnTo = store.get("unsolved_oauth_return")?.value || "/";
    const created = Number(store.get("unsolved_oauth_created")?.value);
    if (typeof code !== "string" || typeof state !== "string" || typeof codeVerifier !== "string" || code.length > 2048 || codeVerifier.length > 256 || state !== expectedState || !created || Date.now() - created > 10 * 60 * 1000) {
      return NextResponse.json({ error: "Invalid authorization response." }, { status: 400 });
    }

    const clientId = process.env.NEXT_PUBLIC_VALYU_CLIENT_ID;
    const clientSecret = process.env.VALYU_CLIENT_SECRET;
    const authUrl = valyuAuthUrl();
    const redirectUri = process.env.NEXT_PUBLIC_REDIRECT_URI;
    if (!clientId || !clientSecret || !authUrl || !redirectUri) {
      return NextResponse.json({ error: "OAuth is not configured." }, { status: 503 });
    }

    const tokenResponse = await fetch(`${authUrl}/auth/v1/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResponse.ok) return NextResponse.json({ error: "Authorization failed." }, { status: 401 });

    const tokens = await tokenResponse.json();
    if (typeof tokens.access_token !== "string") return NextResponse.json({ error: "Authorization failed." }, { status: 401 });

    const userResponse = await fetch(`${process.env.VALYU_APP_URL || "https://platform.valyu.ai"}/api/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!userResponse.ok) return NextResponse.json({ error: "Could not load profile." }, { status: 401 });
    const profile = await userResponse.json() as Record<string, unknown>;
    if (typeof profile.sub !== "string" || typeof profile.email !== "string") {
      return NextResponse.json({ error: "Could not load profile." }, { status: 401 });
    }
    const user = { id: profile.sub, email: profile.email, name: profile.name, picture: profile.picture };
    const response = NextResponse.json({ user, returnTo: safeReturnPath(returnTo, new URL(request.url).origin) });
    const secure = process.env.NODE_ENV === "production";
    response.cookies.set("unsolved_access", tokens.access_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: Math.min(Number(tokens.expires_in) || 3600, 86400) });
    if (typeof tokens.refresh_token === "string") {
      response.cookies.set("unsolved_refresh", tokens.refresh_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 30 * 24 * 60 * 60 });
    }
    for (const name of ["unsolved_oauth_verifier", "unsolved_oauth_state", "unsolved_oauth_created", "unsolved_oauth_return"]) {
      response.cookies.set(name, "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
    }
    return response;
  } catch {
    return NextResponse.json({ error: "Authorization failed." }, { status: 500 });
  }
}
