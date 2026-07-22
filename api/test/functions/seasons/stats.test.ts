import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { getSeasonStats } from "../../../src/functions/seasons/stats";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { season: { findUnique: vi.fn() }, throw: { findMany: vi.fn() } },
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

describe("getSeasonStats function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 2, role: "player" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await getSeasonStats(createRequest("1"), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 400 when the id is invalid", async () => {
    const result = await getSeasonStats(createRequest("abc"), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the season doesn't exist", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue(null);
    const result = await getSeasonStats(createRequest("999"), createContext());
    expect(result.status).toBe(404);
  });

  it("queries throws scoped to played matches in this season", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue({
      id: 1,
      participants: [{ user: { id: 1, displayName: "Administrator" } }],
    } as unknown as Awaited<ReturnType<typeof prisma.season.findUnique>>);
    vi.mocked(prisma.throw.findMany).mockResolvedValue([]);

    await getSeasonStats(createRequest("1"), createContext());

    expect(prisma.throw.findMany).toHaveBeenCalledWith({
      where: { leg: { match: { seasonId: 1, status: "played" } } },
      select: { legId: true, playerId: true, turnNumber: true, value: true, busted: true },
    });
  });

  it("returns 200 with stats joined to display names, sorted by average descending", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue({
      id: 1,
      participants: [
        { user: { id: 1, displayName: "Administrator" } },
        { user: { id: 2, displayName: "Bob Smith" } },
      ],
    } as unknown as Awaited<ReturnType<typeof prisma.season.findUnique>>);
    vi.mocked(prisma.throw.findMany).mockResolvedValue([
      { legId: 1, playerId: 1, turnNumber: 1, value: 20, busted: false },
      { legId: 1, playerId: 1, turnNumber: 1, value: 20, busted: false },
      { legId: 1, playerId: 1, turnNumber: 1, value: 20, busted: false },
      { legId: 1, playerId: 2, turnNumber: 2, value: 60, busted: false },
      { legId: 1, playerId: 2, turnNumber: 2, value: 60, busted: false },
      { legId: 1, playerId: 2, turnNumber: 2, value: 60, busted: false },
    ] as unknown as Awaited<ReturnType<typeof prisma.throw.findMany>>);

    const result = await getSeasonStats(createRequest("1"), createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({
      stats: [
        { playerId: 2, displayName: "Bob Smith", threeDartAverage: 180, oneEightyCount: 1 },
        { playerId: 1, displayName: "Administrator", threeDartAverage: 60, oneEightyCount: 0 },
      ],
    });
  });
});
