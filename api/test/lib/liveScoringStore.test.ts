import { describe, it, expect, vi } from "vitest";
import { loadLegsWithThrows, reconcileMatchState, buildLiveStateResponse } from "../../src/lib/liveScoringStore";

const P1 = 1;
const P2 = 2;

function makeThrowRow(id: number, turnNumber: number, dartNumber: number, playerId: number, multiplier: string, segment: number, value: number) {
  return { id, turnNumber, dartNumber, playerId, multiplier, segment, value, busted: false };
}

describe("loadLegsWithThrows", () => {
  it("maps Prisma leg rows (with nested throws) to the replay's StoredLeg shape", async () => {
    const client = {
      leg: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 10,
            legNumber: 1,
            startingPlayerId: P1,
            winnerPlayerId: null,
            checkoutValue: null,
            throws: [makeThrowRow(1, 1, 1, P1, "triple", 20, 60)],
          },
        ]),
      },
    };
    const legs = await loadLegsWithThrows(client as never, 5);
    expect(client.leg.findMany).toHaveBeenCalledWith({
      where: { matchId: 5 },
      orderBy: { legNumber: "asc" },
      include: { throws: { orderBy: [{ turnNumber: "asc" }, { dartNumber: "asc" }] } },
    });
    expect(legs).toEqual([
      {
        id: 10,
        legNumber: 1,
        startingPlayerId: P1,
        throws: [{ id: 1, turnNumber: 1, dartNumber: 1, playerId: P1, multiplier: "triple", segment: 20, value: 60 }],
      },
    ]);
  });
});

function mockTx(findManyResults: unknown[][]) {
  let call = 0;
  const tx = {
    leg: {
      findMany: vi.fn().mockImplementation(async () => findManyResults[Math.min(call++, findManyResults.length - 1)]),
      delete: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    throw: {
      update: vi.fn().mockResolvedValue({}),
    },
    match: {
      update: vi.fn().mockResolvedValue({}),
    },
  };
  return tx;
}

describe("reconcileMatchState", () => {
  it("persists bust flags and leaves the match in_progress mid-leg", async () => {
    const tx = mockTx([
      [
        {
          id: 10,
          legNumber: 1,
          startingPlayerId: P1,
          throws: [makeThrowRow(1, 1, 1, P1, "single", 5, 5)],
        },
      ],
    ]);

    const result = await reconcileMatchState(tx as never, 5, P1, P2, P1);

    expect(tx.leg.delete).not.toHaveBeenCalled();
    expect(tx.leg.create).not.toHaveBeenCalled();
    expect(tx.match.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: {
        status: "in_progress",
        player1Legs: null,
        player2Legs: null,
        player1Checkout: null,
        player2Checkout: null,
        resultEnteredById: null,
        resultEnteredAt: null,
      },
    });
    expect(result.outcome.match.complete).toBe(false);
  });

  it("creates the next leg (alternated starting player) once a leg completes short of match point", async () => {
    const wonLegThrows = [
      makeThrowRow(1, 1, 1, P1, "triple", 20, 60),
      makeThrowRow(2, 1, 2, P1, "triple", 20, 60),
      makeThrowRow(3, 1, 3, P1, "triple", 20, 60),
      makeThrowRow(4, 2, 1, P1, "triple", 20, 60),
      makeThrowRow(5, 2, 2, P1, "triple", 20, 60),
      makeThrowRow(6, 2, 3, P1, "triple", 20, 60),
      makeThrowRow(7, 3, 1, P1, "double", 20, 40),
      makeThrowRow(8, 3, 2, P1, "triple", 17, 51),
      makeThrowRow(9, 3, 3, P1, "double", 25, 50),
    ];
    const wonLeg = { id: 10, legNumber: 1, startingPlayerId: P1, throws: wonLegThrows };
    const tx = mockTx([[wonLeg], [wonLeg, { id: 11, legNumber: 2, startingPlayerId: P2, throws: [] }]]);

    await reconcileMatchState(tx as never, 5, P1, P2, P1);

    expect(tx.leg.create).toHaveBeenCalledWith({ data: { matchId: 5, legNumber: 2, startingPlayerId: P2 } });
    expect(tx.leg.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { winnerPlayerId: P1, checkoutValue: 141 },
    });
  });

  it("deletes a trailing empty leg and reopens the previous leg when undo removes its only throw", async () => {
    const leg1 = { id: 10, legNumber: 1, startingPlayerId: P1, throws: [{ id: 1, turnNumber: 1, dartNumber: 1, playerId: P1, multiplier: "single", segment: 5, value: 5, busted: false }] };
    const leg2Empty = { id: 11, legNumber: 2, startingPlayerId: P2, throws: [] };
    const tx = mockTx([[leg1, leg2Empty], [leg1]]);

    await reconcileMatchState(tx as never, 5, P1, P2, P1);

    expect(tx.leg.delete).toHaveBeenCalledWith({ where: { id: 11 } });
  });

  it("finalizes the match on the third leg win, writing legs/checkouts/resultEntered fields", async () => {
    function winTurnThrows(idBase: number) {
      return [
        makeThrowRow(idBase + 1, 1, 1, P1, "triple", 20, 60),
        makeThrowRow(idBase + 2, 1, 2, P1, "triple", 20, 60),
        makeThrowRow(idBase + 3, 1, 3, P1, "triple", 20, 60),
        makeThrowRow(idBase + 4, 2, 1, P1, "triple", 20, 60),
        makeThrowRow(idBase + 5, 2, 2, P1, "triple", 20, 60),
        makeThrowRow(idBase + 6, 2, 3, P1, "triple", 20, 60),
        makeThrowRow(idBase + 7, 3, 1, P1, "double", 20, 40),
        makeThrowRow(idBase + 8, 3, 2, P1, "triple", 17, 51),
        makeThrowRow(idBase + 9, 3, 3, P1, "double", 25, 50),
      ];
    }
    const leg1 = { id: 10, legNumber: 1, startingPlayerId: P1, throws: winTurnThrows(0) };
    const leg2 = { id: 11, legNumber: 2, startingPlayerId: P2, throws: winTurnThrows(100) };
    const leg3 = { id: 12, legNumber: 3, startingPlayerId: P1, throws: winTurnThrows(200) };
    const tx = mockTx([[leg1, leg2, leg3]]);

    const result = await reconcileMatchState(tx as never, 5, P1, P2, P1);

    expect(tx.match.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: {
        status: "played",
        player1Legs: 3,
        player2Legs: 0,
        player1Checkout: 141,
        player2Checkout: null,
        resultEnteredById: P1,
        resultEnteredAt: expect.any(Date),
      },
    });
    expect(result.outcome.match.complete).toBe(true);
  });
});

