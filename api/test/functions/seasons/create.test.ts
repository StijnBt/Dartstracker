import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { createSeason } from "../../../src/functions/seasons/create";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    season: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createRequest(body: unknown): HttpRequest {
  return { json: async () => body } as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

const activeMembers = [
  { id: 1, username: "admin", displayName: "Administrator", role: "admin", isActive: true, passwordHash: "h", createdAt: new Date() },
  { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: true, passwordHash: "h", createdAt: new Date() },
  { id: 3, username: "csmith", displayName: "Carol Smith", role: "player", isActive: true, passwordHash: "h", createdAt: new Date() },
  { id: 4, username: "dsmith", displayName: "Dave Smith", role: "player", isActive: true, passwordHash: "h", createdAt: new Date() },
];

const validBody = {
  name: "Spring 2026",
  roundType: "single",
  participantIds: [1, 2, 3, 4],
  roundDates: ["2026-08-01", "2026-08-08", "2026-08-15"],
};

function mockTransaction() {
  const createdMatches = [
    { id: 101, roundNumber: 1, date: new Date("2026-08-01"), player1Id: 1, player2Id: 4, status: "scheduled" },
    { id: 102, roundNumber: 1, date: new Date("2026-08-01"), player1Id: 2, player2Id: 3, status: "scheduled" },
    { id: 103, roundNumber: 2, date: new Date("2026-08-08"), player1Id: 1, player2Id: 3, status: "scheduled" },
    { id: 104, roundNumber: 2, date: new Date("2026-08-08"), player1Id: 4, player2Id: 2, status: "scheduled" },
    { id: 105, roundNumber: 3, date: new Date("2026-08-15"), player1Id: 1, player2Id: 2, status: "scheduled" },
    { id: 106, roundNumber: 3, date: new Date("2026-08-15"), player1Id: 3, player2Id: 4, status: "scheduled" },
  ];
  const tx = {
    season: { create: vi.fn().mockResolvedValue({ id: 10, name: "Spring 2026", roundType: "single", status: "active" }) },
    seasonParticipant: { createMany: vi.fn().mockResolvedValue({ count: 4 }) },
    match: { create: vi.fn() },
  };
  let callIndex = 0;
  vi.mocked(tx.match.create).mockImplementation(async () => createdMatches[callIndex++]);
  vi.mocked(prisma.$transaction).mockImplementation(
    (async (fn: (tx: unknown) => unknown) => fn(tx)) as unknown as typeof prisma.$transaction
  );
  return tx;
}

describe("createSeason function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await createSeason(createRequest(validBody), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when name is blank", async () => {
    const result = await createSeason(createRequest({ ...validBody, name: "   " }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when roundType is invalid", async () => {
    const result = await createSeason(createRequest({ ...validBody, roundType: "triple" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when fewer than 2 participants are given", async () => {
    const result = await createSeason(createRequest({ ...validBody, participantIds: [1] }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when participantIds contains a duplicate", async () => {
    const result = await createSeason(
      createRequest({ ...validBody, participantIds: [1, 2, 2, 3] }),
      createContext()
    );
    expect(result.status).toBe(400);
  });

  it("returns 400 when roundDates length doesn't match the computed round count", async () => {
    const result = await createSeason(
      createRequest({ ...validBody, roundDates: ["2026-08-01"] }),
      createContext()
    );
    expect(result.status).toBe(400);
  });

  it("returns 409 when a season is already active", async () => {
    vi.mocked(prisma.season.findFirst).mockResolvedValue({ id: 5, status: "active" } as Awaited<
      ReturnType<typeof prisma.season.findFirst>
    >);
    const result = await createSeason(createRequest(validBody), createContext());
    expect(result.status).toBe(409);
  });

  it("returns 400 when a participant id is unknown or inactive", async () => {
    vi.mocked(prisma.season.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.findMany).mockResolvedValue(activeMembers.slice(0, 3)); // only 3 of 4 found
    const result = await createSeason(createRequest(validBody), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 201 with the created season and schedule on success", async () => {
    vi.mocked(prisma.season.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.findMany).mockResolvedValue(activeMembers);
    const tx = mockTransaction();

    const result = await createSeason(createRequest(validBody), createContext());

    expect(result.status).toBe(201);
    expect(tx.season.create).toHaveBeenCalledWith({ data: { name: "Spring 2026", roundType: "single" } });
    expect(tx.seasonParticipant.createMany).toHaveBeenCalledWith({
      data: [
        { seasonId: 10, userId: 1 },
        { seasonId: 10, userId: 2 },
        { seasonId: 10, userId: 3 },
        { seasonId: 10, userId: 4 },
      ],
    });
    expect(tx.match.create).toHaveBeenCalledTimes(6);
    const roundDateByNumber: Record<number, Date> = {
      1: new Date("2026-08-01"),
      2: new Date("2026-08-08"),
      3: new Date("2026-08-15"),
    };
    const seenPairs = new Set<string>();
    for (const [args] of vi.mocked(tx.match.create).mock.calls) {
      const data = (args as { data: { seasonId: number; roundNumber: number; date: Date; player1Id: number; player2Id: number } }).data;
      expect(data.seasonId).toBe(10);
      expect([1, 2, 3]).toContain(data.roundNumber);
      expect(data.date).toEqual(roundDateByNumber[data.roundNumber]);
      expect([1, 2, 3, 4]).toContain(data.player1Id);
      expect([1, 2, 3, 4]).toContain(data.player2Id);
      expect(data.player1Id).not.toBe(data.player2Id);
      const pairKey = [data.player1Id, data.player2Id].sort((a, b) => a - b).join("-");
      expect(seenPairs.has(pairKey)).toBe(false);
      seenPairs.add(pairKey);
    }
    expect(seenPairs).toEqual(
      new Set(["1-2", "1-3", "1-4", "2-3", "2-4", "3-4"])
    );
    const body = result.jsonBody as { season: { participants: unknown[]; matches: unknown[] } };
    expect(body.season.participants).toHaveLength(4);
    expect(body.season.matches).toHaveLength(6);
  });
});
