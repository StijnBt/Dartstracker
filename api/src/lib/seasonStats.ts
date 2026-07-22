export type ThrowRecord = {
  legId: number;
  playerId: number;
  turnNumber: number;
  value: number;
  busted: boolean;
};

export type PlayerStat = {
  playerId: number;
  threeDartAverage: number;
  oneEightyCount: number;
};

type Turn = { legId: number; playerId: number; darts: number; total: number; busted: boolean };

export function computeSeasonStats(throws: ThrowRecord[]): PlayerStat[] {
  const turns = new Map<string, Turn>();

  for (const th of throws) {
    const key = `${th.legId}:${th.playerId}:${th.turnNumber}`;
    const turn = turns.get(key);
    if (turn) {
      turn.darts += 1;
      turn.total += th.value;
    } else {
      turns.set(key, { legId: th.legId, playerId: th.playerId, darts: 1, total: th.value, busted: th.busted });
    }
  }

  // Track turns per player per leg to determine multiplier
  const turnsPerPlayerPerLeg = new Map<string, number>();
  for (const turn of turns.values()) {
    const legPlayerKey = `${turn.legId}:${turn.playerId}`;
    turnsPerPlayerPerLeg.set(legPlayerKey, (turnsPerPlayerPerLeg.get(legPlayerKey) ?? 0) + 1);
  }

  type Accumulator = { totalDarts: number; totalScore: number; oneEightyCount: number };
  const perPlayer = new Map<number, Accumulator>();

  for (const turn of turns.values()) {
    const acc = perPlayer.get(turn.playerId) ?? { totalDarts: 0, totalScore: 0, oneEightyCount: 0 };
    acc.totalDarts += turn.darts;
    if (!turn.busted) {
      acc.totalScore += turn.total;
      if (turn.total === 180) {
        acc.oneEightyCount += 1;
      }
    }
    perPlayer.set(turn.playerId, acc);
  }

  return [...perPlayer.entries()].map(([playerId, acc]) => {
    // Check if this player has multiple turns in any leg
    let hasMultipleTurnsInAnyLeg = false;
    for (const [legPlayerKey, count] of turnsPerPlayerPerLeg) {
      const [, pId] = legPlayerKey.split(':');
      if (parseInt(pId) === playerId && count > 1) {
        hasMultipleTurnsInAnyLeg = true;
        break;
      }
    }

    const multiplier = hasMultipleTurnsInAnyLeg ? 3 : 1;

    return {
      playerId,
      threeDartAverage: Math.round((acc.totalScore / acc.totalDarts) * multiplier * 100) / 100,
      oneEightyCount: acc.oneEightyCount,
    };
  });
}
