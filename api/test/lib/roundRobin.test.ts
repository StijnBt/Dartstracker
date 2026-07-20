import { describe, it, expect } from "vitest";
import { computeRoundCount, generateRoundRobin, isRoundType } from "../../src/lib/roundRobin";

describe("isRoundType", () => {
  it("accepts 'single' and 'double'", () => {
    expect(isRoundType("single")).toBe(true);
    expect(isRoundType("double")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isRoundType("triple")).toBe(false);
    expect(isRoundType(undefined)).toBe(false);
    expect(isRoundType(1)).toBe(false);
  });
});

describe("computeRoundCount", () => {
  it("returns n-1 rounds for an even roster, single round", () => {
    expect(computeRoundCount(4, "single")).toBe(3);
  });

  it("returns n rounds for an odd roster, single round (bye padding)", () => {
    expect(computeRoundCount(5, "single")).toBe(5);
  });

  it("doubles the round count for double round type", () => {
    expect(computeRoundCount(4, "double")).toBe(6);
    expect(computeRoundCount(5, "double")).toBe(10);
  });
});

function pairKey(a: number, b: number): string {
  return [a, b].sort((x, y) => x - y).join("-");
}

describe("generateRoundRobin", () => {
  it("pairs every participant with every other exactly once, single round, even roster", () => {
    const matches = generateRoundRobin([1, 2, 3, 4], "single");
    expect(matches).toHaveLength(6);
    expect(new Set(matches.map((m) => m.roundNumber))).toEqual(new Set([1, 2, 3]));

    const seenPairs = new Set(matches.map((m) => pairKey(m.player1Id, m.player2Id)));
    expect(seenPairs.size).toBe(6);
    for (const a of [1, 2, 3, 4]) {
      for (const b of [1, 2, 3, 4]) {
        if (a < b) {
          expect(seenPairs.has(pairKey(a, b))).toBe(true);
        }
      }
    }
  });

  it("leaves exactly one player on a bye each round with an odd roster", () => {
    const matches = generateRoundRobin([1, 2, 3, 4, 5], "single");
    expect(matches).toHaveLength(10); // C(5,2)

    for (const round of [1, 2, 3, 4, 5]) {
      const roundMatches = matches.filter((m) => m.roundNumber === round);
      expect(roundMatches).toHaveLength(2);
      const playing = new Set(roundMatches.flatMap((m) => [m.player1Id, m.player2Id]));
      expect(playing.size).toBe(4);
    }
  });

  it("repeats the same pairings twice for double round type", () => {
    const single = generateRoundRobin([1, 2, 3, 4], "single");
    const double = generateRoundRobin([1, 2, 3, 4], "double");
    expect(double).toHaveLength(12);

    const firstHalf = double.filter((m) => m.roundNumber <= 3);
    const secondHalf = double.filter((m) => m.roundNumber > 3);
    expect(firstHalf.map((m) => pairKey(m.player1Id, m.player2Id)).sort()).toEqual(
      single.map((m) => pairKey(m.player1Id, m.player2Id)).sort()
    );
    expect(secondHalf.map((m) => pairKey(m.player1Id, m.player2Id)).sort()).toEqual(
      single.map((m) => pairKey(m.player1Id, m.player2Id)).sort()
    );
    expect(secondHalf.map((m) => m.roundNumber).sort((a, b) => a - b)).toEqual([4, 4, 5, 5, 6, 6]);
  });
});