describe("buildLiveStateResponse", () => {
  it("shapes the match/legs/currentTurn/matchOutcome response, pulling busted from the outcome not the leg", () => {
    const legs = [
      {
        id: 10,
        legNumber: 1,
        startingPlayerId: P1,
        throws: [{ id: 1, turnNumber: 1, dartNumber: 1, playerId: P1, multiplier: "single" as const, segment: 5, value: 5 }],
      },
    ];
    const outcome = {
      legResults: [{ legId: 10, winnerPlayerId: null, checkoutValue: null, bustUpdates: [{ throwId: 1, busted: true }] }],
      currentTurn: { legNumber: 1, turnNumber: 1, dartNumber: 2, playerId: P1, player1Remaining: 501, player2Remaining: 501 },
      needsNextLeg: false,
      nextLegStartingPlayerId: null,
      trailingEmptyLegId: null,
      match: { complete: false, winnerPlayerId: null, player1Legs: 0, player2Legs: 0, player1Checkout: null, player2Checkout: null },
    };

    const body = buildLiveStateResponse({ id: 5, status: "in_progress", player1Id: P1, player2Id: P2 }, legs, outcome);

    expect(body).toEqual({
      match: { id: 5, status: "in_progress", player1Id: P1, player2Id: P2 },
      legs: [
        {
          id: 10,
          legNumber: 1,
          startingPlayerId: P1,
          winnerPlayerId: null,
          checkoutValue: null,
          throws: [{ id: 1, turnNumber: 1, dartNumber: 1, playerId: P1, multiplier: "single", segment: 5, value: 5, busted: true }],
        },
      ],
      currentTurn: outcome.currentTurn,
      matchOutcome: outcome.match,
    });
  });
});
