export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  picture?: string;
}

export const valyuAuthUrl = () => (
  process.env.NEXT_PUBLIC_VALYU_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_VALYU_AUTH_URL
);

export const safeReturnPath = (requestedPath: string | null | undefined, origin: string) => {
  if (!requestedPath || requestedPath.length > 2000 || !requestedPath.startsWith("/") || /[\\\u0000-\u001f]/.test(requestedPath)) return "/";
  const resolved = new URL(requestedPath, origin);
  return resolved.origin === origin ? `${resolved.pathname}${resolved.search}${resolved.hash}` : "/";
};

export const oauthConfigured = () => Boolean(
  process.env.NEXT_PUBLIC_VALYU_CLIENT_ID &&
  valyuAuthUrl() &&
  process.env.NEXT_PUBLIC_REDIRECT_URI,
);
