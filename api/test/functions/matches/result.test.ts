import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { submitMatchResult } from "../../../src/functions/matches/result";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { match: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createRequest(id: string, body: unknown): HttpRequest {
  return { params: { id }, json: async () => body } as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

const activeSeasonMatch = {
  id: 101,
  seasonId: 1,
  roundNumber: 1,
  date: new Date("2026-08-01"),
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
  season: { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: new Date() },
};

const validBody = { player1Legs: 3, player2Legs: 1 };

describe("submitMatchResult function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await submitMatchResult(createRequest("101", validBody), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 400 when the id is invalid", async () => {
    const result = await submitMatchResult(createRequest("abc", validBody), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the match doesn't exist", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
    const result = await submitMatchResult(createRequest("999", validBody), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 403 when the caller is neither admin nor a participant", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 5, role: "player" });
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    const result = await submitMatchResult(createRequest("101", validBody), createContext());
    expect(result.status).toBe(403);
    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it("allows player1 (a non-admin participant) to submit", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "player" });
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    vi.mocked(prisma.match.update).mockResolvedValue({
      ...activeSeasonMatch,
      ...validBody,
      status: "played",
      resultEnteredBy: null,
    } as Awaited<ReturnType<typeof prisma.match.update>>);
    const result = await submitMatchResult(createRequest("101", validBody), createContext());
    expect(result.status).toBe(200);
  });

  it("allows player2 (a non-admin participant) to submit", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 2, role: "player" });
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    vi.mocked(prisma.match.update).mockResolvedValue({
      ...activeSeasonMatch,
      ...validBody,
      status: "played",
      resultEnteredBy: null,
    } as Awaited<ReturnType<typeof prisma.match.update>>);
    const result = await submitMatchResult(createRequest("101", validBody), createContext());
    expect(result.status).toBe(200);
  });

  it("returns 400 when the match's season is archived", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      ...activeSeasonMatch,
      season: { ...activeSeasonMatch.season, status: "archived" },
    } as Awaited<ReturnType<typeof prisma.match.findUnique>>);
    const result = await submitMatchResult(createRequest("101", validBody), createContext());
    expect(result.status).toBe(400);
    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it("returns 400 when the match is cancelled", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({ ...activeSeasonMatch, status: "cancelled" });
    const result = await submitMatchResult(createRequest("101", validBody), createContext());
    expect(result.status).toBe(400);
    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it("returns 400 when legs are missing", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    const result = await submitMatchResult(createRequest("101", { player1Legs: 3 }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when neither player has exactly 3 legs", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    const result = await submitMatchResult(
      createRequest("101", { player1Legs: 2, player2Legs: 2 }),
      createContext()
    );
    expect(result.status).toBe(400);
  });

  it("returns 400 when both players have 3 legs", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    const result = await submitMatchResult(
      createRequest("101", { player1Legs: 3, player2Legs: 3 }),
      createContext()
    );
    expect(result.status).toBe(400);
  });

  it("returns 400 when a checkout is not a positive integer", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    const result = await submitMatchResult(
      createRequest("101", { player1Legs: 3, player2Legs: 1, player1Checkout: 0 }),
      createContext()
    );
    expect(result.status).toBe(400);
  });

  it("returns 200 and records the result, setting status to played", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    vi.mocked(prisma.match.update).mockResolvedValue({
      ...activeSeasonMatch,
      player1Legs: 3,
      player2Legs: 1,
      player1Checkout: 82,
      player2Checkout: null,
      status: "played",
      resultEnteredById: 1,
      resultEnteredAt: new Date("2026-08-01T20:00:00.000Z"),
      resultEnteredBy: {
        id: 1,
        username: "admin",
        displayName: "Administrator",
        role: "admin",
        isActive: true,
        passwordHash: "h",
        createdAt: new Date(),
      },
    } as Awaited<ReturnType<typeof prisma.match.update>>);

    const result = await submitMatchResult(
      createRequest("101", { player1Legs: 3, player2Legs: 1, player1Checkout: 82 }),
      createContext()
    );

    expect(result.status).toBe(200);
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: {
        player1Legs: 3,
        player2Legs: 1,
        player1Checkout: 82,
        player2Checkout: null,
        status: "played",
        resultEnteredById: 1,
        resultEnteredAt: expect.any(Date),
      },
      include: { resultEnteredBy: true },
    });
    const body = result.jsonBody as { match: { resultEnteredBy: { displayName: string } | null } };
    expect(body.match.resultEnteredBy).toEqual({ id: 1, displayName: "Administrator" });
  });
});
