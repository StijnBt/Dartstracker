import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { reconcileMatchState, buildLiveStateResponse } from "../../lib/liveScoringStore";

export async function undoLiveThrow(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
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

    const result = await prisma.$transaction(async (tx) => {
      const lastThrow = await tx.throw.findFirst({ where: { leg: { matchId } }, orderBy: { id: "desc" } });
      if (!lastThrow) {
        return null;
      }
      await tx.throw.delete({ where: { id: lastThrow.id } });
      return reconcileMatchState(tx, matchId, existing.player1Id, existing.player2Id, claims.userId);
    });

    if (!result) {
      return { status: 400, jsonBody: { error: "Nothing to undo" } };
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
    context.error(`POST /api/matches/{id}/live/throws/undo failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("matchesLiveUndo", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "matches/{id}/live/throws/undo",
  handler: undoLiveThrow,
});
