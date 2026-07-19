import { describe, it, expect } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { logout } from "../../../src/functions/auth/logout";

function createRequest(url: string): HttpRequest {
  return { url } as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

describe("logout function", () => {
  it("clears the auth cookie by setting maxAge to 0", async () => {
    const result = await logout(createRequest("http://localhost:7071/api/auth/logout"), createContext());
    expect(result.status).toBe(200);
    expect(result.cookies).toEqual([
      { name: "authToken", value: "", httpOnly: true, secure: false, sameSite: "Lax", path: "/", maxAge: 0 },
    ]);
  });

  it("marks the cleared cookie secure over https", async () => {
    const result = await logout(createRequest("https://dartstracker.example/api/auth/logout"), createContext());
    expect(result.cookies?.[0]).toMatchObject({ secure: true });
  });
});
