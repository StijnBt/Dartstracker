import { describe, it, expect, beforeEach } from "vitest";
import type { HttpRequest } from "@azure/functions";
import { requireAuth, parseCookieHeader, AuthError } from "../../src/lib/requireAuth";
import { signAuthToken } from "../../src/lib/jwt";

function createRequest(cookieHeader: string | null): HttpRequest {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === "cookie" ? cookieHeader : null),
    },
  } as unknown as HttpRequest;
}

describe("parseCookieHeader", () => {
  it("parses multiple cookies from a single header value", () => {
    expect(parseCookieHeader("a=1; b=2")).toEqual({ a: "1", b: "2" });
  });

  it("returns an empty object for a null header", () => {
    expect(parseCookieHeader(null)).toEqual({});
  });
});

describe("requireAuth", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
  });

  it("returns the claims for a valid token", async () => {
    const token = signAuthToken({ userId: 7, role: "player" });
    const claims = await requireAuth(createRequest(`authToken=${token}`));
    expect(claims).toEqual({ userId: 7, role: "player" });
  });

  it("throws a 401 AuthError when no cookie is present", async () => {
    await expect(requireAuth(createRequest(null))).rejects.toMatchObject({ status: 401 });
  });

  it("throws a 401 AuthError for an invalid token", async () => {
    await expect(requireAuth(createRequest("authToken=garbage"))).rejects.toMatchObject({ status: 401 });
  });

  it("throws a 403 AuthError when the role doesn't match", async () => {
    const token = signAuthToken({ userId: 7, role: "player" });
    await expect(requireAuth(createRequest(`authToken=${token}`), "admin")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("re-exports AuthError with a status property", () => {
    const error = new AuthError(401, "test");
    expect(error.status).toBe(401);
    expect(error).toBeInstanceOf(Error);
  });
});
