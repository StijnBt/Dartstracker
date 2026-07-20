import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { getSeason } from "../../../src/functions/seasons/get";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { season: { findUnique: vi.fn() } },
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

describe("getSeason function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 2, role: "player" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await getSeason(createRequest("1"), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 400 when the id is invalid", async () => {
    const result = await getSeason(createRequest("abc"), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the season doesn't exist", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue(null);
    const result = await getSeason(createRequest("999"), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 200 with participants and matches, resolving display names", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue({
      id: 1,
      name: "Spring 2026",
      roundType: "single",
      status: "active",
      createdAt: new Date(),
      participants: [
        { user: { id: 1, displayName: "Administrator" } },
        { user: { id: 2, displayName: "Bob Smith" } },
      ],
      matches: [
        {
          id: 101,
          roundNumber: 1,
          date: new Date("2026-08-01"),
          status: "scheduled",
          player1: { id: 1, displayName: "Administrator" },
          player2: { id: 2, displayName: "Bob Smith" },
        },
      ],
    } as unknown as Awaited<ReturnType<typeof prisma.season.findUnique>>);

    const result = await getSeason(createRequest("1"), createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({
      season: {
        id: 1,
        name: "Spring 2026",
        roundType: "single",
        status: "active",
        participants: [
          { id: 1, displayName: "Administrator" },
          { id: 2, displayName: "Bob Smith" },
        ],
        matches: [
          {
            id: 101,
            roundNumber: 1,
            date: new Date("2026-08-01"),
            status: "scheduled",
            player1: { id: 1, displayName: "Administrator" },
            player2: { id: 2, displayName: "Bob Smith" },
          },
        ],
      },
    });
  });
});
