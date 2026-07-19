import type { HttpRequest } from "@azure/functions";
import { verifyAuthToken, AUTH_COOKIE_NAME, type AuthClaims } from "./jwt";
import type { Role } from "./auth-types";

export class AuthError extends Error {
  constructor(
    public status: 401 | 403,
    message: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) {
    return {};
  }
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (name) {
      cookies[name] = decodeURIComponent(value);
    }
  }
  return cookies;
}

export async function requireAuth(request: HttpRequest, requiredRole?: Role): Promise<AuthClaims> {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const token = cookies[AUTH_COOKIE_NAME];
  if (!token) {
    throw new AuthError(401, "Not authenticated");
  }
  const claims = verifyAuthToken(token);
  if (!claims) {
    throw new AuthError(401, "Invalid or expired session");
  }
  if (requiredRole && claims.role !== requiredRole) {
    throw new AuthError(403, "Insufficient permissions");
  }
  return claims;
}
