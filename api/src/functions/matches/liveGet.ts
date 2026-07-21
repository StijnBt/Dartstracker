import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { replayMatch } from "../../lib/liveScoring";
import { loadLegsWithThrows, buildLiveStateResponse } from "../../lib/liveScoringStore";

export async function getLiveMatch(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await requireAuth(request);

    const matchId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(matchId)) {
      return { status: 400, jsonBody: { error: "Invalid match id" } };
    }

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) {
      return { status: 404, jsonBody: { error: "Match not found" } };
    }

    const legs = await loadLegsWithThrows(prisma, matchId);
    const outcome = replayMatch(match.player1Id, match.player2Id, legs);

    return {
      status: 200,
      jsonBody: buildLiveStateResponse(
        { id: match.id, status: match.status, player1Id: match.player1Id, player2Id: match.player2Id },
        legs,
        outcome
      ),
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`GET /api/matches/{id}/live failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("matchesLiveGet", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "matches/{id}/live",
  handler: getLiveMatch,
});
