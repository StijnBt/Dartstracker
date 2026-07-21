import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { getLiveMatch } from "../../../src/functions/matches/liveGet";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { match: { findUnique: vi.fn() }, leg: { findMany: vi.fn() } },
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

describe("getLiveMatch function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 3, role: "player" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await getLiveMatch(createRequest("101"), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 404 when the match doesn't exist", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
    const result = await getLiveMatch(createRequest("999"), createContext());
    expect(result.status).toBe(404);
  });

  it("returns the live state for any authenticated user, including a non-participant", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      id: 101,
      player1Id: 1,
      player2Id: 2,
      status: "in_progress",
    } as never);
    vi.mocked(prisma.leg.findMany).mockResolvedValue([
      { id: 10, legNumber: 1, startingPlayerId: 1, winnerPlayerId: null, checkoutValue: null, throws: [] },
    ] as never);

    const result = await getLiveMatch(createRequest("101"), createContext());

    expect(result.status).toBe(200);
    const body = result.jsonBody as { match: { status: string }; currentTurn: { playerId: number } };
    expect(body.match.status).toBe("in_progress");
    expect(body.currentTurn.playerId).toBe(1);
  });
});
