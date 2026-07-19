import { describe, it, expect, vi } from "vitest";
import { health } from "../../src/functions/health";
import { prisma } from "../../src/lib/prisma";
import type { HttpRequest, InvocationContext } from "@azure/functions";

vi.mock("../../src/lib/prisma", () => ({
  prisma: { $queryRaw: vi.fn() },
}));

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

describe("health function", () => {
  it("returns 200 with dbConnected true when the query succeeds", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ ok: 1 }]);
    const result = await health({} as HttpRequest, createContext());
    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({ status: "ok", dbConnected: true });
  });

  it("returns 500 with dbConnected false when the query fails", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("connection failed"));
    const result = await health({} as HttpRequest, createContext());
    expect(result.status).toBe(500);
    expect(result.jsonBody).toEqual({ status: "error", dbConnected: false });
  });
});
