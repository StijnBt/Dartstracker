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

type Turn = { playerId: number; darts: number; total: number; busted: boolean };

export function computeSeasonStats(throws: ThrowRecord[]): PlayerStat[] {
  const turns = new Map<string, Turn>();

  for (const th of throws) {
    const key = `${th.legId}:${th.playerId}:${th.turnNumber}`;
    const turn = turns.get(key);
    if (turn) {
      turn.darts += 1;
      turn.total += th.value;
    } else {
      turns.set(key, { playerId: th.playerId, darts: 1, total: th.value, busted: th.busted });
    }
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

  return [...perPlayer.entries()].map(([playerId, acc]) => ({
    playerId,
    threeDartAverage: Math.round((acc.totalScore / acc.totalDarts) * 3 * 100) / 100,
    oneEightyCount: acc.oneEightyCount,
  }));
}
