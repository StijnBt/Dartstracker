import { describe, it, expect } from "vitest";
import { isValidThrowInput, throwValue, replayMatch, type StoredLeg, type StoredThrow } from "../../src/lib/liveScoring";

const P1 = 1;
const P2 = 2;

function leg(legNumber: number, startingPlayerId: number, throws: StoredThrow[]): StoredLeg {
  return { id: legNumber, legNumber, startingPlayerId, throws };
}

function t(
  id: number,
  turnNumber: number,
  dartNumber: number,
  playerId: number,
  multiplier: "single" | "double" | "triple",
  segment: number
): StoredThrow {
  return { id, turnNumber, dartNumber, playerId, multiplier, segment, value: throwValue(multiplier, segment) };
}

// Two full 3-dart turns of triple-20 (60 each) bring a fresh 501 leg down to 141
// before start of turn 3 — reused by several tests below as a shared setup.
function setupTurns(playerId: number): StoredThrow[] {
  return [
    t(1, 1, 1, playerId, "triple", 20),
    t(2, 1, 2, playerId, "triple", 20),
    t(3, 1, 3, playerId, "triple", 20),
    t(4, 2, 1, playerId, "triple", 20),
    t(5, 2, 2, playerId, "triple", 20),
    t(6, 2, 3, playerId, "triple", 20),
  ];
}

function wonByP1Leg(legNumber: number, idBase: number): StoredLeg {
  return leg(legNumber, legNumber % 2 === 1 ? P1 : P2, [
    t(idBase + 1, 1, 1, P1, "triple", 20),
    t(idBase + 2, 1, 2, P1, "triple", 20),
    t(idBase + 3, 1, 3, P1, "triple", 20),
    t(idBase + 4, 2, 1, P1, "triple", 20),
    t(idBase + 5, 2, 2, P1, "triple", 20),
    t(idBase + 6, 2, 3, P1, "triple", 20),
    t(idBase + 7, 3, 1, P1, "double", 20),
    t(idBase + 8, 3, 2, P1, "triple", 17),
    t(idBase + 9, 3, 3, P1, "double", 25),
  ]);
}

describe("isValidThrowInput", () => {
  it("accepts a valid single/double/triple on 1-20", () => {
    expect(isValidThrowInput("single", 20)).toBe(true);
    expect(isValidThrowInput("double", 20)).toBe(true);
    expect(isValidThrowInput("triple", 20)).toBe(true);
  });

  it("accepts single and double bull but rejects triple bull", () => {
    expect(isValidThrowInput("single", 25)).toBe(true);
    expect(isValidThrowInput("double", 25)).toBe(true);
    expect(isValidThrowInput("triple", 25)).toBe(false);
  });

  it("rejects an out-of-range or non-integer segment", () => {
    expect(isValidThrowInput("single", 21)).toBe(false);
    expect(isValidThrowInput("single", 0)).toBe(false);
    expect(isValidThrowInput("single", 1.5)).toBe(false);
  });

  it("rejects an invalid multiplier", () => {
    expect(isValidThrowInput("quad", 20)).toBe(false);
    expect(isValidThrowInput(undefined, 20)).toBe(false);
  });
});

describe("throwValue", () => {
  it("computes single/double/triple values for a number segment", () => {
    expect(throwValue("single", 20)).toBe(20);
    expect(throwValue("double", 20)).toBe(40);
    expect(throwValue("triple", 20)).toBe(60);
  });

  it("computes single and double bull values", () => {
    expect(throwValue("single", 25)).toBe(25);
    expect(throwValue("double", 25)).toBe(50);
  });
});

