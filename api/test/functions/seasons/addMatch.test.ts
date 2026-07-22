import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { addMatch } from "../../../src/functions/seasons/addMatch";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    season: { findUnique: vi.fn() },
    seasonParticipant: { findMany: vi.fn() },
    match: { create: vi.fn() },
  },
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

const activeSeason = { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: new Date() };
const validBody = { date: "2026-08-15", player1Id: 1, player2Id: 2 };

describe("addMatch function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await addMatch(createRequest("1", validBody), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the season id is invalid", async () => {
    const result = await addMatch(createRequest("abc", validBody), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when date is not a valid date", async () => {
    const result = await addMatch(createRequest("1", { ...validBody, date: "not-a-date" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when player1Id equals player2Id", async () => {
    const result = await addMatch(createRequest("1", { ...validBody, player2Id: 1 }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the season doesn't exist", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue(null);
    const result = await addMatch(createRequest("999", validBody), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 400 when the season is archived", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue({
      ...activeSeason,
      status: "archived",
    } as unknown as Awaited<ReturnType<typeof prisma.season.findUnique>>);
    const result = await addMatch(createRequest("1", validBody), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when a player is not a participant of this season", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue(
      activeSeason as unknown as Awaited<ReturnType<typeof prisma.season.findUnique>>
    );
    vi.mocked(prisma.seasonParticipant.findMany).mockResolvedValue([
      { id: 1, seasonId: 1, userId: 1, user: { id: 1, displayName: "Administrator" } },
    ] as unknown as Awaited<ReturnType<typeof prisma.seasonParticipant.findMany>>);
    const result = await addMatch(createRequest("1", validBody), createContext());
    expect(result.status).toBe(400);
    expect(prisma.match.create).not.toHaveBeenCalled();
  });

  it("returns 201 with roundNumber 0 on success", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue(
      activeSeason as unknown as Awaited<ReturnType<typeof prisma.season.findUnique>>
    );
    vi.mocked(prisma.seasonParticipant.findMany).mockResolvedValue([
      { id: 1, seasonId: 1, userId: 1, user: { id: 1, displayName: "Administrator" } },
      { id: 2, seasonId: 1, userId: 2, user: { id: 2, displayName: "Bob Smith" } },
    ] as unknown as Awaited<ReturnType<typeof prisma.seasonParticipant.findMany>>);
    vi.mocked(prisma.match.create).mockResolvedValue({
      id: 501,
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
    } as unknown as Awaited<ReturnType<typeof prisma.match.create>>);

    const result = await addMatch(createRequest("1", validBody), createContext());

    expect(result.status).toBe(201);
    expect(prisma.match.create).toHaveBeenCalledWith({
      data: { seasonId: 1, roundNumber: 0, date: new Date("2026-08-15"), player1Id: 1, player2Id: 2 },
    });
    expect(result.jsonBody).toEqual({
      match: {
        id: 501,
        roundNumber: 0,
        date: new Date("2026-08-15"),
        status: "scheduled",
        player1: { id: 1, displayName: "Administrator" },
        player2: { id: 2, displayName: "Bob Smith" },
        player1Legs: null,
        player2Legs: null,
        player1Checkout: null,
        player2Checkout: null,
        resultEnteredBy: null,
        resultEnteredAt: null,
      },
    });
  });
});
