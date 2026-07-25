import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { updateAnnouncement } from "../../../src/functions/announcements/update";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    announcement: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

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

const existingAnnouncement = { id: 5, authorId: 1, title: "Season kickoff", body: "Welcome!", createdAt: new Date() };

describe("updateAnnouncement function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await updateAnnouncement(createRequest("5", { title: "New" }), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the id is invalid", async () => {
    const result = await updateAnnouncement(createRequest("abc", { title: "New" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the announcement doesn't exist", async () => {
    vi.mocked(prisma.announcement.findUnique).mockResolvedValue(null);
    const result = await updateAnnouncement(createRequest("999", { title: "New" }), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 400 when title is provided but blank", async () => {
    vi.mocked(prisma.announcement.findUnique).mockResolvedValue(
      existingAnnouncement as unknown as Awaited<ReturnType<typeof prisma.announcement.findUnique>>
    );
    const result = await updateAnnouncement(createRequest("5", { title: "   " }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 200 and updates only the provided fields, trimmed", async () => {
    vi.mocked(prisma.announcement.findUnique).mockResolvedValue(
      existingAnnouncement as unknown as Awaited<ReturnType<typeof prisma.announcement.findUnique>>
    );
    vi.mocked(prisma.announcement.update).mockResolvedValue({
      id: 5,
      authorId: 1,
      title: "Season kickoff (updated)",
      body: "Welcome!",
      createdAt: existingAnnouncement.createdAt,
      author: { id: 1, displayName: "Administrator" },
      comments: [],
    } as unknown as Awaited<ReturnType<typeof prisma.announcement.update>>);

    const result = await updateAnnouncement(createRequest("5", { title: "  Season kickoff (updated)  " }), createContext());

    expect(prisma.announcement.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { title: "Season kickoff (updated)" },
      include: { author: true, comments: { include: { author: true }, orderBy: { createdAt: "asc" } } },
    });
    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({
      announcement: {
        id: 5,
        title: "Season kickoff (updated)",
        body: "Welcome!",
        author: { id: 1, displayName: "Administrator" },
        createdAt: existingAnnouncement.createdAt,
        comments: [],
      },
    });
  });
});
