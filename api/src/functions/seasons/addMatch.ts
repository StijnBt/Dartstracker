import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

type AddMatchBody = {
  date?: unknown;
  player1Id?: unknown;
  player2Id?: unknown;
};

export async function addMatch(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    const seasonId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(seasonId)) {
      return { status: 400, jsonBody: { error: "Invalid season id" } };
    }

    let body: AddMatchBody;
    try {
      body = (await request.json()) as AddMatchBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    if (typeof body.date !== "string" || Number.isNaN(Date.parse(body.date))) {
      return { status: 400, jsonBody: { error: "date must be a valid date" } };
    }

    if (typeof body.player1Id !== "number" || typeof body.player2Id !== "number") {
      return { status: 400, jsonBody: { error: "player1Id and player2Id are required" } };
    }
    if (body.player1Id === body.player2Id) {
      return { status: 400, jsonBody: { error: "player1Id and player2Id must be different" } };
    }
    const player1Id = body.player1Id;
    const player2Id = body.player2Id;

    const season = await prisma.season.findUnique({ where: { id: seasonId } });
    if (!season) {
      return { status: 404, jsonBody: { error: "Season not found" } };
    }
    if (season.status !== "active") {
      return { status: 400, jsonBody: { error: "Cannot modify a match in an archived season" } };
    }

    const participants = await prisma.seasonParticipant.findMany({
      where: { seasonId, userId: { in: [player1Id, player2Id] } },
      include: { user: true },
    });
    if (participants.length !== 2) {
      return {
        status: 400,
        jsonBody: { error: "player1Id and player2Id must both be participants of this season" },
      };
    }
    const displayNameById = new Map(participants.map((p) => [p.user.id, p.user.displayName]));

    const match = await prisma.match.create({
      data: { seasonId, roundNumber: 0, date: new Date(body.date), player1Id, player2Id },
    });

    return {
      status: 201,
      jsonBody: {
        match: {
          id: match.id,
          roundNumber: match.roundNumber,
          date: match.date,
          status: match.status,
          player1: { id: player1Id, displayName: displayNameById.get(player1Id)! },
          player2: { id: player2Id, displayName: displayNameById.get(player2Id)! },
          player1Legs: null,
          player2Legs: null,
          player1Checkout: null,
          player2Checkout: null,
          resultEnteredBy: null,
          resultEnteredAt: null,
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/seasons/{id}/matches failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("seasonsAddMatch", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "seasons/{id}/matches",
  handler: addMatch,
});
