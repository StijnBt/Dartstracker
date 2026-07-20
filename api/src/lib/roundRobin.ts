export type RoundType = "single" | "double";

export function isRoundType(value: unknown): value is RoundType {
  return value === "single" || value === "double";
}

export function computeRoundCount(participantCount: number, roundType: RoundType): number {
  const evenCount = participantCount % 2 === 0 ? participantCount : participantCount + 1;
  const singleRoundCount = evenCount - 1;
  return roundType === "double" ? singleRoundCount * 2 : singleRoundCount;
}

export type RoundRobinMatch = {
  roundNumber: number;
  player1Id: number;
  player2Id: number;
};

/**
 * Standard circle method: fix one seat, rotate the rest each round.
 * An odd roster gets a null "bye" seat appended; any pairing involving it
 * produces no match for that round.
 */
export function generateRoundRobin(participantIds: number[], roundType: RoundType): RoundRobinMatch[] {
  const seats: Array<number | null> = [...participantIds];
  if (seats.length % 2 !== 0) {
    seats.push(null);
  }
  const n = seats.length;
  const singleRoundCount = n - 1;

  const matches: RoundRobinMatch[] = [];
  for (let round = 0; round < singleRoundCount; round++) {
    const positions = [0];
    for (let i = 1; i < n; i++) {
      positions.push(1 + ((i - 1 + round) % (n - 1)));
    }
    for (let i = 0; i < n / 2; i++) {
      const a = seats[positions[i]];
      const b = seats[positions[n - 1 - i]];
      if (a !== null && b !== null) {
        matches.push({ roundNumber: round + 1, player1Id: a, player2Id: b });
      }
    }
  }

  if (roundType === "double") {
    const secondHalf = matches.map((m) => ({ ...m, roundNumber: m.roundNumber + singleRoundCount }));
    return [...matches, ...secondHalf];
  }

  return matches;
}
