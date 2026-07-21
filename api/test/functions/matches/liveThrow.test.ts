import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { recordLiveThrow } from "../../../src/functions/matches/liveThrow";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { match: { findUnique: vi.fn() }, $transaction: vi.fn() },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createRequest(id: string, body: unknown): HttpRequest {
  return { params: { id }, json: async () => body } as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

const inProgressMatch = {
  id: 101,
  player1Id: 1,
  player2Id: 2,
  status: "in_progress",
  season: { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: new Date() },
};

const validBody = { multiplier: "triple", segment: 20 };

function mockTransaction(legsBeforeInsert: unknown[]) {
  const tx = {
    leg: { findMany: vi.fn(), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}) },
    throw: { create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
    match: { update: vi.fn().mockResolvedValue({}) },
  };
  tx.leg.findMany.mockResolvedValueOnce(legsBeforeInsert);
  tx.leg.findMany.mockResolvedValue(legsBeforeInsert);
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(tx)) as unknown as typeof prisma.$transaction);
  return tx;
}

describe("recordLiveThrow function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await recordLiveThrow(createRequest("101", validBody), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 400 for an invalid multiplier/segment combination", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(inProgressMatch as never);
    const result = await recordLiveThrow(createRequest("101", { multiplier: "triple", segment: 25 }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the match doesn't exist", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
    const result = await recordLiveThrow(createRequest("999", validBody), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 403 when the caller is neither admin nor a participant", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 5, role: "player" });
    vi.mocked(prisma.match.findUnique).mockResolvedValue(inProgressMatch as never);
    const result = await recordLiveThrow(createRequest("101", validBody), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the match's season is archived", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      ...inProgressMatch,
      season: { ...inProgressMatch.season, status: "archived" },
    } as never);
    const result = await recordLiveThrow(createRequest("101", validBody), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when the match is not live", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({ ...inProgressMatch, status: "scheduled" } as never);
    const result = await recordLiveThrow(createRequest("101", validBody), createContext());
    expect(result.status).toBe(400);
  });

  it("inserts the throw at the correct leg/turn/dart/player position and returns the updated state", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(inProgressMatch as never);
    const tx = mockTransaction([{ id: 10, legNumber: 1, startingPlayerId: 1, winnerPlayerId: null, checkoutValue: null, throws: [] }]);

    const result = await recordLiveThrow(createRequest("101", validBody), createContext());

    expect(tx.throw.create).toHaveBeenCalledWith({
      data: { legId: 10, playerId: 1, turnNumber: 1, dartNumber: 1, multiplier: "triple", segment: 20, value: 60 },
    });
    expect(result.status).toBe(200);
  });

  it("returns 400 when the match is already complete (no current turn)", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(inProgressMatch as never);
    const wonLegThrows = (idBase: number) => [
      { id: idBase + 1, turnNumber: 1, dartNumber: 1, playerId: 1, multiplier: "triple", segment: 20, value: 60, busted: false },
      { id: idBase + 2, turnNumber: 1, dartNumber: 2, playerId: 1, multiplier: "triple", segment: 20, value: 60, busted: false },
      { id: idBase + 3, turnNumber: 1, dartNumber: 3, playerId: 1, multiplier: "triple", segment: 20, value: 60, busted: false },
      { id: idBase + 4, turnNumber: 2, dartNumber: 1, playerId: 1, multiplier: "triple", segment: 20, value: 60, busted: false },
      { id: idBase + 5, turnNumber: 2, dartNumber: 2, playerId: 1, multiplier: "triple", segment: 20, value: 60, busted: false },
      { id: idBase + 6, turnNumber: 2, dartNumber: 3, playerId: 1, multiplier: "triple", segment: 20, value: 60, busted: false },
      { id: idBase + 7, turnNumber: 3, dartNumber: 1, playerId: 1, multiplier: "double", segment: 20, value: 40, busted: false },
      { id: idBase + 8, turnNumber: 3, dartNumber: 2, playerId: 1, multiplier: "triple", segment: 17, value: 51, busted: false },
      { id: idBase + 9, turnNumber: 3, dartNumber: 3, playerId: 1, multiplier: "double", segment: 25, value: 50, busted: false },
    ];
    const legs = [
      { id: 10, legNumber: 1, startingPlayerId: 1, winnerPlayerId: 1, checkoutValue: 141, throws: wonLegThrows(0) },
      { id: 11, legNumber: 2, startingPlayerId: 2, winnerPlayerId: 1, checkoutValue: 141, throws: wonLegThrows(100) },
      { id: 12, legNumber: 3, startingPlayerId: 1, winnerPlayerId: 1, checkoutValue: 141, throws: wonLegThrows(200) },
    ];
    mockTransaction(legs);

    const result = await recordLiveThrow(createRequest("101", validBody), createContext());
    expect(result.status).toBe(400);
  });
});
