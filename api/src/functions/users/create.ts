import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../../lib/password";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { isRole } from "../../lib/auth-types";

type CreateUserBody = {
  username?: unknown;
  displayName?: unknown;
  role?: unknown;
  password?: unknown;
};

export async function createUser(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    let body: CreateUserBody;
    try {
      body = (await request.json()) as CreateUserBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    const username = typeof body.username === "string" ? body.username.trim() : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const { role, password } = body;

    if (!username || !displayName) {
      return { status: 400, jsonBody: { error: "username and displayName are required" } };
    }
    if (!isRole(role)) {
      return { status: 400, jsonBody: { error: "role must be 'admin' or 'player'" } };
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return {
        status: 400,
        jsonBody: { error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      };
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return { status: 409, jsonBody: { error: "Username already exists" } };
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { username, displayName, role, passwordHash, isActive: true },
    });

    return {
      status: 201,
      jsonBody: {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          isActive: user.isActive,
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/users failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("usersCreate", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "users",
  handler: createUser,
});
