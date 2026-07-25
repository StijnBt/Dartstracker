import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

export async function deleteComment(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const claims = await requireAuth(request);

    const commentId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(commentId)) {
      return { status: 400, jsonBody: { error: "Invalid comment id" } };
    }

    const existing = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Comment not found" } };
    }

    if (claims.role !== "admin" && claims.userId !== existing.authorId) {
      return { status: 403, jsonBody: { error: "Insufficient permissions" } };
    }

    await prisma.comment.delete({ where: { id: commentId } });

    return { status: 200, jsonBody: { success: true } };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`DELETE /api/comments/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("commentsDelete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "comments/{id}",
  handler: deleteComment,
});