describe("replayMatch", () => {
  it("tracks remaining score after a normal (non-bust, non-checkout) throw", () => {
    const legs = [leg(1, P1, [t(1, 1, 1, P1, "triple", 20)])];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.currentTurn).toEqual({
      legNumber: 1,
      turnNumber: 1,
      dartNumber: 2,
      playerId: P1,
      player1Remaining: 441,
      player2Remaining: 501,
    });
  });

  it("reflects a shortened, still-open turn after a dart is removed mid-turn", () => {
    const legs = [leg(1, P1, [t(1, 1, 1, P1, "triple", 20), t(2, 1, 2, P1, "triple", 20)])];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.currentTurn).toEqual({
      legNumber: 1,
      turnNumber: 1,
      dartNumber: 3,
      playerId: P1,
      player1Remaining: 381,
      player2Remaining: 501,
    });
  });

  it("busts a turn that would take the score below 0, reverting to the pre-turn score", () => {
    const legs = [
      leg(1, P1, [
        ...setupTurns(P1),
        t(7, 3, 1, P1, "triple", 20),
        t(8, 3, 2, P1, "triple", 20),
        t(9, 3, 3, P1, "triple", 20),
      ]),
    ];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.legResults[0].bustUpdates.filter((b) => b.busted).map((b) => b.throwId)).toEqual([7, 8, 9]);
    expect(outcome.currentTurn?.player1Remaining).toBe(141);
    expect(outcome.currentTurn?.turnNumber).toBe(4);
    expect(outcome.currentTurn?.playerId).toBe(P2);
  });

  it("busts a turn that lands on exactly 1", () => {
    const legs = [
      leg(1, P1, [
        ...setupTurns(P1),
        t(7, 3, 1, P1, "triple", 20),
        t(8, 3, 2, P1, "triple", 20),
        t(9, 3, 3, P1, "single", 20),
      ]),
    ];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.legResults[0].bustUpdates.filter((b) => b.busted).map((b) => b.throwId)).toEqual([7, 8, 9]);
    expect(outcome.currentTurn?.player1Remaining).toBe(141);
  });

  it("busts a turn that reaches exactly 0 without the final dart being a double", () => {
    const legs = [
      leg(1, P1, [
        ...setupTurns(P1),
        t(7, 3, 1, P1, "triple", 20),
        t(8, 3, 2, P1, "triple", 20),
        t(9, 3, 3, P1, "triple", 7),
      ]),
    ];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.legResults[0].winnerPlayerId).toBeNull();
    expect(outcome.legResults[0].bustUpdates.filter((b) => b.busted).map((b) => b.throwId)).toEqual([7, 8, 9]);
  });

  it("wins the leg on a checkout via a regular double", () => {
    const legs = [
      leg(1, P1, [
        ...setupTurns(P1),
        t(7, 3, 1, P1, "triple", 20),
        t(8, 3, 2, P1, "single", 1),
        t(9, 3, 3, P1, "double", 40),
      ]),
    ];
    const outcome = replayMatch(P1, P2, legs);
    const legResult = outcome.legResults[0];
    expect(legResult.winnerPlayerId).toBe(P1);
    expect(legResult.checkoutValue).toBe(141);
    expect(legResult.bustUpdates.every((b) => !b.busted)).toBe(true);
  });

  it("wins the leg on a checkout via double bull", () => {
    const legs = [
      leg(1, P1, [
        ...setupTurns(P1),
        t(7, 3, 1, P1, "double", 20),
        t(8, 3, 2, P1, "triple", 17),
        t(9, 3, 3, P1, "double", 25),
      ]),
    ];
    const outcome = replayMatch(P1, P2, legs);
    const legResult = outcome.legResults[0];
    expect(legResult.winnerPlayerId).toBe(P1);
    expect(legResult.checkoutValue).toBe(141);
  });

  it("starts a fresh (unplayed) leg's first turn with its designated starting player", () => {
    const legs = [leg(2, P2, [])];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.currentTurn).toEqual({
      legNumber: 2,
      turnNumber: 1,
      dartNumber: 1,
      playerId: P2,
      player1Remaining: 501,
      player2Remaining: 501,
    });
  });

  it("does not flag leg 1 for deletion even though it starts empty", () => {
    const legs = [leg(1, P1, [])];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.trailingEmptyLegId).toBeNull();
  });

  it("flags a trailing empty leg (auto-created after a win) for deletion", () => {
    const legs = [wonByP1Leg(1, 0), leg(2, P2, [])];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.trailingEmptyLegId).toBe(legs[1].id);
  });

  it("signals needsNextLeg with the correct alternated starting player when a leg completes short of match point", () => {
    const legs = [wonByP1Leg(1, 0)];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.match.complete).toBe(false);
    expect(outcome.needsNextLeg).toBe(true);
    expect(outcome.nextLegStartingPlayerId).toBe(P2);
  });

  it("completes the match once a player reaches 3 legs, and stops signalling needsNextLeg", () => {
    const legs = [wonByP1Leg(1, 0), wonByP1Leg(2, 100), wonByP1Leg(3, 200)];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.match).toEqual({
      complete: true,
      winnerPlayerId: P1,
      player1Legs: 3,
      player2Legs: 0,
      player1Checkout: 141,
      player2Checkout: null,
    });
    expect(outcome.currentTurn).toBeNull();
    expect(outcome.needsNextLeg).toBe(false);
    expect(outcome.trailingEmptyLegId).toBeNull();
  });

  it("un-finalizes the match when the winning leg's checkout dart is removed", () => {
    const winner = wonByP1Leg(3, 200);
    const winningLegWithoutFinalDart: StoredLeg = { ...winner, throws: winner.throws.slice(0, -1) };
    const legs = [wonByP1Leg(1, 0), wonByP1Leg(2, 100), winningLegWithoutFinalDart];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.match.complete).toBe(false);
    expect(outcome.legResults[2].winnerPlayerId).toBeNull();
  });
});
