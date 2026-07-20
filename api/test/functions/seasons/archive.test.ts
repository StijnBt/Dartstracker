import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { archiveSeason } from "../../../src/functions/seasons/archive";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { season: { findUnique: vi.fn(), update: vi.fn() } },
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

const activeSeason = { id: 1, name: "Spring 2026", roundType: "single", status: "active" };

describe("archiveSeason function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await archiveSeason(createRequest("1", { status: "archived" }), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the id is invalid", async () => {
    const result = await archiveSeason(createRequest("abc", { status: "archived" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when status is not 'archived'", async () => {
    const result = await archiveSeason(createRequest("1", { status: "active" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the season doesn't exist", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue(null);
    const result = await archiveSeason(createRequest("999", { status: "archived" }), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 400 when the season is already archived", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue({ ...activeSeason, status: "archived" });
    const result = await archiveSeason(createRequest("1", { status: "archived" }), createContext());
    expect(result.status).toBe(400);
    expect(prisma.season.update).not.toHaveBeenCalled();
  });

  it("returns 200 with the archived season on success", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue(activeSeason);
    vi.mocked(prisma.season.update).mockResolvedValue({ ...activeSeason, status: "archived" });

    const result = await archiveSeason(createRequest("1", { status: "archived" }), createContext());

    expect(result.status).toBe(200);
    expect(prisma.season.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: "archived" } });
    expect(result.jsonBody).toEqual({
      season: { id: 1, name: "Spring 2026", roundType: "single", status: "archived" },
    });
  });
});
