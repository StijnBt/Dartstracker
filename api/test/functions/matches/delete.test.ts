import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { deleteMatch } from "../../../src/functions/matches/delete";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { match: { findUnique: vi.fn() }, $transaction: vi.fn() },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
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
  roundNumber: 0,
  date: new Date("2026-08-15"),
  player1Id: 1,
  player2Id: 2,
  status: "scheduled",
  createdAt: new Date(),
  player1Legs: null,
  player2Legs: null,
  player1Checkout: null,
  player2Checkout: null,
  resultEnteredById: null,
  resultEnteredAt: null,
  season: { id: 1, status: "active" },
};

function mockTransaction() {
  const tx = {
    throw: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    leg: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    match: { delete: vi.fn().mockResolvedValue({}) },
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    (async (fn: (tx: unknown) => unknown) => fn(tx)) as unknown as typeof prisma.$transaction
  );
  return tx;
}

describe("deleteMatch function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await deleteMatch(createRequest("101"), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the id is invalid", async () => {
    const result = await deleteMatch(createRequest("abc"), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the match doesn't exist", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
    const result = await deleteMatch(createRequest("999"), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 400 when the match's season is archived", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      ...scheduledMatch,
      season: { id: 1, status: "archived" },
    } as unknown as Awaited<ReturnType<typeof prisma.match.findUnique>>);
    const result = await deleteMatch(createRequest("101"), createContext());
    expect(result.status).toBe(400);
  });

  it("deletes a scheduled match with no legs", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(
      scheduledMatch as unknown as Awaited<ReturnType<typeof prisma.match.findUnique>>
    );
    const tx = mockTransaction();

    const result = await deleteMatch(createRequest("101"), createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({ success: true });
    expect(tx.throw.deleteMany).toHaveBeenCalledWith({ where: { leg: { matchId: 101 } } });
    expect(tx.leg.deleteMany).toHaveBeenCalledWith({ where: { matchId: 101 } });
    expect(tx.match.delete).toHaveBeenCalledWith({ where: { id: 101 } });
  });

  it("deletes a played match, removing its throws and legs before the match itself", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      ...scheduledMatch,
      status: "played",
      player1Legs: 3,
      player2Legs: 1,
    } as unknown as Awaited<ReturnType<typeof prisma.match.findUnique>>);
    const tx = mockTransaction();
    const callOrder: string[] = [];
    tx.throw.deleteMany.mockImplementation(async () => {
      callOrder.push("throw");
      return { count: 9 };
    });
    tx.leg.deleteMany.mockImplementation(async () => {
      callOrder.push("leg");
      return { count: 3 };
    });
    tx.match.delete.mockImplementation(async () => {
      callOrder.push("match");
      return {};
    });

    const result = await deleteMatch(createRequest("101"), createContext());

    expect(result.status).toBe(200);
    expect(callOrder).toEqual(["throw", "leg", "match"]);
  });
});
