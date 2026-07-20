import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

export async function listSeasons(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request);

    const seasons = await prisma.season.findMany({ orderBy: { createdAt: "desc" } });

    return {
      status: 200,
      jsonBody: {
        seasons: seasons.map((season) => ({
          id: season.id,
          name: season.name,
          roundType: season.roundType,
          status: season.status,
          createdAt: season.createdAt,
        })),
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`GET /api/seasons failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("seasonsList", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "seasons",
  handler: listSeasons,
});
