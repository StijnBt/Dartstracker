import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

type ArchiveSeasonBody = {
  status?: unknown;
};

export async function archiveSeason(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    const seasonId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(seasonId)) {
      return { status: 400, jsonBody: { error: "Invalid season id" } };
    }

    let body: ArchiveSeasonBody;
    try {
      body = (await request.json()) as ArchiveSeasonBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    if (body.status !== "archived") {
      return { status: 400, jsonBody: { error: "status must be 'archived'" } };
    }

    const existing = await prisma.season.findUnique({ where: { id: seasonId } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Season not found" } };
    }
    if (existing.status !== "active") {
      return { status: 400, jsonBody: { error: "Only an active season can be archived" } };
    }

    const season = await prisma.season.update({ where: { id: seasonId }, data: { status: "archived" } });

    return {
      status: 200,
      jsonBody: {
        season: { id: season.id, name: season.name, roundType: season.roundType, status: season.status },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`PATCH /api/seasons/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("seasonsArchive", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "seasons/{id}",
  handler: archiveSeason,
});
