import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

export async function deleteAnnouncement(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    const announcementId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(announcementId)) {
      return { status: 400, jsonBody: { error: "Invalid announcement id" } };
    }

    const existing = await prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Announcement not found" } };
    }

    await prisma.$transaction(async (tx) => {
      await tx.comment.deleteMany({ where: { announcementId } });
      await tx.announcement.delete({ where: { id: announcementId } });
    });

    return { status: 200, jsonBody: { success: true } };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`DELETE /api/announcements/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("announcementsDelete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "announcements/{id}",
  handler: deleteAnnouncement,
});
