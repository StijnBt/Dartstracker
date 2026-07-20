import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

type SubmitResultBody = {
  player1Legs?: unknown;
  player2Legs?: unknown;
  player1Checkout?: unknown;
  player2Checkout?: unknown;
};

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isValidBestOfFive(player1Legs: number, player2Legs: number): boolean {
  return (
    (player1Legs === 3 && player2Legs >= 0 && player2Legs <= 2) ||
    (player2Legs === 3 && player1Legs >= 0 && player1Legs <= 2)
  );
}

export async function submitMatchResult(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const claims = await requireAuth(request);

    const matchId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(matchId)) {
      return { status: 400, jsonBody: { error: "Invalid match id" } };
    }

    let body: SubmitResultBody;
    try {
      body = (await request.json()) as SubmitResultBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
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
    if (existing.status === "cancelled") {
      return { status: 400, jsonBody: { error: "Cannot record a result for a cancelled match" } };
    }

    if (!isNonNegativeInt(body.player1Legs)) {
      return { status: 400, jsonBody: { error: "player1Legs and player2Legs are required" } };
    }
    if (!isNonNegativeInt(body.player2Legs)) {
      return { status: 400, jsonBody: { error: "player1Legs and player2Legs are required" } };
    }
    if (!isValidBestOfFive(body.player1Legs, body.player2Legs)) {
      return {
        status: 400,
        jsonBody: { error: "One player must win exactly 3 legs; the other must have 0-2 legs" },
      };
    }

    let player1Checkout: number | null = null;
    if (body.player1Checkout !== undefined) {
      if (!isNonNegativeInt(body.player1Checkout)) {
        return { status: 400, jsonBody: { error: "player1Checkout must be a positive integer" } };
      }
      if (body.player1Checkout < 1) {
        return { status: 400, jsonBody: { error: "player1Checkout must be a positive integer" } };
      }
      player1Checkout = body.player1Checkout;
    }

    let player2Checkout: number | null = null;
    if (body.player2Checkout !== undefined) {
      if (!isNonNegativeInt(body.player2Checkout)) {
        return { status: 400, jsonBody: { error: "player2Checkout must be a positive integer" } };
      }
      if (body.player2Checkout < 1) {
        return { status: 400, jsonBody: { error: "player2Checkout must be a positive integer" } };
      }
      player2Checkout = body.player2Checkout;
    }

    const match = await prisma.match.update({
      where: { id: matchId },
      data: {
        player1Legs: body.player1Legs,
        player2Legs: body.player2Legs,
        player1Checkout,
        player2Checkout,
        status: "played",
        resultEnteredById: claims.userId,
        resultEnteredAt: new Date(),
      },
      include: { resultEnteredBy: true },
    });

    return {
      status: 200,
      jsonBody: {
        match: {
          id: match.id,
          roundNumber: match.roundNumber,
          date: match.date,
          status: match.status,
          player1Id: match.player1Id,
          player2Id: match.player2Id,
          player1Legs: match.player1Legs,
          player2Legs: match.player2Legs,
          player1Checkout: match.player1Checkout,
          player2Checkout: match.player2Checkout,
          resultEnteredBy: match.resultEnteredBy
            ? { id: match.resultEnteredBy.id, displayName: match.resultEnteredBy.displayName }
            : null,
          resultEnteredAt: match.resultEnteredAt,
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`PATCH /api/matches/{id}/result failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("matchesSubmitResult", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "matches/{id}/result",
  handler: submitMatchResult,
});
