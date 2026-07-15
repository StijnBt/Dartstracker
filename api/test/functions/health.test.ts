import { describe, it, expect } from "vitest";
import { health } from "../../src/functions/health";
import type { HttpRequest, InvocationContext } from "@azure/functions";

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

describe("health function", () => {
  it("returns 200 with status ok", async () => {
    const result = await health({} as HttpRequest, createContext());
    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({ status: "ok" });
  });
});
