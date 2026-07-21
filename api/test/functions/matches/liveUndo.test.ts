import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { undoLiveThrow } from "../../../src/functions/matches/liveUndo";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { match: { findUnique: vi.fn() }, throw: { findFirst: vi.fn() }, $transaction: vi.fn() },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createRequest(id: string): HttpRequest {
  return { params: { id } } as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

const liveMatch = {
  id: 101,
  player1Id: 1,
  player2Id: 2,
  status: "in_progress",
  season: { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: new Date() },
};

function mockTransaction() {
  const tx = {
    leg: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}) },
    throw: { delete: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
    match: { update: vi.fn().mockResolvedValue({}) },
  };
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(tx)) as unknown as typeof prisma.$transaction);
  return tx;
}

describe("undoLiveThrow function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await undoLiveThrow(createRequest("101"), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 404 when the match doesn't exist", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
    const result = await undoLiveThrow(createRequest("999"), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 403 when the caller is neither admin nor a participant", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 5, role: "player" });
    vi.mocked(prisma.match.findUnique).mockResolvedValue(liveMatch as never);
    const result = await undoLiveThrow(createRequest("101"), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the match's season is archived", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      ...liveMatch,
      season: { ...liveMatch.season, status: "archived" },
    } as never);
    const result = await undoLiveThrow(createRequest("101"), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when there is nothing to undo", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(liveMatch as never);
    vi.mocked(prisma.throw.findFirst).mockResolvedValue(null);
    const result = await undoLiveThrow(createRequest("101"), createContext());
    expect(result.status).toBe(400);
  });

  it("deletes the most recent throw and returns the reconciled state", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(liveMatch as never);
    vi.mocked(prisma.throw.findFirst).mockResolvedValue({ id: 42 } as never);
    const tx = mockTransaction();
    tx.leg.findMany.mockResolvedValue([{ id: 10, legNumber: 1, startingPlayerId: 1, winnerPlayerId: null, checkoutValue: null, throws: [] }]);

    const result = await undoLiveThrow(createRequest("101"), createContext());

    expect(prisma.throw.findFirst).toHaveBeenCalledWith({ where: { leg: { matchId: 101 } }, orderBy: { id: "desc" } });
    expect(tx.throw.delete).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(result.status).toBe(200);
  });

  it("undoes a match-completing dart, restoring in_progress status", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({ ...liveMatch, status: "played" } as never);
    vi.mocked(prisma.throw.findFirst).mockResolvedValue({ id: 209 } as never);
    const tx = mockTransaction();
    tx.leg.findMany.mockResolvedValue([{ id: 12, legNumber: 3, startingPlayerId: 1, winnerPlayerId: null, checkoutValue: null, throws: [] }]);

    const result = await undoLiveThrow(createRequest("101"), createContext());

    expect(result.status).toBe(200);
    const body = result.jsonBody as { match: { status: string } };
    expect(body.match.status).toBe("in_progress");
  });
});
