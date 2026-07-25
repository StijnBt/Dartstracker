import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { deleteAnnouncement } from "../../../src/functions/announcements/delete";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { announcement: { findUnique: vi.fn() }, $transaction: vi.fn() },
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

const existingAnnouncement = { id: 5, authorId: 1, title: "Season kickoff", body: "Welcome!", createdAt: new Date() };

function mockTransaction() {
  const tx = {
    comment: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    announcement: { delete: vi.fn().mockResolvedValue({}) },
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    (async (fn: (tx: unknown) => unknown) => fn(tx)) as unknown as typeof prisma.$transaction
  );
  return tx;
}

describe("deleteAnnouncement function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await deleteAnnouncement(createRequest("5"), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the id is invalid", async () => {
    const result = await deleteAnnouncement(createRequest("abc"), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the announcement doesn't exist", async () => {
    vi.mocked(prisma.announcement.findUnique).mockResolvedValue(null);
    const result = await deleteAnnouncement(createRequest("999"), createContext());
    expect(result.status).toBe(404);
  });

  it("deletes the announcement's comments before the announcement itself, in one transaction", async () => {
    vi.mocked(prisma.announcement.findUnique).mockResolvedValue(
      existingAnnouncement as unknown as Awaited<ReturnType<typeof prisma.announcement.findUnique>>
    );
    const tx = mockTransaction();
    const callOrder: string[] = [];
    tx.comment.deleteMany.mockImplementation(async () => {
      callOrder.push("comment");
      return { count: 2 };
    });
    tx.announcement.delete.mockImplementation(async () => {
      callOrder.push("announcement");
      return {};
    });

    const result = await deleteAnnouncement(createRequest("5"), createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({ success: true });
    expect(tx.comment.deleteMany).toHaveBeenCalledWith({ where: { announcementId: 5 } });
    expect(tx.announcement.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(callOrder).toEqual(["comment", "announcement"]);
  });
});
