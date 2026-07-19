import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { listUsers } from "../../../src/functions/users/list";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { user: { findMany: vi.fn() } },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

const users = [
  {
    id: 1,
    username: "admin",
    passwordHash: "hash1",
    role: "admin",
    displayName: "Administrator",
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 2,
    username: "bsmith",
    passwordHash: "hash2",
    role: "player",
    displayName: "Bob Smith",
    isActive: false,
    createdAt: new Date(),
  },
];

describe("listUsers function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when requireAuth rejects with 401", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await listUsers({} as HttpRequest, createContext());
    expect(result.status).toBe(401);
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await listUsers({} as HttpRequest, createContext());
    expect(result.status).toBe(403);
  });

  it("requires the admin role", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    await listUsers({} as HttpRequest, createContext());
    expect(requireAuth).toHaveBeenCalledWith({}, "admin");
  });

  it("returns 200 with all users, excluding passwordHash", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
    vi.mocked(prisma.user.findMany).mockResolvedValue(users);

    const result = await listUsers({} as HttpRequest, createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({
      users: [
        { id: 1, username: "admin", displayName: "Administrator", role: "admin", isActive: true },
        { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: false },
      ],
    });
  });
});
