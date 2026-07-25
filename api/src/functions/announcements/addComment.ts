import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

const MAX_COMMENT_LENGTH = 500;

type AddCommentBody = {
  body?: unknown;
};

export async function addComment(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const claims = await requireAuth(request);

    const announcementId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(announcementId)) {
      return { status: 400, jsonBody: { error: "Invalid announcement id" } };
    }

    let body: AddCommentBody;
    try {
      body = (await request.json()) as AddCommentBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    if (typeof body.body !== "string" || !body.body.trim()) {
      return { status: 400, jsonBody: { error: "body must be a non-empty string" } };
    }
    const trimmedBody = body.body.trim();
    if (trimmedBody.length > MAX_COMMENT_LENGTH) {
      return { status: 400, jsonBody: { error: `body must be ${MAX_COMMENT_LENGTH} characters or fewer` } };
    }

    const announcement = await prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!announcement) {
      return { status: 404, jsonBody: { error: "Announcement not found" } };
    }

    const comment = await prisma.comment.create({
      data: { announcementId, authorId: claims.userId, body: trimmedBody },
      include: { author: true },
    });

    return {
      status: 201,
      jsonBody: {
        comment: {
          id: comment.id,
          body: comment.body,
          author: { id: comment.author.id, displayName: comment.author.displayName },
          createdAt: comment.createdAt,
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/announcements/{id}/comments failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("announcementsAddComment", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "announcements/{id}/comments",
  handler: addComment,
});
