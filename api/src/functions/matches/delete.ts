import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

export async function deleteMatch(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    const matchId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(matchId)) {
      return { status: 400, jsonBody: { error: "Invalid match id" } };
    }

    const existing = await prisma.match.findUnique({ where: { id: matchId }, include: { season: true } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Match not found" } };
    }
    if (existing.season.status !== "active") {
      return { status: 400, jsonBody: { error: "Cannot modify a match in an archived season" } };
    }

    await prisma.$transaction(async (tx) => {
      await tx.throw.deleteMany({ where: { leg: { matchId } } });
      await tx.leg.deleteMany({ where: { matchId } });
      await tx.match.delete({ where: { id: matchId } });
    });

    return { status: 200, jsonBody: { success: true } };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`DELETE /api/matches/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("matchesDelete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "matches/{id}",
  handler: deleteMatch,
});
