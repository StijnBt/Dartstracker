import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

export async function me(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const { userId } = await requireAuth(request);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      return { status: 401, jsonBody: { error: "Not authenticated" } };
    }
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
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`GET /api/auth/me failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("authMe", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "auth/me",
  handler: me,
});
