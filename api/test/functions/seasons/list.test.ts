import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { listSeasons } from "../../../src/functions/seasons/list";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { season: { findMany: vi.fn() } },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

describe("listSeasons function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await listSeasons({} as HttpRequest, createContext());
    expect(result.status).toBe(401);
  });

  it("does not require the admin role", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 2, role: "player" });
    vi.mocked(prisma.season.findMany).mockResolvedValue([]);
    const result = await listSeasons({} as HttpRequest, createContext());
    expect(result.status).toBe(200);
    expect(requireAuth).toHaveBeenCalledWith({});
  });

  it("returns 200 with all seasons", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
    const createdAt = new Date();
    vi.mocked(prisma.season.findMany).mockResolvedValue([
      { id: 2, name: "Summer 2026", roundType: "double", status: "active", createdAt },
      { id: 1, name: "Winter 2025", roundType: "single", status: "archived", createdAt },
    ]);

    const result = await listSeasons({} as HttpRequest, createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({
      seasons: [
        { id: 2, name: "Summer 2026", roundType: "double", status: "active", createdAt },
        { id: 1, name: "Winter 2025", roundType: "single", status: "archived", createdAt },
      ],
    });
  });
});
