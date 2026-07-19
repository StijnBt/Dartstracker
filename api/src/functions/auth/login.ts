import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { verifyPassword } from "../../lib/password";
import { signAuthToken, AUTH_COOKIE_NAME, TOKEN_MAX_AGE_SECONDS } from "../../lib/jwt";
import { isRole } from "../../lib/auth-types";

type LoginBody = {
  username?: unknown;
  password?: unknown;
};

// A precomputed argon2 hash with no corresponding real password. Verifying
// against it on the "user not found" path costs the same as a real
// password check, so response timing doesn't reveal whether a username exists.
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$kLtb6NK7Klv3WlfCOvPoJg$enctMBd8w9sMfzL1ZhMGntGp6y7Qp3Dml5c7QlJ++iw";

export async function login(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return { status: 400, jsonBody: { error: "Invalid request body" } };
  }

  const { username, password } = body;
  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return { status: 400, jsonBody: { error: "username and password are required" } };
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.isActive || !isRole(user.role)) {
    await verifyPassword(DUMMY_PASSWORD_HASH, password);
    return { status: 401, jsonBody: { error: "Invalid username or password" } };
  }

  const passwordValid = await verifyPassword(user.passwordHash, password);
  if (!passwordValid) {
    return { status: 401, jsonBody: { error: "Invalid username or password" } };
  }

  const token = signAuthToken({ userId: user.id, role: user.role });
  const secure = request.url.startsWith("https://");

  return {
    status: 200,
    jsonBody: {
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.displayName,
      },
    },
    cookies: [
      {
        name: AUTH_COOKIE_NAME,
        value: token,
        httpOnly: true,
        secure,
        sameSite: "Lax",
        path: "/",
        maxAge: TOKEN_MAX_AGE_SECONDS,
      },
    ],
  };
}

app.http("authLogin", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth/login",
  handler: login,
});
