import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { login } from "../../../src/functions/auth/login";
import { prisma } from "../../../src/lib/prisma";
import { verifyPassword } from "../../../src/lib/password";
import { signAuthToken } from "../../../src/lib/jwt";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

vi.mock("../../../src/lib/password", () => ({
  verifyPassword: vi.fn(),
}));

vi.mock("../../../src/lib/jwt", () => ({
  signAuthToken: vi.fn(),
  AUTH_COOKIE_NAME: "authToken",
  TOKEN_MAX_AGE_SECONDS: 2592000,
}));

function createRequest(body: unknown, url = "http://localhost:7071/api/auth/login"): HttpRequest {
  return { url, json: async () => body } as unknown as HttpRequest;
}

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

describe("login function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when username or password is missing", async () => {
    const result = await login(createRequest({ username: "admin" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 401 when the user doesn't exist", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const result = await login(createRequest({ username: "admin", password: "secret" }), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 401 when the user is inactive", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...activeAdmin, isActive: false });
    const result = await login(createRequest({ username: "admin", password: "secret" }), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 401 when the password is incorrect", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(activeAdmin);
    vi.mocked(verifyPassword).mockResolvedValue(false);
    const result = await login(createRequest({ username: "admin", password: "wrong" }), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 200 with the user and sets an httpOnly cookie on success", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(activeAdmin);
    vi.mocked(verifyPassword).mockResolvedValue(true);
    vi.mocked(signAuthToken).mockReturnValue("signed-token");

    const result = await login(createRequest({ username: "admin", password: "secret" }), createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
    });
    expect(result.cookies).toEqual([
      {
        name: "authToken",
        value: "signed-token",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
        path: "/",
        maxAge: 2592000,
      },
    ]);
  });

  it("marks the cookie secure when the request was made over https", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(activeAdmin);
    vi.mocked(verifyPassword).mockResolvedValue(true);
    vi.mocked(signAuthToken).mockReturnValue("signed-token");

    const result = await login(
      createRequest({ username: "admin", password: "secret" }, "https://dartstracker.example/api/auth/login"),
      createContext()
    );

    expect(result.cookies?.[0]).toMatchObject({ secure: true });
  });
});
