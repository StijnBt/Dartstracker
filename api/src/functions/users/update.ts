import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../../lib/password";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { isRole } from "../../lib/auth-types";

type UpdateUserBody = {
  displayName?: unknown;
  role?: unknown;
  isActive?: unknown;
  password?: unknown;
};

type UpdateData = {
  displayName?: string;
  role?: "admin" | "player";
  isActive?: boolean;
  passwordHash?: string;
};

export async function updateUser(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const { userId: callerId } = await requireAuth(request, "admin");

    const targetId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(targetId)) {
      return { status: 400, jsonBody: { error: "Invalid user id" } };
    }

    let body: UpdateUserBody;
    try {
      body = (await request.json()) as UpdateUserBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    const existing = await prisma.user.findUnique({ where: { id: targetId } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "User not found" } };
    }

    const data: UpdateData = {};

    if (body.displayName !== undefined) {
      if (typeof body.displayName !== "string" || !body.displayName.trim()) {
        return { status: 400, jsonBody: { error: "displayName must be a non-empty string" } };
      }
      data.displayName = body.displayName.trim();
    }

    if (body.role !== undefined) {
      if (!isRole(body.role)) {
        return { status: 400, jsonBody: { error: "role must be 'admin' or 'player'" } };
      }
      if (targetId === callerId && body.role !== "admin") {
        return { status: 400, jsonBody: { error: "You cannot change your own role" } };
      }
      data.role = body.role;
    }

    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") {
        return { status: 400, jsonBody: { error: "isActive must be a boolean" } };
      }
      if (targetId === callerId && body.isActive === false) {
        return { status: 400, jsonBody: { error: "You cannot deactivate your own account" } };
      }
      data.isActive = body.isActive;
    }

    if (body.password !== undefined) {
      if (typeof body.password !== "string" || body.password.length < MIN_PASSWORD_LENGTH) {
        return {
          status: 400,
          jsonBody: { error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        };
      }
      data.passwordHash = await hashPassword(body.password);
    }

    const user = await prisma.user.update({ where: { id: targetId }, data });

    return {
      status: 200,
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
    context.error(`PATCH /api/users/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("usersUpdate", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "users/{id}",
  handler: updateUser,
});
