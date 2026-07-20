import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { updateMatch } from "../../../src/functions/matches/update";
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

const scheduledMatch = {
  id: 101,
  roundNumber: 1,
  date: new Date("2026-08-01"),
  player1Id: 1,
  player2Id: 2,
  status: "scheduled",
  season: { id: 1, status: "active" },
};

describe("updateMatch function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await updateMatch(createRequest("101", { status: "cancelled" }), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the id is invalid", async () => {
    const result = await updateMatch(createRequest("abc", { status: "cancelled" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the match doesn't exist", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
    const result = await updateMatch(createRequest("999", { status: "cancelled" }), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 400 when the match's season is archived", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      ...scheduledMatch,
      season: { id: 1, status: "archived" },
    });
    const result = await updateMatch(createRequest("101", { status: "cancelled" }), createContext());
    expect(result.status).toBe(400);
    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it("returns 400 when date is not a valid date", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(scheduledMatch);
    const result = await updateMatch(createRequest("101", { date: "not-a-date" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when status is not 'scheduled' or 'cancelled'", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(scheduledMatch);
    const result = await updateMatch(createRequest("101", { status: "played" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when neither date nor status is provided", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(scheduledMatch);
    const result = await updateMatch(createRequest("101", {}), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 200 and reschedules the match", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(scheduledMatch);
    vi.mocked(prisma.match.update).mockResolvedValue({ ...scheduledMatch, date: new Date("2026-08-15") });

    const result = await updateMatch(createRequest("101", { date: "2026-08-15" }), createContext());

    expect(result.status).toBe(200);
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { date: new Date("2026-08-15") },
    });
  });

  it("returns 200 and cancels the match", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(scheduledMatch);
    vi.mocked(prisma.match.update).mockResolvedValue({ ...scheduledMatch, status: "cancelled" });

    const result = await updateMatch(createRequest("101", { status: "cancelled" }), createContext());

    expect(result.status).toBe(200);
    expect(prisma.match.update).toHaveBeenCalledWith({ where: { id: 101 }, data: { status: "cancelled" } });
    const body = result.jsonBody as { match: { status: string } };
    expect(body.match.status).toBe("cancelled");
  });
});
