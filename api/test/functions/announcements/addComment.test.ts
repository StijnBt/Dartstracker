import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { addComment } from "../../../src/functions/announcements/addComment";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    announcement: { findUnique: vi.fn() },
    comment: { create: vi.fn() },
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

describe("addComment function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 2, role: "player" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await addComment(createRequest("5", { body: "Nice!" }), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 400 when the announcement id is invalid", async () => {
    const result = await addComment(createRequest("abc", { body: "Nice!" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when body is missing or blank", async () => {
    const result = await addComment(createRequest("5", { body: "   " }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when body is over 500 characters", async () => {
    const result = await addComment(createRequest("5", { body: "a".repeat(501) }), createContext());
    expect(result.status).toBe(400);
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });

  it("returns 201 when body is exactly 500 characters after trimming", async () => {
    vi.mocked(prisma.announcement.findUnique).mockResolvedValue(
      existingAnnouncement as unknown as Awaited<ReturnType<typeof prisma.announcement.findUnique>>
    );
    const exactly500 = "a".repeat(500);
    vi.mocked(prisma.comment.create).mockResolvedValue({
      id: 11,
      announcementId: 5,
      authorId: 2,
      body: exactly500,
      createdAt: new Date("2026-07-25T12:00:00Z"),
      author: { id: 2, displayName: "Bob Smith" },
    } as unknown as Awaited<ReturnType<typeof prisma.comment.create>>);

    const result = await addComment(createRequest("5", { body: `  ${exactly500}  ` }), createContext());

    expect(result.status).toBe(201);
    expect(prisma.comment.create).toHaveBeenCalledWith({
      data: { announcementId: 5, authorId: 2, body: exactly500 },
      include: { author: true },
    });
  });

  it("returns 404 when the announcement doesn't exist", async () => {
    vi.mocked(prisma.announcement.findUnique).mockResolvedValue(null);
    const result = await addComment(createRequest("999", { body: "Nice!" }), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 201 with the created comment, trimmed", async () => {
    vi.mocked(prisma.announcement.findUnique).mockResolvedValue(
      existingAnnouncement as unknown as Awaited<ReturnType<typeof prisma.announcement.findUnique>>
    );
    vi.mocked(prisma.comment.create).mockResolvedValue({
      id: 10,
      announcementId: 5,
      authorId: 2,
      body: "Nice!",
      createdAt: new Date("2026-07-25T11:00:00Z"),
      author: { id: 2, displayName: "Bob Smith" },
    } as unknown as Awaited<ReturnType<typeof prisma.comment.create>>);

    const result = await addComment(createRequest("5", { body: "  Nice!  " }), createContext());

    expect(prisma.comment.create).toHaveBeenCalledWith({
      data: { announcementId: 5, authorId: 2, body: "Nice!" },
      include: { author: true },
    });
    expect(result.status).toBe(201);
    expect(result.jsonBody).toEqual({
      comment: {
        id: 10,
        body: "Nice!",
        author: { id: 2, displayName: "Bob Smith" },
        createdAt: new Date("2026-07-25T11:00:00Z"),
      },
    });
  });
});
