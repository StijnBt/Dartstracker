import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

type CreateAnnouncementBody = {
  title?: unknown;
  body?: unknown;
};

export async function createAnnouncement(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const claims = await requireAuth(request, "admin");

    let body: CreateAnnouncementBody;
    try {
      body = (await request.json()) as CreateAnnouncementBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    if (typeof body.title !== "string" || !body.title.trim()) {
      return { status: 400, jsonBody: { error: "title must be a non-empty string" } };
    }
    if (typeof body.body !== "string" || !body.body.trim()) {
      return { status: 400, jsonBody: { error: "body must be a non-empty string" } };
    }

    const announcement = await prisma.announcement.create({
      data: { title: body.title.trim(), body: body.body.trim(), authorId: claims.userId },
      include: { author: true },
    });

    return {
      status: 201,
      jsonBody: {
        announcement: {
          id: announcement.id,
          title: announcement.title,
          body: announcement.body,
          author: { id: announcement.author.id, displayName: announcement.author.displayName },
          createdAt: announcement.createdAt,
          comments: [],
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/announcements failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("announcementsCreate", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "announcements",
  handler: createAnnouncement,
});
