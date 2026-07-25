import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { deleteComment } from "../../../src/functions/comments/delete";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    comment: { findUnique: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createRequest(id: string): HttpRequest {
  return { params: { id } } as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

const existingComment = { id: 10, announcementId: 5, authorId: 2, body: "Nice!", createdAt: new Date() };

describe("deleteComment function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await deleteComment(createRequest("10"), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 400 when the id is invalid", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 2, role: "player" });
    const result = await deleteComment(createRequest("abc"), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the comment doesn't exist", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 2, role: "player" });
    vi.mocked(prisma.comment.findUnique).mockResolvedValue(null);
    const result = await deleteComment(createRequest("999"), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 403 when the caller is neither the comment's author nor an admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 99, role: "player" });
    vi.mocked(prisma.comment.findUnique).mockResolvedValue(
      existingComment as unknown as Awaited<ReturnType<typeof prisma.comment.findUnique>>
    );
    const result = await deleteComment(createRequest("10"), createContext());
    expect(result.status).toBe(403);
    expect(prisma.comment.delete).not.toHaveBeenCalled();
  });

  it("allows the comment's own (non-admin) author to delete it", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 2, role: "player" });
    vi.mocked(prisma.comment.findUnique).mockResolvedValue(
      existingComment as unknown as Awaited<ReturnType<typeof prisma.comment.findUnique>>
    );
    vi.mocked(prisma.comment.delete).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.comment.delete>>);

    const result = await deleteComment(createRequest("10"), createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({ success: true });
    expect(prisma.comment.delete).toHaveBeenCalledWith({ where: { id: 10 } });
  });

  it("allows an admin to delete someone else's comment", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
    vi.mocked(prisma.comment.findUnique).mockResolvedValue(
      existingComment as unknown as Awaited<ReturnType<typeof prisma.comment.findUnique>>
    );
    vi.mocked(prisma.comment.delete).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof prisma.comment.delete>>);

    const result = await deleteComment(createRequest("10"), createContext());

    expect(result.status).toBe(200);
    expect(prisma.comment.delete).toHaveBeenCalledWith({ where: { id: 10 } });
  });
});
