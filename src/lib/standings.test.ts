import { describe, it, expect } from "vitest";
import { computeStandings } from "./standings";
import type { SeasonMatch, SeasonParticipantSummary } from "./api-client";

const alice: SeasonParticipantSummary = { id: 1, displayName: "Alice" };
const bob: SeasonParticipantSummary = { id: 2, displayName: "Bob" };
const carol: SeasonParticipantSummary = { id: 3, displayName: "Carol" };

function playedMatch(
  id: number,
  player1: SeasonParticipantSummary,
  player2: SeasonParticipantSummary,
  player1Legs: number,
  player2Legs: number
): SeasonMatch {
  return {
    id,
    roundNumber: 1,
    date: "2026-08-01",
    status: "played",
    player1,
    player2,
    player1Legs,
    player2Legs,
    player1Checkout: null,
    player2Checkout: null,
    resultEnteredBy: null,
    resultEnteredAt: null,
  };
}

function unplayedMatch(
  id: number,
  player1: SeasonParticipantSummary,
  player2: SeasonParticipantSummary,
  status: "scheduled" | "cancelled" | "in_progress"
): SeasonMatch {
  return {
    id,
    roundNumber: 1,
    date: "2026-08-01",
    status,
    player1,
    player2,
    player1Legs: null,
    player2Legs: null,
    player1Checkout: null,
    player2Checkout: null,
    resultEnteredBy: null,
    resultEnteredAt: null,
  };
}

describe("computeStandings", () => {
  it("sorts by total legs won descending", () => {
    const rows = computeStandings([alice, bob], [playedMatch(1, alice, bob, 3, 1)]);

    expect(rows.map((r) => r.player.displayName)).toEqual(["Alice", "Bob"]);
    expect(rows[0]).toMatchObject({ legsWon: 3, legsLost: 1, diff: 2, matchesPlayed: 1, rank: 1 });
    expect(rows[1]).toMatchObject({ legsWon: 1, legsLost: 3, diff: -2, matchesPlayed: 1, rank: 2 });
  });

  it("breaks a legs-won tie using leg differential", () => {
    const matches = [
      playedMatch(1, alice, carol, 3, 0),
      playedMatch(2, carol, alice, 3, 0),
      playedMatch(3, bob, carol, 3, 1),
    ];
    const rows = computeStandings([alice, bob, carol], matches);
    const alicesRow = rows.find((r) => r.player.id === alice.id)!;
    const bobsRow = rows.find((r) => r.player.id === bob.id)!;

    expect(alicesRow.legsWon).toBe(3);
    expect(alicesRow.diff).toBe(0);
    expect(bobsRow.legsWon).toBe(3);
    expect(bobsRow.diff).toBe(2);
    expect(bobsRow.rank).toBeLessThan(alicesRow.rank);
  });

  it("gives tied players the same rank and skips the next rank accordingly", () => {
    const matches = [playedMatch(1, alice, carol, 3, 0), playedMatch(2, bob, carol, 3, 0)];
    const rows = computeStandings([alice, bob, carol], matches);
    const byName = (name: string) => rows.find((r) => r.player.displayName === name)!;

    expect(byName("Alice").rank).toBe(1);
    expect(byName("Bob").rank).toBe(1);
    expect(byName("Carol").rank).toBe(3);
  });

  it("excludes unplayed, cancelled, and in-progress matches from the totals", () => {
    const matches = [
      playedMatch(1, alice, bob, 3, 1),
      unplayedMatch(2, alice, bob, "scheduled"),
      unplayedMatch(3, alice, bob, "cancelled"),
      unplayedMatch(4, alice, bob, "in_progress"),
    ];
    const rows = computeStandings([alice, bob], matches);
    const alicesRow = rows.find((r) => r.player.id === alice.id)!;

    expect(alicesRow.matchesPlayed).toBe(1);
    expect(alicesRow.legsWon).toBe(3);
    expect(alicesRow.legsLost).toBe(1);
  });

  it("includes a participant with zero played matches", () => {
    const rows = computeStandings([alice, bob, carol], [playedMatch(1, alice, bob, 3, 0)]);
    const carolsRow = rows.find((r) => r.player.id === carol.id)!;

    expect(carolsRow).toMatchObject({ matchesPlayed: 0, legsWon: 0, legsLost: 0, diff: 0 });
  });

  it("accumulates legs whether the player is player1 or player2 across matches", () => {
    const matches = [playedMatch(1, alice, bob, 3, 1), playedMatch(2, bob, alice, 2, 3)];
    const rows = computeStandings([alice, bob], matches);
    const alicesRow = rows.find((r) => r.player.id === alice.id)!;

    expect(alicesRow).toMatchObject({ matchesPlayed: 2, legsWon: 6, legsLost: 3, diff: 3 });
  });
});
