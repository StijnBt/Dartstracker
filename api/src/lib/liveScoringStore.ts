import type { PrismaClient } from "@prisma/client";
import { replayMatch, type Multiplier, type ReplayOutcome, type StoredLeg } from "./liveScoring";

export async function loadLegsWithThrows(client: PrismaClient, matchId: number): Promise<StoredLeg[]> {
  const legs = await client.leg.findMany({
    where: { matchId },
    orderBy: { legNumber: "asc" },
    include: { throws: { orderBy: [{ turnNumber: "asc" }, { dartNumber: "asc" }] } },
  });

  return legs.map((leg) => ({
    id: leg.id,
    legNumber: leg.legNumber,
    startingPlayerId: leg.startingPlayerId,
    throws: leg.throws.map((th) => ({
      id: th.id,
      turnNumber: th.turnNumber,
      dartNumber: th.dartNumber,
      playerId: th.playerId,
      multiplier: th.multiplier as Multiplier,
      segment: th.segment,
      value: th.value,
    })),
  }));
}

async function applyOutcome(tx: PrismaClient, outcome: ReplayOutcome): Promise<void> {
  for (const legResult of outcome.legResults) {
    for (const bustUpdate of legResult.bustUpdates) {
      await tx.throw.update({ where: { id: bustUpdate.throwId }, data: { busted: bustUpdate.busted } });
    }
    await tx.leg.update({
      where: { id: legResult.legId },
      data: { winnerPlayerId: legResult.winnerPlayerId, checkoutValue: legResult.checkoutValue },
    });
  }
}

export async function reconcileMatchState(
  tx: PrismaClient,
  matchId: number,
  player1Id: number,
  player2Id: number,
  actingUserId: number
): Promise<{ legs: StoredLeg[]; outcome: ReplayOutcome }> {
  let legs = await loadLegsWithThrows(tx, matchId);
  let outcome = replayMatch(player1Id, player2Id, legs);

  if (outcome.trailingEmptyLegId !== null) {
    await tx.leg.delete({ where: { id: outcome.trailingEmptyLegId } });
    legs = await loadLegsWithThrows(tx, matchId);
    outcome = replayMatch(player1Id, player2Id, legs);
  }

  if (outcome.needsNextLeg) {
    const lastLeg = legs[legs.length - 1];
    await tx.leg.create({
      data: { matchId, legNumber: lastLeg.legNumber + 1, startingPlayerId: outcome.nextLegStartingPlayerId! },
    });
    legs = await loadLegsWithThrows(tx, matchId);
    outcome = replayMatch(player1Id, player2Id, legs);
  }

  await applyOutcome(tx, outcome);

  await tx.match.update({
    where: { id: matchId },
    data: outcome.match.complete
      ? {
          status: "played",
          player1Legs: outcome.match.player1Legs,
          player2Legs: outcome.match.player2Legs,
          player1Checkout: outcome.match.player1Checkout,
          player2Checkout: outcome.match.player2Checkout,
          resultEnteredById: actingUserId,
          resultEnteredAt: new Date(),
        }
      : {
          status: "in_progress",
          player1Legs: null,
          player2Legs: null,
          player1Checkout: null,
          player2Checkout: null,
          resultEnteredById: null,
          resultEnteredAt: null,
        },
  });

  return { legs, outcome };
}

export function buildLiveStateResponse(
  match: { id: number; status: string; player1Id: number; player2Id: number },
  legs: StoredLeg[],
  outcome: ReplayOutcome
) {
  return {
    match: { id: match.id, status: match.status, player1Id: match.player1Id, player2Id: match.player2Id },
    legs: legs.map((leg) => {
      const legResult = outcome.legResults.find((r) => r.legId === leg.id);
      return {
        id: leg.id,
        legNumber: leg.legNumber,
        startingPlayerId: leg.startingPlayerId,
        winnerPlayerId: legResult?.winnerPlayerId ?? null,
        checkoutValue: legResult?.checkoutValue ?? null,
        throws: leg.throws.map((th) => ({
          id: th.id,
          turnNumber: th.turnNumber,
          dartNumber: th.dartNumber,
          playerId: th.playerId,
          multiplier: th.multiplier,
          segment: th.segment,
          value: th.value,
          busted: legResult?.bustUpdates.find((b) => b.throwId === th.id)?.busted ?? false,
        })),
      };
    }),
    currentTurn: outcome.currentTurn,
    matchOutcome: outcome.match,
  };
}
