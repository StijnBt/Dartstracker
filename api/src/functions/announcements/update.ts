import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

type UpdateAnnouncementBody = {
  title?: unknown;
  body?: unknown;
};

export async function updateAnnouncement(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    const announcementId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(announcementId)) {
      return { status: 400, jsonBody: { error: "Invalid announcement id" } };
    }

    let body: UpdateAnnouncementBody;
    try {
      body = (await request.json()) as UpdateAnnouncementBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    const existing = await prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Announcement not found" } };
    }

    const data: { title?: string; body?: string } = {};

    if (body.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim()) {
        return { status: 400, jsonBody: { error: "title must be a non-empty string" } };
      }
      data.title = body.title.trim();
    }

    if (body.body !== undefined) {
      if (typeof body.body !== "string" || !body.body.trim()) {
        return { status: 400, jsonBody: { error: "body must be a non-empty string" } };
      }
      data.body = body.body.trim();
    }

    const announcement = await prisma.announcement.update({
      where: { id: announcementId },
      data,
      include: { author: true, comments: { include: { author: true }, orderBy: { createdAt: "asc" } } },
    });

    return {
      status: 200,
      jsonBody: {
        announcement: {
          id: announcement.id,
          title: announcement.title,
          body: announcement.body,
          author: { id: announcement.author.id, displayName: announcement.author.displayName },
          createdAt: announcement.createdAt,
          comments: announcement.comments.map((c) => ({
            id: c.id,
            body: c.body,
            author: { id: c.author.id, displayName: c.author.displayName },
            createdAt: c.createdAt,
          })),
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`PATCH /api/announcements/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("announcementsUpdate", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "announcements/{id}",
  handler: updateAnnouncement,
});
