import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { me } from "../../../src/functions/auth/me";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

const activeAdmin = {
  id: 1,
  username: "admin",
  passwordHash: "hash",
  role: "admin",
  displayName: "Administrator",
  isActive: true,
  createdAt: new Date(),
};

describe("me function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when requireAuth rejects", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await me({} as HttpRequest, createContext());
    expect(result.status).toBe(401);
  });

  it("returns 401 when the authenticated user no longer exists", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const result = await me({} as HttpRequest, createContext());
    expect(result.status).toBe(401);
  });

  it("returns 401 when the authenticated user has been deactivated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...activeAdmin, isActive: false });
    const result = await me({} as HttpRequest, createContext());
    expect(result.status).toBe(401);
  });

  it("returns 200 with the current user", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(activeAdmin);
    const result = await me({} as HttpRequest, createContext());
    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
    });
  });
});
