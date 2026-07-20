import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { generateRoundRobin, computeRoundCount, isRoundType } from "../../lib/roundRobin";

type CreateSeasonBody = {
  name?: unknown;
  roundType?: unknown;
  participantIds?: unknown;
  roundDates?: unknown;
};

export async function createSeason(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    let body: CreateSeasonBody;
    try {
      body = (await request.json()) as CreateSeasonBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return { status: 400, jsonBody: { error: "name is required" } };
    }

    if (!isRoundType(body.roundType)) {
      return { status: 400, jsonBody: { error: "roundType must be 'single' or 'double'" } };
    }
    const roundType = body.roundType;

    const participantIdsRaw = body.participantIds;
    if (!Array.isArray(participantIdsRaw) || participantIdsRaw.length < 2) {
      return { status: 400, jsonBody: { error: "participantIds must be an array of at least 2 user ids" } };
    }
    const isNumber = (value: unknown): value is number => typeof value === "number";
    if (!participantIdsRaw.every(isNumber)) {
      return { status: 400, jsonBody: { error: "participantIds must be an array of at least 2 user ids" } };
    }
    const participantIds = participantIdsRaw;
    if (new Set(participantIds).size !== participantIds.length) {
      return { status: 400, jsonBody: { error: "participantIds must not contain duplicates" } };
    }

    const expectedRoundCount = computeRoundCount(participantIds.length, roundType);
    const roundDatesRaw = body.roundDates;
    if (!Array.isArray(roundDatesRaw) || roundDatesRaw.length !== expectedRoundCount) {
      return {
        status: 400,
        jsonBody: { error: `roundDates must contain exactly ${expectedRoundCount} valid dates` },
      };
    }
    const isValidDateString = (value: unknown): value is string =>
      typeof value === "string" && !Number.isNaN(Date.parse(value));
    if (!roundDatesRaw.every(isValidDateString)) {
      return {
        status: 400,
        jsonBody: { error: `roundDates must contain exactly ${expectedRoundCount} valid dates` },
      };
    }
    const roundDates = roundDatesRaw;

    const activeSeason = await prisma.season.findFirst({ where: { status: "active" } });
    if (activeSeason) {
      return { status: 409, jsonBody: { error: "A season is already active" } };
    }

    const participants = await prisma.user.findMany({
      where: { id: { in: participantIds }, isActive: true },
    });
    if (participants.length !== participantIds.length) {
      return { status: 400, jsonBody: { error: "participantIds must all be existing, active members" } };
    }

    const pairings = generateRoundRobin(participantIds, roundType);
    const displayNameById = new Map(participants.map((p) => [p.id, p.displayName]));

    const { season, matches } = await prisma.$transaction(async (tx) => {
      const createdSeason = await tx.season.create({ data: { name, roundType } });

      await tx.seasonParticipant.createMany({
        data: participantIds.map((userId) => ({ seasonId: createdSeason.id, userId })),
      });

      const createdMatches = [];
      for (const pairing of pairings) {
        const match = await tx.match.create({
          data: {
            seasonId: createdSeason.id,
            roundNumber: pairing.roundNumber,
            date: new Date(roundDates[pairing.roundNumber - 1]),
            player1Id: pairing.player1Id,
            player2Id: pairing.player2Id,
          },
        });
        createdMatches.push(match);
      }

      return { season: createdSeason, matches: createdMatches };
    });

    return {
      status: 201,
      jsonBody: {
        season: {
          id: season.id,
          name: season.name,
          roundType: season.roundType,
          status: season.status,
          participants: participantIds.map((id) => ({ id, displayName: displayNameById.get(id) })),
          matches: matches.map((match) => ({
            id: match.id,
            roundNumber: match.roundNumber,
            date: match.date,
            status: match.status,
            player1: { id: match.player1Id, displayName: displayNameById.get(match.player1Id) },
            player2: { id: match.player2Id, displayName: displayNameById.get(match.player2Id) },
          })),
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/seasons failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("seasonsCreate", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "seasons",
  handler: createSeason,
});
