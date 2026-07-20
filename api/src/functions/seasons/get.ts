import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

export async function getSeason(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request);

    const seasonId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(seasonId)) {
      return { status: 400, jsonBody: { error: "Invalid season id" } };
    }

    const season = await prisma.season.findUnique({
      where: { id: seasonId },
      include: {
        participants: { include: { user: true } },
        matches: {
          include: { player1: true, player2: true },
          orderBy: [{ roundNumber: "asc" }, { id: "asc" }],
        },
      },
    });

    if (!season) {
      return { status: 404, jsonBody: { error: "Season not found" } };
    }

    return {
      status: 200,
      jsonBody: {
        season: {
          id: season.id,
          name: season.name,
          roundType: season.roundType,
          status: season.status,
          participants: season.participants.map((p) => ({ id: p.user.id, displayName: p.user.displayName })),
          matches: season.matches.map((m) => ({
            id: m.id,
            roundNumber: m.roundNumber,
            date: m.date,
            status: m.status,
            player1: { id: m.player1.id, displayName: m.player1.displayName },
            player2: { id: m.player2.id, displayName: m.player2.displayName },
          })),
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`GET /api/seasons/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("seasonsGet", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "seasons/{id}",
  handler: getSeason,
});
