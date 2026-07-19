import jwt from "jsonwebtoken";
import { isRole, type Role } from "./auth-types";

export const AUTH_COOKIE_NAME = "authToken";
export const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const TOKEN_TTL = "30d";
const TOKEN_ALGORITHM = "HS256";

export type AuthClaims = {
  userId: number;
  role: Role;
};

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return secret;
}

export function signAuthToken(claims: AuthClaims): string {
  return jwt.sign(claims, getSecret(), { expiresIn: TOKEN_TTL, algorithm: TOKEN_ALGORITHM });
}

export function verifyAuthToken(token: string): AuthClaims | null {
  try {
    const payload = jwt.verify(token, getSecret(), { algorithms: [TOKEN_ALGORITHM] });
    if (
      typeof payload === "object" &&
      payload !== null &&
      typeof (payload as Record<string, unknown>).userId === "number" &&
      isRole((payload as Record<string, unknown>).role)
    ) {
      const claims = payload as Record<string, unknown>;
      return { userId: claims.userId as number, role: claims.role as Role };
    }
    return null;
  } catch {
    return null;
  }
}
