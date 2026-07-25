import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

export async function listAnnouncements(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request);

    const announcements = await prisma.announcement.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        author: true,
        comments: { include: { author: true }, orderBy: { createdAt: "asc" } },
      },
    });

    return {
      status: 200,
      jsonBody: {
        announcements: announcements.map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          author: { id: a.author.id, displayName: a.author.displayName },
          createdAt: a.createdAt,
          comments: a.comments.map((c) => ({
            id: c.id,
            body: c.body,
            author: { id: c.author.id, displayName: c.author.displayName },
            createdAt: c.createdAt,
          })),
        })),
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`GET /api/announcements failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("announcementsList", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "announcements",
  handler: listAnnouncements,
});
