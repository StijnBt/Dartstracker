import { describe, it, expect, beforeEach } from "vitest";
import { signAuthToken, verifyAuthToken } from "../../src/lib/jwt";

describe("jwt", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
  });

  it("round-trips claims through sign and verify", () => {
    const token = signAuthToken({ userId: 42, role: "admin" });
    const claims = verifyAuthToken(token);
    expect(claims).toEqual({ userId: 42, role: "admin" });
  });

  it("returns null for a garbage token", () => {
    expect(verifyAuthToken("not-a-real-token")).toBeNull();
  });

  it("returns null for a token signed with a different secret", () => {
    const token = signAuthToken({ userId: 1, role: "player" });
    process.env.JWT_SECRET = "a-completely-different-secret-value";
    expect(verifyAuthToken(token)).toBeNull();
  });
});
