import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { updateUser } from "../../../src/functions/users/update";
import { prisma } from "../../../src/lib/prisma";
import { hashPassword } from "../../../src/lib/password";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("../../../src/lib/password", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/password")>("../../../src/lib/password");
  return { ...actual, hashPassword: vi.fn() };
});

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

const existingPlayer = {
  id: 2,
  username: "bsmith",
  passwordHash: "hash",
  role: "player",
  displayName: "Bob Smith",
  isActive: true,
  createdAt: new Date(),
};

describe("updateUser function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await updateUser(createRequest("2", { displayName: "New Name" }), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 404 when the target user doesn't exist", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const result = await updateUser(createRequest("999", { displayName: "New Name" }), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 400 when displayName is blank", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingPlayer);
    const result = await updateUser(createRequest("2", { displayName: "   " }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when role is invalid", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingPlayer);
    const result = await updateUser(createRequest("2", { role: "superadmin" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when password is shorter than 8 characters", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingPlayer);
    const result = await updateUser(createRequest("2", { password: "short" }), createContext());
    expect(result.status).toBe(400);
  });

  it("rejects changing your own role away from admin", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...existingPlayer, id: 1, role: "admin" });
    const result = await updateUser(createRequest("1", { role: "player" }), createContext());
    expect(result.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects deactivating your own account", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...existingPlayer, id: 1, role: "admin" });
    const result = await updateUser(createRequest("1", { isActive: false }), createContext());
    expect(result.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("allows deactivating a different user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingPlayer);
    vi.mocked(prisma.user.update).mockResolvedValue({ ...existingPlayer, isActive: false });

    const result = await updateUser(createRequest("2", { isActive: false }), createContext());

    expect(result.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { isActive: false } });
  });

  it("re-hashes the password when a new one is provided", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingPlayer);
    vi.mocked(hashPassword).mockResolvedValue("new-hash");
    vi.mocked(prisma.user.update).mockResolvedValue(existingPlayer);

    await updateUser(createRequest("2", { password: "newpassword1" }), createContext());

    expect(hashPassword).toHaveBeenCalledWith("newpassword1");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { passwordHash: "new-hash" },
    });
  });

  it("returns 200 with the updated user on success", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingPlayer);
    vi.mocked(prisma.user.update).mockResolvedValue({ ...existingPlayer, displayName: "Robert Smith" });

    const result = await updateUser(createRequest("2", { displayName: "Robert Smith" }), createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({
      user: { id: 2, username: "bsmith", displayName: "Robert Smith", role: "player", isActive: true },
    });
  });
});
