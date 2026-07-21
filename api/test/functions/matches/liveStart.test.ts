import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { startLiveMatch } from "../../../src/functions/matches/liveStart";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { match: { findUnique: vi.fn() }, $transaction: vi.fn() },
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

const scheduledMatch = {
  id: 101,
  seasonId: 1,
  roundNumber: 1,
  date: new Date("2026-08-01"),
  player1Id: 1,
  player2Id: 2,
  status: "scheduled",
  season: { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: new Date() },
};

function mockTransaction() {
  const tx = { leg: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) }, match: { update: vi.fn().mockResolvedValue({}) } };
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(tx)) as unknown as typeof prisma.$transaction);
  return tx;
}

describe("startLiveMatch function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await startLiveMatch(createRequest("101"), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 404 when the match doesn't exist", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
    const result = await startLiveMatch(createRequest("999"), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 403 when the caller is neither admin nor a participant", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 5, role: "player" });
    vi.mocked(prisma.match.findUnique).mockResolvedValue(scheduledMatch as never);
    const result = await startLiveMatch(createRequest("101"), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the match's season is archived", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      ...scheduledMatch,
      season: { ...scheduledMatch.season, status: "archived" },
    } as never);
    const result = await startLiveMatch(createRequest("101"), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when the match is played or cancelled", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({ ...scheduledMatch, status: "played" } as never);
    const result = await startLiveMatch(createRequest("101"), createContext());
    expect(result.status).toBe(400);
  });

  it("creates leg 1 and sets status to in_progress for a scheduled match", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(scheduledMatch as never);
    const tx = mockTransaction();
    tx.leg.findMany.mockResolvedValue([{ id: 10, legNumber: 1, startingPlayerId: 1, winnerPlayerId: null, checkoutValue: null, throws: [] }]);

    const result = await startLiveMatch(createRequest("101"), createContext());

    expect(tx.leg.create).toHaveBeenCalledWith({ data: { matchId: 101, legNumber: 1, startingPlayerId: 1 } });
    expect(tx.match.update).toHaveBeenCalledWith({ where: { id: 101 }, data: { status: "in_progress" } });
    expect(result.status).toBe(200);
    const body = result.jsonBody as { match: { status: string } };
    expect(body.match.status).toBe("in_progress");
  });

  it("is idempotent when the match is already in_progress (does not create a second leg 1)", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({ ...scheduledMatch, status: "in_progress" } as never);
    const tx = mockTransaction();
    tx.leg.findMany.mockResolvedValue([{ id: 10, legNumber: 1, startingPlayerId: 1, winnerPlayerId: null, checkoutValue: null, throws: [] }]);

    const result = await startLiveMatch(createRequest("101"), createContext());

    expect(tx.leg.create).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
  });
});
