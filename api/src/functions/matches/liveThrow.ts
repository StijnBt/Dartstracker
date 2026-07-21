import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { isValidThrowInput, throwValue, replayMatch, type Multiplier } from "../../lib/liveScoring";
import { loadLegsWithThrows, reconcileMatchState, buildLiveStateResponse } from "../../lib/liveScoringStore";

type RecordThrowBody = {
  multiplier?: unknown;
  segment?: unknown;
};

export async function recordLiveThrow(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const claims = await requireAuth(request);

    const matchId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(matchId)) {
      return { status: 400, jsonBody: { error: "Invalid match id" } };
    }

    let body: RecordThrowBody;
    try {
      body = (await request.json()) as RecordThrowBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    if (!isValidThrowInput(body.multiplier, body.segment)) {
      return { status: 400, jsonBody: { error: "multiplier/segment is not a valid throw" } };
    }
    const multiplier = body.multiplier as Multiplier;
    const segment = body.segment as number;

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

    if (existing.status !== "in_progress") {
      return { status: 400, jsonBody: { error: "Match is not live" } };
    }

    const result = await prisma.$transaction(async (tx) => {
      const legsBefore = await loadLegsWithThrows(tx, matchId);
      const outcomeBefore = replayMatch(existing.player1Id, existing.player2Id, legsBefore);
      if (!outcomeBefore.currentTurn) {
        return null;
      }
      const currentTurn = outcomeBefore.currentTurn;
      const currentLeg = legsBefore.find((leg) => leg.legNumber === currentTurn.legNumber)!;

      await tx.throw.create({
        data: {
          legId: currentLeg.id,
          playerId: currentTurn.playerId,
          turnNumber: currentTurn.turnNumber,
          dartNumber: currentTurn.dartNumber,
          multiplier,
          segment,
          value: throwValue(multiplier, segment),
        },
      });

      return reconcileMatchState(tx, matchId, existing.player1Id, existing.player2Id, claims.userId);
    });

    if (!result) {
      return { status: 400, jsonBody: { error: "Match is already complete" } };
    }

    return {
      status: 200,
      jsonBody: buildLiveStateResponse(
        {
          id: existing.id,
          status: result.outcome.match.complete ? "played" : "in_progress",
          player1Id: existing.player1Id,
          player2Id: existing.player2Id,
        },
        result.legs,
        result.outcome
      ),
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/matches/{id}/live/throws failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("matchesLiveThrow", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "matches/{id}/live/throws",
  handler: recordLiveThrow,
});
