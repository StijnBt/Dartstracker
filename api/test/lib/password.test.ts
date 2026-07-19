import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/password";

describe("password", () => {
  it("produces a hash that verifies correctly against the original password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });

  it("produces a different hash each time due to salting", async () => {
    const hash1 = await hashPassword("same password");
    const hash2 = await hashPassword("same password");
    expect(hash1).not.toBe(hash2);
  });
});
