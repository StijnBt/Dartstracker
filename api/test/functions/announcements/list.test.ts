import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { listAnnouncements } from "../../../src/functions/announcements/list";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    announcement: { findMany: vi.fn() },
  },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createRequest(): HttpRequest {
  return {} as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

describe("listAnnouncements function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 2, role: "player" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await listAnnouncements(createRequest(), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 200 with an empty array when there are no announcements", async () => {
    vi.mocked(prisma.announcement.findMany).mockResolvedValue([]);
    const result = await listAnnouncements(createRequest(), createContext());
    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({ announcements: [] });
  });

  it("returns announcements newest-first with comments oldest-first", async () => {
    vi.mocked(prisma.announcement.findMany).mockResolvedValue([
      {
        id: 2,
        title: "Playoffs start soon",
        body: "Get ready.",
        authorId: 1,
        createdAt: new Date("2026-07-25T10:00:00Z"),
        author: { id: 1, displayName: "Administrator" },
        comments: [
          {
            id: 10,
            body: "Nice!",
            authorId: 2,
            announcementId: 2,
            createdAt: new Date("2026-07-25T11:00:00Z"),
            author: { id: 2, displayName: "Bob Smith" },
          },
        ],
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.announcement.findMany>>);

    const result = await listAnnouncements(createRequest(), createContext());

    expect(prisma.announcement.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      include: {
        author: true,
        comments: { include: { author: true }, orderBy: { createdAt: "asc" } },
      },
    });
    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({
      announcements: [
        {
          id: 2,
          title: "Playoffs start soon",
          body: "Get ready.",
          author: { id: 1, displayName: "Administrator" },
          createdAt: new Date("2026-07-25T10:00:00Z"),
          comments: [
            {
              id: 10,
              body: "Nice!",
              author: { id: 2, displayName: "Bob Smith" },
              createdAt: new Date("2026-07-25T11:00:00Z"),
            },
          ],
        },
      ],
    });
  });
});
