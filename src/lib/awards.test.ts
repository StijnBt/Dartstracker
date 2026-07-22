import { describe, it, expect } from "vitest";
import { computeHighestCheckout } from "./awards";
import type { SeasonMatch, SeasonParticipantSummary } from "./api-client";

const alice: SeasonParticipantSummary = { id: 1, displayName: "Alice" };
const bob: SeasonParticipantSummary = { id: 2, displayName: "Bob" };
const carol: SeasonParticipantSummary = { id: 3, displayName: "Carol" };

function playedMatch(
  id: number,
  player1: SeasonParticipantSummary,
  player2: SeasonParticipantSummary,
  player1Checkout: number | null,
  player2Checkout: number | null
): SeasonMatch {
  return {
    id,
    roundNumber: 1,
    date: "2026-08-01",
    status: "played",
    player1,
    player2,
    player1Legs: 3,
    player2Legs: 1,
    player1Checkout,
    player2Checkout,
    resultEnteredBy: null,
    resultEnteredAt: null,
  };
}

function unplayedMatch(id: number, player1: SeasonParticipantSummary, player2: SeasonParticipantSummary): SeasonMatch {
  return {
    id,
    roundNumber: 1,
    date: "2026-08-01",
    status: "scheduled",
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

describe("computeHighestCheckout", () => {
  it("returns the single player with the highest checkout", () => {
    const matches = [playedMatch(1, alice, bob, 121, 40), playedMatch(2, bob, carol, 60, 32)];
    const award = computeHighestCheckout([alice, bob, carol], matches);

    expect(award).toEqual({ value: 121, players: [alice] });
  });

  it("credits the player whether they are player1 or player2 in the checkout-holding match", () => {
    const matches = [playedMatch(1, alice, bob, 40, 121)];
    const award = computeHighestCheckout([alice, bob], matches);

    expect(award).toEqual({ value: 121, players: [bob] });
  });

  it("shares the award on a tie", () => {
    const matches = [playedMatch(1, alice, bob, 100, 40), playedMatch(2, bob, carol, 40, 100)];
    const award = computeHighestCheckout([alice, bob, carol], matches);

    expect(award).not.toBeNull();
    expect(award!.value).toBe(100);
    expect(award!.players.map((p) => p.id).sort()).toEqual([alice.id, carol.id].sort());
  });

  it("ignores matches with no recorded checkout", () => {
    const matches = [unplayedMatch(1, alice, bob), playedMatch(2, alice, bob, null, null), playedMatch(3, alice, bob, 85, null)];
    const award = computeHighestCheckout([alice, bob], matches);

    expect(award).toEqual({ value: 85, players: [alice] });
  });

  it("returns null when no match has a recorded checkout", () => {
    const matches = [unplayedMatch(1, alice, bob), playedMatch(2, alice, bob, null, null)];
    const award = computeHighestCheckout([alice, bob], matches);

    expect(award).toBeNull();
  });

  it("returns null for an empty match list", () => {
    expect(computeHighestCheckout([alice, bob], [])).toBeNull();
  });
});
