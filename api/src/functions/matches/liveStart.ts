import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { replayMatch } from "../../lib/liveScoring";
import { loadLegsWithThrows, buildLiveStateResponse } from "../../lib/liveScoringStore";

export async function startLiveMatch(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const claims = await requireAuth(request);

    const matchId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(matchId)) {
      return { status: 400, jsonBody: { error: "Invalid match id" } };
    }

    const existing = await prisma.match.findUnique({ where: { id: matchId }, include: { season: true } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Match not found" } };
    }

    if (claims.role !== "admin" && claims.userId !== existing.player1Id && claims.userId !== existing.player2Id) {
      return { status: 403, jsonBody: { error: "Insufficient permissions" } };
    }

    if (existing.season.status !== "active") {
      return { status: 400, jsonBody: { error: "Cannot modify a match in an archived season" } };
    }

    if (existing.status !== "scheduled" && existing.status !== "in_progress") {
      return { status: 400, jsonBody: { error: "Match cannot be started" } };
    }

    const result = await prisma.$transaction(async (tx) => {
      if (existing.status === "scheduled") {
        await tx.match.update({ where: { id: matchId }, data: { status: "in_progress" } });
        await tx.leg.create({ data: { matchId, legNumber: 1, startingPlayerId: existing.player1Id } });
      }
      const legs = await loadLegsWithThrows(tx, matchId);
      const outcome = replayMatch(existing.player1Id, existing.player2Id, legs);
      return { legs, outcome };
    });

    return {
      status: 200,
      jsonBody: buildLiveStateResponse(
        { id: existing.id, status: "in_progress", player1Id: existing.player1Id, player2Id: existing.player2Id },
        result.legs,
        result.outcome
      ),
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/matches/{id}/live/start failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("matchesLiveStart", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "matches/{id}/live/start",
  handler: startLiveMatch,
});
