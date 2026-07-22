import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { computeSeasonStats } from "../../lib/seasonStats";

export async function getSeasonStats(
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
      include: { participants: { include: { user: true } } },
    });

    if (!season) {
      return { status: 404, jsonBody: { error: "Season not found" } };
    }

    const throws = await prisma.throw.findMany({
      where: { leg: { match: { seasonId, status: "played" } } },
      select: { legId: true, playerId: true, turnNumber: true, value: true, busted: true },
    });

    const displayNameById = new Map(season.participants.map((p) => [p.user.id, p.user.displayName]));

    const stats = computeSeasonStats(throws)
      .map((stat) => ({
        playerId: stat.playerId,
        displayName: displayNameById.get(stat.playerId)!,
        threeDartAverage: stat.threeDartAverage,
        oneEightyCount: stat.oneEightyCount,
      }))
      .sort((a, b) => b.threeDartAverage - a.threeDartAverage);

    return { status: 200, jsonBody: { stats } };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`GET /api/seasons/{id}/stats failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("seasonsStats", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "seasons/{id}/stats",
  handler: getSeasonStats,
});
