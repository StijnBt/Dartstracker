import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

type UpdateMatchBody = {
  date?: unknown;
  status?: unknown;
};

function isMatchStatus(value: unknown): value is "scheduled" | "cancelled" {
  return value === "scheduled" || value === "cancelled";
}

export async function updateMatch(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    const matchId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(matchId)) {
      return { status: 400, jsonBody: { error: "Invalid match id" } };
    }

    let body: UpdateMatchBody;
    try {
      body = (await request.json()) as UpdateMatchBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    const existing = await prisma.match.findUnique({ where: { id: matchId }, include: { season: true } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Match not found" } };
    }
    if (existing.season.status !== "active") {
      return { status: 400, jsonBody: { error: "Cannot modify a match in an archived season" } };
    }

    const data: { date?: Date; status?: "scheduled" | "cancelled" } = {};

    if (body.date !== undefined) {
      if (typeof body.date !== "string" || Number.isNaN(Date.parse(body.date))) {
        return { status: 400, jsonBody: { error: "date must be a valid date" } };
      }
      data.date = new Date(body.date);
    }

    if (body.status !== undefined) {
      if (!isMatchStatus(body.status)) {
        return { status: 400, jsonBody: { error: "status must be 'scheduled' or 'cancelled'" } };
      }
      data.status = body.status;
    }

    if (Object.keys(data).length === 0) {
      return { status: 400, jsonBody: { error: "date or status is required" } };
    }

    const match = await prisma.match.update({ where: { id: matchId }, data });

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
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`PATCH /api/matches/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("matchesUpdate", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "matches/{id}",
  handler: updateMatch,
});
