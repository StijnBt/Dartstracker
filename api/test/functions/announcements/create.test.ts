import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { createAnnouncement } from "../../../src/functions/announcements/create";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    announcement: { create: vi.fn() },
  },
}));

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

const validBody = { title: "Season kickoff", body: "Welcome back everyone!" };

describe("createAnnouncement function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await createAnnouncement(createRequest(validBody), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when title is missing or blank", async () => {
    const result = await createAnnouncement(createRequest({ ...validBody, title: "  " }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when body is missing or blank", async () => {
    const result = await createAnnouncement(createRequest({ ...validBody, body: "" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 201 with the created announcement, trimmed, and an empty comments array", async () => {
    vi.mocked(prisma.announcement.create).mockResolvedValue({
      id: 5,
      authorId: 1,
      title: "Season kickoff",
      body: "Welcome back everyone!",
      createdAt: new Date("2026-07-25T10:00:00Z"),
      author: { id: 1, displayName: "Administrator" },
    } as unknown as Awaited<ReturnType<typeof prisma.announcement.create>>);

    const result = await createAnnouncement(
      createRequest({ title: "  Season kickoff  ", body: "  Welcome back everyone!  " }),
      createContext()
    );

    expect(prisma.announcement.create).toHaveBeenCalledWith({
      data: { title: "Season kickoff", body: "Welcome back everyone!", authorId: 1 },
      include: { author: true },
    });
    expect(result.status).toBe(201);
    expect(result.jsonBody).toEqual({
      announcement: {
        id: 5,
        title: "Season kickoff",
        body: "Welcome back everyone!",
        author: { id: 1, displayName: "Administrator" },
        createdAt: new Date("2026-07-25T10:00:00Z"),
        comments: [],
      },
    });
  });
});
