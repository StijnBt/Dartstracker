import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { createUser } from "../../../src/functions/users/create";
import { prisma } from "../../../src/lib/prisma";
import { hashPassword } from "../../../src/lib/password";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
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

function createRequest(body: unknown): HttpRequest {
  return { json: async () => body } as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

const validBody = {
  username: "bsmith",
  displayName: "Bob Smith",
  role: "player",
  password: "secretpw1",
};

const createdUser = {
  id: 2,
  username: "bsmith",
  passwordHash: "hashed",
  role: "player",
  displayName: "Bob Smith",
  isActive: true,
  createdAt: new Date(),
};

describe("createUser function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await createUser(createRequest(validBody), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when username or displayName is missing", async () => {
    const result = await createUser(createRequest({ ...validBody, username: "" }), createContext());
    expect(result.status).toBe(400);
  });

  it("trims username and displayName before storing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(hashPassword).mockResolvedValue("hashed");
    vi.mocked(prisma.user.create).mockResolvedValue(createdUser);

    await createUser(
      createRequest({ ...validBody, username: "  bsmith  ", displayName: "  Bob Smith  " }),
      createContext()
    );

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        username: "bsmith",
        displayName: "Bob Smith",
        role: "player",
        passwordHash: "hashed",
        isActive: true,
      },
    });
  });

  it("returns 400 when role is invalid", async () => {
    const result = await createUser(createRequest({ ...validBody, role: "superadmin" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when password is shorter than 8 characters", async () => {
    const result = await createUser(createRequest({ ...validBody, password: "short" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 409 when the username already exists", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(createdUser);
    const result = await createUser(createRequest(validBody), createContext());
    expect(result.status).toBe(409);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("returns 201 with the created user on success", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(hashPassword).mockResolvedValue("hashed");
    vi.mocked(prisma.user.create).mockResolvedValue(createdUser);

    const result = await createUser(createRequest(validBody), createContext());

    expect(result.status).toBe(201);
    expect(result.jsonBody).toEqual({
      user: { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: true },
    });
  });
});
