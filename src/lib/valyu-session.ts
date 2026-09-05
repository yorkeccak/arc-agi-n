import "server-only";

import { cookies } from "next/headers";
import { valyuAuthUrl, type AuthUser } from "@/lib/oauth";

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
});

const tokenHasExpired = (token: string) => {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { exp?: unknown };
    return typeof payload.exp === "number" && payload.exp * 1000 <= Date.now() + 30_000;
  } catch {
    return false;
  }
};

const refreshAccessToken = async () => {
  const store = await cookies();
  const refreshToken = store.get("unsolved_refresh")?.value;
  const clientId = process.env.NEXT_PUBLIC_VALYU_CLIENT_ID;
  const clientSecret = process.env.VALYU_CLIENT_SECRET;
  const authUrl = valyuAuthUrl();
  if (!refreshToken || !clientId || !clientSecret || !authUrl) return undefined;

  const response = await fetch(`${authUrl}/auth/v1/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return undefined;
  const tokens = await response.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof tokens.access_token !== "string") return undefined;

  const maxAge = Math.min(Number(tokens.expires_in) || 3600, 86400);
  store.set("unsolved_access", tokens.access_token, { ...cookieOptions(), maxAge });
  if (typeof tokens.refresh_token === "string") {
    store.set("unsolved_refresh", tokens.refresh_token, { ...cookieOptions(), maxAge: 30 * 24 * 60 * 60 });
  }
  return tokens.access_token;
};

export async function getValyuAccessToken(forceRefresh = false) {
  const store = await cookies();
  const accessToken = store.get("unsolved_access")?.value;
  if (!forceRefresh && accessToken && !tokenHasExpired(accessToken)) return accessToken;
  return refreshAccessToken();
}

export async function getValyuUser(): Promise<AuthUser | undefined> {
  let accessToken = await getValyuAccessToken();
  if (!accessToken) return undefined;

  const requestProfile = (token: string) => fetch(`${process.env.VALYU_APP_URL || "https://platform.valyu.ai"}/api/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  let response = await requestProfile(accessToken);
  if (response.status === 401) {
    accessToken = await getValyuAccessToken(true);
    if (!accessToken) return undefined;
    response = await requestProfile(accessToken);
  }
  if (!response.ok) return undefined;
  const profile = await response.json() as Record<string, unknown>;
  if (typeof profile.sub !== "string" || typeof profile.email !== "string") return undefined;
  return {
    id: profile.sub,
    email: profile.email,
    name: typeof profile.name === "string" ? profile.name : undefined,
    picture: typeof profile.picture === "string" ? profile.picture : undefined,
  };
}

export async function clearValyuSession() {
  const store = await cookies();
  for (const name of ["unsolved_access", "unsolved_refresh", "unsolved_user"]) {
    store.set(name, "", { ...cookieOptions(), maxAge: 0 });
  }
}
