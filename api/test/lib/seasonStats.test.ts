import { describe, it, expect } from "vitest";
import { computeSeasonStats, type ThrowRecord } from "../../src/lib/seasonStats";

const P1 = 1;
const P2 = 2;

function th(legId: number, playerId: number, turnNumber: number, value: number, busted = false): ThrowRecord {
  return { legId, playerId, turnNumber, value, busted };
}

describe("computeSeasonStats", () => {
  it("computes a 3-dart average from a single unbusted 3-dart turn", () => {
    const throws = [th(1, P1, 1, 60), th(1, P1, 1, 60), th(1, P1, 1, 60)];

    const stats = computeSeasonStats(throws);

    expect(stats).toEqual([{ playerId: P1, threeDartAverage: 60, oneEightyCount: 1 }]);
  });

  it("excludes a busted turn's score from the average but still counts its darts", () => {
    const throws = [
      th(1, P1, 1, 20),
      th(1, P1, 1, 20),
      th(1, P1, 1, 20), // unbusted turn, total 60, 3 darts
      th(1, P1, 2, 40, true),
      th(1, P1, 2, 45, true), // busted turn, 2 darts, would total 85 if counted
    ];

    const stats = computeSeasonStats(throws);

    // total score 60 (busted turn contributes 0), total darts 5 -> 60 / 5 * 3 = 36
    expect(stats).toEqual([{ playerId: P1, threeDartAverage: 36, oneEightyCount: 0 }]);
  });

  it("does not count a non-180 turn total as a 180", () => {
    const throws = [th(1, P1, 1, 60), th(1, P1, 1, 60), th(1, P1, 1, 20)]; // sums to 140

    const stats = computeSeasonStats(throws);

    expect(stats[0].oneEightyCount).toBe(0);
  });

  it("accumulates across multiple legs for the same player", () => {
    const throws = [
      th(1, P1, 1, 60),
      th(1, P1, 1, 60),
      th(1, P1, 1, 60), // leg 1, turn total 180
      th(2, P1, 1, 60),
      th(2, P1, 1, 60),
      th(2, P1, 1, 60), // leg 2, turn total 180
    ];

    const stats = computeSeasonStats(throws);

    expect(stats).toEqual([{ playerId: P1, threeDartAverage: 60, oneEightyCount: 2 }]);
  });

  it("keeps stats separate per player", () => {
    const throws = [
      th(1, P1, 1, 60),
      th(1, P1, 1, 60),
      th(1, P1, 1, 60),
      th(1, P2, 2, 20),
      th(1, P2, 2, 20),
      th(1, P2, 2, 20),
    ];

    const stats = computeSeasonStats(throws);

    expect(stats.find((s) => s.playerId === P1)).toEqual({ playerId: P1, threeDartAverage: 60, oneEightyCount: 1 });
    expect(stats.find((s) => s.playerId === P2)).toEqual({ playerId: P2, threeDartAverage: 20, oneEightyCount: 0 });
  });

  it("omits any player who has no throws at all", () => {
    const throws = [th(1, P1, 1, 60), th(1, P1, 1, 60), th(1, P1, 1, 60)];

    const stats = computeSeasonStats(throws);

    expect(stats.map((s) => s.playerId)).toEqual([P1]);
  });

  it("returns an empty array for no throws", () => {
    expect(computeSeasonStats([])).toEqual([]);
  });

  it("rounds the average to 2 decimal places", () => {
    const throws = [
      th(1, P1, 1, 20),
      th(1, P1, 1, 15),
      th(1, P1, 1, 15), // turn 1 total 50
      th(1, P1, 2, 10),
      th(1, P1, 2, 10),
      th(1, P1, 2, 5), // turn 2 total 25
      th(1, P1, 3, 10),
      th(1, P1, 3, 5),
      th(1, P1, 3, 5), // turn 3 total 20
    ];
    // total score 95, total darts 9 -> 95 / 9 * 3 = 31.6666... -> 31.67

    const stats = computeSeasonStats(throws);

    expect(stats[0].threeDartAverage).toBe(31.67);
  });
});
