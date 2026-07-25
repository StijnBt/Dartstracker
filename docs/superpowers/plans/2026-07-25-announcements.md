# Announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin post announcements (title + body) visible to every logged-in member, newest-first, and let any member add a short comment (max 500 characters) on an announcement — replacing the current `Home` page's content below its header with this feed.

**Architecture:** Two new Prisma models (`Announcement`, `Comment`), six new Azure Functions endpoints under `/api/announcements` and `/api/comments` following this codebase's existing `requireAuth`/error-shape conventions exactly. On the frontend, `Home.tsx` keeps its existing header untouched and renders a new `AnnouncementFeed` component below it (only when logged in), which in turn renders one `AnnouncementCard` per announcement — `AnnouncementFeed` owns data-fetching and mutation orchestration (mirroring `Season.tsx`), `AnnouncementCard` is a presentational component owning only its own local UI toggle state (mirroring `RoundRobinSchedule.tsx`).

**Tech Stack:** No new dependencies. Same stack as prior phases (Azure Functions, Prisma, React, Vitest, React Testing Library).

## Global Constraints

- Two new Prisma models only — no changes to any existing model. `Announcement.body` gets an explicit `@db.NVarChar(Max)` (unlimited length); every other new `String` field uses the schema's existing default (SQL Server `nvarchar(1000)`), which comfortably covers the 500-char comment cap.
- Any FK to `User` must have `onDelete: NoAction, onUpdate: NoAction` — SQL Server rejects the implicit cascade default once multiple FKs reference the same target table anywhere in the schema (already true here because of `Match.player1`/`player2`). `Announcement.author` and `Comment.author` both need this; `Comment.announcement` (FK to `Announcement`, not `User`) does not.
- Auth model per endpoint: `GET /api/announcements` — any authenticated user. `POST /api/announcements`, `PATCH /api/announcements/{id}`, `DELETE /api/announcements/{id}` — admin only. `POST /api/announcements/{id}/comments` — any authenticated user. `DELETE /api/comments/{id}` — admin **or** the comment's own author (new "admin-or-owner" check, same shape as the existing admin-or-participant check in `matches/result.ts`, just comparing `authorId` instead of `player1Id`/`player2Id`).
- Comment `body` is validated non-empty and ≤500 characters (trimmed) server-side; 400 otherwise. Announcement `title`/`body` are validated non-empty (trimmed); no length cap.
- No comment editing — only creation and (owner-or-admin) deletion.
- Deleting an announcement deletes its comments first inside one `prisma.$transaction` (no cascading delete configured), same pattern as the existing match-delete transaction (`Comment` → `Announcement`, dependency order).
- No pagination — the whole announcement list loads at once, same as Standings/Season Stats.
- `Home.tsx`'s existing header (logo, "Season"/"Manage Members" links, user name, logout) is untouched. The new feed renders below it, gated by the same `{user && ...}` check the header's own nav already uses. No new route — `/` already renders `Home`.
- The comment box is collapsed behind a per-announcement "Reply" button, not always visible.
- Admin edits an announcement inline in place (toggles the card into an editable form, Save/Cancel) — not a separate route, mirroring how `Season.tsx` does inline reschedule.
- New frontend mutation handlers use `try/catch` with an inline error message state — a deliberate improvement over the known pre-existing gap on `Season.tsx` (whose handlers are fire-and-forget with no error surfacing); `Season.tsx` itself is not touched by this plan.
- Frontend type naming: the comment type is `AnnouncementComment`, not `Comment` — `Comment` collides with the DOM's global `Comment` interface (`lib.dom.d.ts`, included via `tsconfig.json`'s `"lib": [..., "DOM", ...]`); avoiding the bare name sidesteps any shadowing confusion. The Prisma model itself is still named `Comment` (backend `tsconfig.json` has no DOM lib, so there's no collision there).

---

### Task 1: Prisma schema — `Announcement` and `Comment` models

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: migration via `prisma migrate dev`

**Interfaces:**
- Produces: `Announcement` and `Comment` Prisma models, plus two new relation fields on `User` (`announcementsPosted`, `commentsPosted`). All later backend tasks query these via `prisma.announcement` / `prisma.comment` (or the transaction-scoped `tx.comment` / `tx.announcement`).

- [ ] **Step 1: Ensure the local dev database is running**

```bash
cd "D:/WEB/Dartstracker" && docker start dartstracker-sqlserver
```
Expected: container reports `dartstracker-sqlserver` (already running is fine).

- [ ] **Step 2: Add the following to `api/prisma/schema.prisma`**

Add two new relation fields to the existing `User` model (insert after `throwsRecorded`):

```prisma
  announcementsPosted  Announcement[]      @relation("AnnouncementAuthor")
  commentsPosted       Comment[]           @relation("CommentAuthor")
```

Append two new models at the end of the file:

```prisma
model Announcement {
  id        Int      @id @default(autoincrement())
  authorId  Int
  title     String
  body      String   @db.NVarChar(Max)
  createdAt DateTime @default(now())

  author   User      @relation("AnnouncementAuthor", fields: [authorId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  comments Comment[]
}

model Comment {
  id             Int      @id @default(autoincrement())
  announcementId Int
  authorId       Int
  body           String
  createdAt      DateTime @default(now())

  announcement Announcement @relation(fields: [announcementId], references: [id])
  author       User         @relation("CommentAuthor", fields: [authorId], references: [id], onDelete: NoAction, onUpdate: NoAction)
}
```

Note: `onDelete: NoAction, onUpdate: NoAction` on `Announcement.author` and `Comment.author` is required — SQL Server rejects the implicit default (`Cascade`) because multiple FKs already reference `User` elsewhere in this schema (`Match.player1`/`player2`), creating multiple cascade paths (Prisma error P1012). `Comment.announcement` has no such conflict (it's the only FK to `Announcement`), so it uses the default, matching the existing `Leg.match`/`Throw.leg` precedent.

- [ ] **Step 3: Generate and apply the migration**

```bash
cd "D:/WEB/Dartstracker/.claude/worktrees/darts-announcements/api" && npx prisma migrate dev --name add_announcement_models
```
Expected: creates `prisma/migrations/<timestamp>_add_announcement_models/migration.sql` with `CREATE TABLE` statements for `Announcement` and `Comment`, applies it to the local database, regenerates the Prisma client. No errors.

- [ ] **Step 4: Verify the client builds**

```bash
npm run build
```
Expected: `tsc` succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add Announcement and Comment models"
```

---

### Task 2: `GET /api/announcements` — list endpoint (backend)

**Files:**
- Create: `api/src/functions/announcements/list.ts`
- Test: `api/test/functions/announcements/list.test.ts`

**Interfaces:**
- Produces: the exported `listAnnouncements` Azure Functions handler, registered at `GET /api/announcements`, returning `{ announcements: [{ id, title, body, author: { id, displayName }, createdAt, comments: [{ id, body, author: { id, displayName }, createdAt }] }] }` on success (`200`), announcements newest-first, comments within each announcement oldest-first. Task 8 (frontend `api-client.ts`) calls this route and mirrors this exact response shape in its `Announcement`/`AnnouncementComment` types.

- [ ] **Step 1: Write the failing test — `api/test/functions/announcements/list.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "D:/WEB/Dartstracker/.claude/worktrees/darts-announcements/api" && npm test -- announcements/list
```
Expected: FAIL — `api/src/functions/announcements/list.ts` doesn't exist yet.

- [ ] **Step 3: Write `api/src/functions/announcements/list.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

export async function listAnnouncements(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request);

    const announcements = await prisma.announcement.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        author: true,
        comments: { include: { author: true }, orderBy: { createdAt: "asc" } },
      },
    });

    return {
      status: 200,
      jsonBody: {
        announcements: announcements.map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          author: { id: a.author.id, displayName: a.author.displayName },
          createdAt: a.createdAt,
          comments: a.comments.map((c) => ({
            id: c.id,
            body: c.body,
            author: { id: c.author.id, displayName: c.author.displayName },
            createdAt: c.createdAt,
          })),
        })),
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`GET /api/announcements failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("announcementsList", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "announcements",
  handler: listAnnouncements,
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- announcements/list
```
Expected: PASS — all three tests pass.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/functions/announcements/list.ts test/functions/announcements/list.test.ts
git commit -m "Add GET /api/announcements list endpoint"
```

---

### Task 3: `POST /api/announcements` — create endpoint (backend, admin-only)

**Files:**
- Create: `api/src/functions/announcements/create.ts`
- Test: `api/test/functions/announcements/create.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks beyond the `Announcement`/`Comment` models (Task 1).
- Produces: the exported `createAnnouncement` Azure Functions handler, registered at `POST /api/announcements`, accepting `{ title: string; body: string }` and returning `{ announcement: { id, title, body, author: { id, displayName }, createdAt, comments: [] } }` on success (`201`). Task 8 calls this route.

- [ ] **Step 1: Write the failing test — `api/test/functions/announcements/create.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- announcements/create
```
Expected: FAIL — `api/src/functions/announcements/create.ts` doesn't exist yet.

- [ ] **Step 3: Write `api/src/functions/announcements/create.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

type CreateAnnouncementBody = {
  title?: unknown;
  body?: unknown;
};

export async function createAnnouncement(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const claims = await requireAuth(request, "admin");

    let body: CreateAnnouncementBody;
    try {
      body = (await request.json()) as CreateAnnouncementBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    if (typeof body.title !== "string" || !body.title.trim()) {
      return { status: 400, jsonBody: { error: "title must be a non-empty string" } };
    }
    if (typeof body.body !== "string" || !body.body.trim()) {
      return { status: 400, jsonBody: { error: "body must be a non-empty string" } };
    }

    const announcement = await prisma.announcement.create({
      data: { title: body.title.trim(), body: body.body.trim(), authorId: claims.userId },
      include: { author: true },
    });

    return {
      status: 201,
      jsonBody: {
        announcement: {
          id: announcement.id,
          title: announcement.title,
          body: announcement.body,
          author: { id: announcement.author.id, displayName: announcement.author.displayName },
          createdAt: announcement.createdAt,
          comments: [],
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/announcements failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("announcementsCreate", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "announcements",
  handler: createAnnouncement,
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- announcements/create
```
Expected: PASS.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/functions/announcements/create.ts test/functions/announcements/create.test.ts
git commit -m "Add POST /api/announcements create endpoint"
```

---

### Task 4: `PATCH /api/announcements/{id}` — update endpoint (backend, admin-only)

**Files:**
- Create: `api/src/functions/announcements/update.ts`
- Test: `api/test/functions/announcements/update.test.ts`

**Interfaces:**
- Produces: the exported `updateAnnouncement` Azure Functions handler, registered at `PATCH /api/announcements/{id}`, accepting `{ title?: string; body?: string }` and returning `{ announcement: { id, title, body, author: { id, displayName }, createdAt, comments: [...] } }` on success (`200`), same shape as `GET`/`POST`. Task 8 calls this route.

- [ ] **Step 1: Write the failing test — `api/test/functions/announcements/update.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- announcements/update
```
Expected: FAIL — `api/src/functions/announcements/update.ts` doesn't exist yet.

- [ ] **Step 3: Write `api/src/functions/announcements/update.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

type UpdateAnnouncementBody = {
  title?: unknown;
  body?: unknown;
};

export async function updateAnnouncement(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    const announcementId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(announcementId)) {
      return { status: 400, jsonBody: { error: "Invalid announcement id" } };
    }

    let body: UpdateAnnouncementBody;
    try {
      body = (await request.json()) as UpdateAnnouncementBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    const existing = await prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Announcement not found" } };
    }

    const data: { title?: string; body?: string } = {};

    if (body.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim()) {
        return { status: 400, jsonBody: { error: "title must be a non-empty string" } };
      }
      data.title = body.title.trim();
    }

    if (body.body !== undefined) {
      if (typeof body.body !== "string" || !body.body.trim()) {
        return { status: 400, jsonBody: { error: "body must be a non-empty string" } };
      }
      data.body = body.body.trim();
    }

    const announcement = await prisma.announcement.update({
      where: { id: announcementId },
      data,
      include: { author: true, comments: { include: { author: true }, orderBy: { createdAt: "asc" } } },
    });

    return {
      status: 200,
      jsonBody: {
        announcement: {
          id: announcement.id,
          title: announcement.title,
          body: announcement.body,
          author: { id: announcement.author.id, displayName: announcement.author.displayName },
          createdAt: announcement.createdAt,
          comments: announcement.comments.map((c) => ({
            id: c.id,
            body: c.body,
            author: { id: c.author.id, displayName: c.author.displayName },
            createdAt: c.createdAt,
          })),
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`PATCH /api/announcements/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("announcementsUpdate", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "announcements/{id}",
  handler: updateAnnouncement,
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- announcements/update
```
Expected: PASS.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/functions/announcements/update.ts test/functions/announcements/update.test.ts
git commit -m "Add PATCH /api/announcements/{id} update endpoint"
```

---

### Task 5: `DELETE /api/announcements/{id}` — delete endpoint (backend, admin-only, transactional)

**Files:**
- Create: `api/src/functions/announcements/delete.ts`
- Test: `api/test/functions/announcements/delete.test.ts`

**Interfaces:**
- Produces: the exported `deleteAnnouncement` Azure Functions handler, registered at `DELETE /api/announcements/{id}`, returning `{ success: true }` on success (`200`). Task 8 calls this route.

- [ ] **Step 1: Write the failing test — `api/test/functions/announcements/delete.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- announcements/delete
```
Expected: FAIL — `api/src/functions/announcements/delete.ts` doesn't exist yet.

- [ ] **Step 3: Write `api/src/functions/announcements/delete.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

export async function deleteAnnouncement(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    const announcementId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(announcementId)) {
      return { status: 400, jsonBody: { error: "Invalid announcement id" } };
    }

    const existing = await prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Announcement not found" } };
    }

    await prisma.$transaction(async (tx) => {
      await tx.comment.deleteMany({ where: { announcementId } });
      await tx.announcement.delete({ where: { id: announcementId } });
    });

    return { status: 200, jsonBody: { success: true } };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`DELETE /api/announcements/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("announcementsDelete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "announcements/{id}",
  handler: deleteAnnouncement,
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- announcements/delete
```
Expected: PASS.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/functions/announcements/delete.ts test/functions/announcements/delete.test.ts
git commit -m "Add DELETE /api/announcements/{id} delete endpoint"
```

---

### Task 6: `POST /api/announcements/{id}/comments` — add-comment endpoint (backend)

**Files:**
- Create: `api/src/functions/announcements/addComment.ts`
- Test: `api/test/functions/announcements/addComment.test.ts`

**Interfaces:**
- Produces: the exported `addComment` Azure Functions handler, registered at `POST /api/announcements/{id}/comments`, accepting `{ body: string }` and returning `{ comment: { id, body, author: { id, displayName }, createdAt } }` on success (`201`). Task 8 calls this route.

- [ ] **Step 1: Write the failing test — `api/test/functions/announcements/addComment.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- announcements/addComment
```
Expected: FAIL — `api/src/functions/announcements/addComment.ts` doesn't exist yet.

- [ ] **Step 3: Write `api/src/functions/announcements/addComment.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

const MAX_COMMENT_LENGTH = 500;

type AddCommentBody = {
  body?: unknown;
};

export async function addComment(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const claims = await requireAuth(request);

    const announcementId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(announcementId)) {
      return { status: 400, jsonBody: { error: "Invalid announcement id" } };
    }

    let body: AddCommentBody;
    try {
      body = (await request.json()) as AddCommentBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    if (typeof body.body !== "string" || !body.body.trim()) {
      return { status: 400, jsonBody: { error: "body must be a non-empty string" } };
    }
    const trimmedBody = body.body.trim();
    if (trimmedBody.length > MAX_COMMENT_LENGTH) {
      return { status: 400, jsonBody: { error: `body must be ${MAX_COMMENT_LENGTH} characters or fewer` } };
    }

    const announcement = await prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!announcement) {
      return { status: 404, jsonBody: { error: "Announcement not found" } };
    }

    const comment = await prisma.comment.create({
      data: { announcementId, authorId: claims.userId, body: trimmedBody },
      include: { author: true },
    });

    return {
      status: 201,
      jsonBody: {
        comment: {
          id: comment.id,
          body: comment.body,
          author: { id: comment.author.id, displayName: comment.author.displayName },
          createdAt: comment.createdAt,
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/announcements/{id}/comments failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("announcementsAddComment", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "announcements/{id}/comments",
  handler: addComment,
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- announcements/addComment
```
Expected: PASS.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/functions/announcements/addComment.ts test/functions/announcements/addComment.test.ts
git commit -m "Add POST /api/announcements/{id}/comments endpoint"
```

---

### Task 7: `DELETE /api/comments/{id}` — delete-comment endpoint (backend, admin-or-owner)

**Files:**
- Create: `api/src/functions/comments/delete.ts`
- Test: `api/test/functions/comments/delete.test.ts`

**Interfaces:**
- Produces: the exported `deleteComment` Azure Functions handler, registered at `DELETE /api/comments/{id}`, returning `{ success: true }` on success (`200`). Task 8 calls this route.

- [ ] **Step 1: Write the failing test — `api/test/functions/comments/delete.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- comments/delete
```
Expected: FAIL — `api/src/functions/comments/delete.ts` doesn't exist yet.

- [ ] **Step 3: Write `api/src/functions/comments/delete.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

export async function deleteComment(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const claims = await requireAuth(request);

    const commentId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(commentId)) {
      return { status: 400, jsonBody: { error: "Invalid comment id" } };
    }

    const existing = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Comment not found" } };
    }

    if (claims.role !== "admin" && claims.userId !== existing.authorId) {
      return { status: 403, jsonBody: { error: "Insufficient permissions" } };
    }

    await prisma.comment.delete({ where: { id: commentId } });

    return { status: 200, jsonBody: { success: true } };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`DELETE /api/comments/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("commentsDelete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "comments/{id}",
  handler: deleteComment,
});
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- comments/delete
```
Expected: PASS.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/functions/comments/delete.ts test/functions/comments/delete.test.ts
git commit -m "Add DELETE /api/comments/{id} endpoint"
```

---

### Task 8: Frontend `api-client` additions

**Files:**
- Modify: `src/lib/api-client.ts`
- Modify: `src/lib/api-client.test.ts`

**Interfaces:**
- Consumes: the six endpoint response shapes from Tasks 2–7.
- Produces: types `AuthorSummary` (`{ id: number; displayName: string }`), `AnnouncementComment` (`{ id: number; body: string; author: AuthorSummary; createdAt: string }`), `Announcement` (`{ id: number; title: string; body: string; author: AuthorSummary; createdAt: string; comments: AnnouncementComment[] }`), `CreateAnnouncementInput` (`{ title: string; body: string }`), `UpdateAnnouncementInput` (`{ title?: string; body?: string }`), `AddCommentInput` (`{ body: string }`); functions `getAnnouncements(): Promise<Announcement[]>`, `createAnnouncement(input: CreateAnnouncementInput): Promise<Announcement>`, `updateAnnouncement(id: number, input: UpdateAnnouncementInput): Promise<Announcement>`, `deleteAnnouncement(id: number): Promise<void>`, `addComment(announcementId: number, input: AddCommentInput): Promise<AnnouncementComment>`, `deleteComment(id: number): Promise<void>` — all named exports from `src/lib/api-client.ts`. Tasks 9, 10, and 11 import these.

- [ ] **Step 1: Add failing tests to `src/lib/api-client.test.ts`**

Add the six new function names to the existing import list at the top of the file:

```typescript
import {
  login,
  logout,
  fetchCurrentUser,
  listMembers,
  createMember,
  updateMember,
  listSeasons,
  getSeason,
  getSeasonStats,
  createSeason,
  archiveSeason,
  updateMatch,
  addMatch,
  deleteMatch,
  submitMatchResult,
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  addComment,
  deleteComment,
} from "./api-client";
```

Append new `describe` blocks at the end of the outermost `describe("api-client", ...)` block, immediately before its closing `});`:

```typescript
  describe("getAnnouncements", () => {
    it("fetches and returns the announcement list", async () => {
      const announcements = [
        {
          id: 1,
          title: "Season kickoff",
          body: "Welcome back!",
          author: { id: 1, displayName: "Administrator" },
          createdAt: "2026-07-25T10:00:00.000Z",
          comments: [],
        },
      ];
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ announcements }), { status: 200 }));

      const result = await getAnnouncements();

      expect(fetch).toHaveBeenCalledWith(
        "/api/announcements",
        expect.objectContaining({ credentials: "same-origin" })
      );
      expect(result).toEqual(announcements);
    });
  });

  describe("createAnnouncement", () => {
    it("posts the new announcement and returns it", async () => {
      const announcement = {
        id: 1,
        title: "Season kickoff",
        body: "Welcome back!",
        author: { id: 1, displayName: "Administrator" },
        createdAt: "2026-07-25T10:00:00.000Z",
        comments: [],
      };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ announcement }), { status: 201 }));

      const input = { title: "Season kickoff", body: "Welcome back!" };
      const result = await createAnnouncement(input);

      expect(fetch).toHaveBeenCalledWith(
        "/api/announcements",
        expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify(input) })
      );
      expect(result).toEqual(announcement);
    });
  });

  describe("updateAnnouncement", () => {
    it("patches the announcement and returns it", async () => {
      const announcement = {
        id: 1,
        title: "Season kickoff (updated)",
        body: "Welcome back!",
        author: { id: 1, displayName: "Administrator" },
        createdAt: "2026-07-25T10:00:00.000Z",
        comments: [],
      };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ announcement }), { status: 200 }));

      const input = { title: "Season kickoff (updated)" };
      const result = await updateAnnouncement(1, input);

      expect(fetch).toHaveBeenCalledWith(
        "/api/announcements/1",
        expect.objectContaining({ method: "PATCH", credentials: "same-origin", body: JSON.stringify(input) })
      );
      expect(result).toEqual(announcement);
    });
  });

  describe("deleteAnnouncement", () => {
    it("sends a DELETE request for the announcement", async () => {
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

      await deleteAnnouncement(1);

      expect(fetch).toHaveBeenCalledWith(
        "/api/announcements/1",
        expect.objectContaining({ method: "DELETE", credentials: "same-origin" })
      );
    });
  });

  describe("addComment", () => {
    it("posts the new comment and returns it", async () => {
      const comment = {
        id: 10,
        body: "Nice!",
        author: { id: 2, displayName: "Bob Smith" },
        createdAt: "2026-07-25T11:00:00.000Z",
      };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ comment }), { status: 201 }));

      const input = { body: "Nice!" };
      const result = await addComment(1, input);

      expect(fetch).toHaveBeenCalledWith(
        "/api/announcements/1/comments",
        expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify(input) })
      );
      expect(result).toEqual(comment);
    });
  });

  describe("deleteComment", () => {
    it("sends a DELETE request for the comment", async () => {
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

      await deleteComment(10);

      expect(fetch).toHaveBeenCalledWith(
        "/api/comments/10",
        expect.objectContaining({ method: "DELETE", credentials: "same-origin" })
      );
    });
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
npm test
```
Expected: FAIL — the six new functions are not exported from `src/lib/api-client.ts`.

- [ ] **Step 3: Append to `src/lib/api-client.ts`**

At the end of the file, add:

```typescript
export type AuthorSummary = {
  id: number;
  displayName: string;
};

export type AnnouncementComment = {
  id: number;
  body: string;
  author: AuthorSummary;
  createdAt: string;
};

export type Announcement = {
  id: number;
  title: string;
  body: string;
  author: AuthorSummary;
  createdAt: string;
  comments: AnnouncementComment[];
};

export type CreateAnnouncementInput = {
  title: string;
  body: string;
};

export type UpdateAnnouncementInput = {
  title?: string;
  body?: string;
};

export type AddCommentInput = {
  body: string;
};

export async function getAnnouncements(): Promise<Announcement[]> {
  const response = await fetch("/api/announcements", { credentials: "same-origin" });
  const data = await parseJsonResponse<{ announcements: Announcement[] }>(response);
  return data.announcements;
}

export async function createAnnouncement(input: CreateAnnouncementInput): Promise<Announcement> {
  const response = await fetch("/api/announcements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ announcement: Announcement }>(response);
  return data.announcement;
}

export async function updateAnnouncement(id: number, input: UpdateAnnouncementInput): Promise<Announcement> {
  const response = await fetch(`/api/announcements/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ announcement: Announcement }>(response);
  return data.announcement;
}

export async function deleteAnnouncement(id: number): Promise<void> {
  const response = await fetch(`/api/announcements/${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  await parseJsonResponse<{ success: boolean }>(response);
}

export async function addComment(announcementId: number, input: AddCommentInput): Promise<AnnouncementComment> {
  const response = await fetch(`/api/announcements/${announcementId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ comment: AnnouncementComment }>(response);
  return data.comment;
}

export async function deleteComment(id: number): Promise<void> {
  const response = await fetch(`/api/comments/${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  await parseJsonResponse<{ success: boolean }>(response);
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
npm test
```
Expected: PASS — the whole suite passes, including the six new describe blocks.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc -b && vite build` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api-client.ts src/lib/api-client.test.ts
git commit -m "Add announcement and comment functions to the api-client"
```

---

### Task 9: `AnnouncementCard` component (frontend)

**Files:**
- Create: `src/pages/home/AnnouncementCard.tsx`
- Test: `src/pages/home/AnnouncementCard.test.tsx`

**Interfaces:**
- Consumes: `Announcement`, `UpdateAnnouncementInput` types from Task 8 (`src/lib/api-client.ts`).
- Produces: default export `AnnouncementCard`, props `{ announcement: Announcement; currentUserId: number; isAdmin: boolean; onUpdate: (id: number, input: UpdateAnnouncementInput) => Promise<void>; onDelete: (id: number) => Promise<void>; onAddComment: (announcementId: number, body: string) => Promise<void>; onDeleteComment: (commentId: number) => Promise<void> }`. Task 10 (`AnnouncementFeed`) renders one of these per announcement and supplies all six props.

- [ ] **Step 1: Write the failing test — `src/pages/home/AnnouncementCard.test.tsx`**

```typescript
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import AnnouncementCard from "./AnnouncementCard";
import type { Announcement } from "../../lib/api-client";

const announcement: Announcement = {
  id: 1,
  title: "Season kickoff",
  body: "Welcome back everyone!",
  author: { id: 1, displayName: "Administrator" },
  createdAt: "2026-07-25T10:00:00.000Z",
  comments: [
    {
      id: 10,
      body: "Looking forward to it!",
      author: { id: 2, displayName: "Bob Smith" },
      createdAt: "2026-07-25T11:00:00.000Z",
    },
  ],
};

function renderCard(overrides: Partial<Parameters<typeof AnnouncementCard>[0]> = {}) {
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const onDelete = vi.fn().mockResolvedValue(undefined);
  const onAddComment = vi.fn().mockResolvedValue(undefined);
  const onDeleteComment = vi.fn().mockResolvedValue(undefined);
  render(
    <AnnouncementCard
      announcement={announcement}
      currentUserId={2}
      isAdmin={false}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onAddComment={onAddComment}
      onDeleteComment={onDeleteComment}
      {...overrides}
    />
  );
  return { onUpdate, onDelete, onAddComment, onDeleteComment };
}

describe("AnnouncementCard", () => {
  it("renders the title, body, and author byline", () => {
    renderCard();
    expect(screen.getByText("Season kickoff")).toBeInTheDocument();
    expect(screen.getByText("Welcome back everyone!")).toBeInTheDocument();
    expect(screen.getByText(/Administrator/)).toBeInTheDocument();
  });

  it("shows Edit and Delete for an admin", () => {
    renderCard({ isAdmin: true });
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("hides Edit and Delete for a non-admin", () => {
    renderCard({ isAdmin: false });
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("toggles into an inline edit form and saves changes", async () => {
    const { onUpdate } = renderCard({ isAdmin: true });

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const titleInput = screen.getByLabelText("Edit title");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Season kickoff (updated)");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(1, {
        title: "Season kickoff (updated)",
        body: "Welcome back everyone!",
      });
    });
  });

  it("discards changes when Cancel is clicked", async () => {
    const { onUpdate } = renderCard({ isAdmin: true });

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("Season kickoff")).toBeInTheDocument();
  });

  it("calls onDelete when Delete is clicked", async () => {
    const { onDelete } = renderCard({ isAdmin: true });

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(1));
  });

  it("hides comments until Reply is clicked, then shows them", async () => {
    renderCard();
    expect(screen.queryByText("Looking forward to it!")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    expect(screen.getByText("Looking forward to it!")).toBeInTheDocument();
    expect(screen.getByText(/Bob Smith/)).toBeInTheDocument();
  });

  it("shows a comment Delete button for the comment's own author", async () => {
    renderCard({ currentUserId: 2, isAdmin: false });
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    const comment = screen.getByText("Looking forward to it!").closest("div")!;
    expect(within(comment).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("shows a comment Delete button for admin even when not the author", async () => {
    renderCard({ currentUserId: 99, isAdmin: true });
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    const comment = screen.getByText("Looking forward to it!").closest("div")!;
    expect(within(comment).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("hides the comment Delete button for a different non-admin member", async () => {
    renderCard({ currentUserId: 99, isAdmin: false });
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    const comment = screen.getByText("Looking forward to it!").closest("div")!;
    expect(within(comment).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("calls onDeleteComment when the comment's Delete button is clicked", async () => {
    const { onDeleteComment } = renderCard({ currentUserId: 2, isAdmin: false });
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    const comment = screen.getByText("Looking forward to it!").closest("div")!;
    await userEvent.click(within(comment).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDeleteComment).toHaveBeenCalledWith(10));
  });

  it("posts a new comment and clears the textarea", async () => {
    const { onAddComment } = renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    const textarea = screen.getByLabelText("Comment on Season kickoff");
    await userEvent.type(textarea, "Great news!");
    await userEvent.click(screen.getByRole("button", { name: "Post Comment" }));

    await waitFor(() => expect(onAddComment).toHaveBeenCalledWith(1, "Great news!"));
    await waitFor(() => expect(textarea).toHaveValue(""));
  });

  it("disables Post Comment when the textarea is empty", async () => {
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Reply" }));

    expect(screen.getByRole("button", { name: "Post Comment" })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- AnnouncementCard
```
Expected: FAIL — `src/pages/home/AnnouncementCard.tsx` doesn't exist yet.

- [ ] **Step 3: Write `src/pages/home/AnnouncementCard.tsx`**

```typescript
import { useState } from "react";
import type { Announcement, UpdateAnnouncementInput } from "../../lib/api-client";

type AnnouncementCardProps = {
  announcement: Announcement;
  currentUserId: number;
  isAdmin: boolean;
  onUpdate: (id: number, input: UpdateAnnouncementInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onAddComment: (announcementId: number, body: string) => Promise<void>;
  onDeleteComment: (commentId: number) => Promise<void>;
};

const MAX_COMMENT_LENGTH = 500;

export default function AnnouncementCard({
  announcement,
  currentUserId,
  isAdmin,
  onUpdate,
  onDelete,
  onAddComment,
  onDeleteComment,
}: AnnouncementCardProps) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(announcement.title);
  const [editBody, setEditBody] = useState(announcement.body);
  const [replyOpen, setReplyOpen] = useState(false);
  const [commentText, setCommentText] = useState("");

  function startEditing() {
    setEditTitle(announcement.title);
    setEditBody(announcement.body);
    setEditing(true);
  }

  async function handleSave() {
    if (!editTitle.trim() || !editBody.trim()) return;
    await onUpdate(announcement.id, { title: editTitle, body: editBody });
    setEditing(false);
  }

  async function handlePostComment() {
    if (!commentText.trim()) return;
    await onAddComment(announcement.id, commentText);
    setCommentText("");
  }

  return (
    <article className="mb-4 rounded border border-gray-300 p-3">
      {editing ? (
        <div className="flex flex-col gap-2">
          <input
            aria-label="Edit title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="rounded border border-gray-300 p-1"
          />
          <textarea
            aria-label="Edit body"
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            className="rounded border border-gray-300 p-1"
          />
          <div className="flex gap-2">
            <button onClick={() => void handleSave()} className="text-primary underline">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="text-primary underline">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <h2 className="font-heading text-lg font-semibold">{announcement.title}</h2>
          <p className="whitespace-pre-wrap">{announcement.body}</p>
          <p className="text-sm text-gray-500">
            {announcement.author.displayName} · {new Date(announcement.createdAt).toLocaleString()}
          </p>
          {isAdmin && (
            <div className="mt-2 flex gap-2">
              <button onClick={startEditing} className="text-primary underline">
                Edit
              </button>
              <button onClick={() => void onDelete(announcement.id)} className="text-primary underline">
                Delete
              </button>
            </div>
          )}
        </>
      )}

      <button onClick={() => setReplyOpen((v) => !v)} className="text-primary mt-2 underline">
        Reply
      </button>

      {replyOpen && (
        <div className="mt-2 flex flex-col gap-2">
          {announcement.comments.map((comment) => (
            <div key={comment.id} className="border-t border-gray-200 pt-2 text-sm">
              <p>{comment.body}</p>
              <p className="text-gray-500">
                {comment.author.displayName} · {new Date(comment.createdAt).toLocaleString()}
                {(isAdmin || comment.author.id === currentUserId) && (
                  <button onClick={() => void onDeleteComment(comment.id)} className="text-primary ml-2 underline">
                    Delete
                  </button>
                )}
              </p>
            </div>
          ))}
          <textarea
            aria-label={`Comment on ${announcement.title}`}
            value={commentText}
            maxLength={MAX_COMMENT_LENGTH}
            onChange={(e) => setCommentText(e.target.value)}
            className="rounded border border-gray-300 p-1"
          />
          <p className="text-xs text-gray-500">{MAX_COMMENT_LENGTH - commentText.length} characters remaining</p>
          <button
            onClick={() => void handlePostComment()}
            disabled={!commentText.trim()}
            className="text-primary self-start underline disabled:text-gray-400 disabled:no-underline"
          >
            Post Comment
          </button>
        </div>
      )}
    </article>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- AnnouncementCard
```
Expected: PASS — all tests pass.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc -b && vite build` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/home/AnnouncementCard.tsx src/pages/home/AnnouncementCard.test.tsx
git commit -m "Add AnnouncementCard component"
```

---

### Task 10: `AnnouncementFeed` component (frontend)

**Files:**
- Create: `src/pages/home/AnnouncementFeed.tsx`
- Test: `src/pages/home/AnnouncementFeed.test.tsx`

**Interfaces:**
- Consumes: `getAnnouncements`, `createAnnouncement`, `updateAnnouncement`, `deleteAnnouncement`, `addComment`, `deleteComment` from Task 8; `AnnouncementCard` from Task 9; `useAuth` from `src/lib/AuthContext.tsx`.
- Produces: default export `AnnouncementFeed` (no props — reads `useAuth()` itself). Task 11 (`Home.tsx`) renders `<AnnouncementFeed />`.

- [ ] **Step 1: Write the failing test — `src/pages/home/AnnouncementFeed.test.tsx`**

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AnnouncementFeed from "./AnnouncementFeed";
import * as apiClient from "../../lib/api-client";
import { useAuth } from "../../lib/AuthContext";

vi.mock("../../lib/api-client");
vi.mock("../../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const announcement: apiClient.Announcement = {
  id: 1,
  title: "Season kickoff",
  body: "Welcome back everyone!",
  author: { id: 1, displayName: "Administrator" },
  createdAt: "2026-07-25T10:00:00.000Z",
  comments: [],
};

function mockAdmin() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function mockPlayer() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

describe("AnnouncementFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state when there are no announcements", async () => {
    mockPlayer();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([]);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByText("No announcements yet")).toBeInTheDocument());
  });

  it("renders announcements returned by the API", async () => {
    mockPlayer();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([announcement]);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByText("Season kickoff")).toBeInTheDocument());
  });

  it("shows a Post Announcement form for an admin", async () => {
    mockAdmin();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([]);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Post Announcement" })).toBeInTheDocument());
  });

  it("hides the Post Announcement form for a non-admin", async () => {
    mockPlayer();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([]);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByText("No announcements yet")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Post Announcement" })).not.toBeInTheDocument();
  });

  it("posts a new announcement with the form and reloads", async () => {
    mockAdmin();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([]);
    vi.mocked(apiClient.createAnnouncement).mockResolvedValue(announcement);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Post Announcement" })).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("New announcement title"), "Season kickoff");
    await userEvent.type(screen.getByLabelText("New announcement body"), "Welcome back everyone!");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => {
      expect(apiClient.createAnnouncement).toHaveBeenCalledWith({
        title: "Season kickoff",
        body: "Welcome back everyone!",
      });
    });
    expect(apiClient.getAnnouncements).toHaveBeenCalledTimes(2);
  });

  it("shows an error message when loading fails", async () => {
    mockPlayer();
    vi.mocked(apiClient.getAnnouncements).mockRejectedValue(new Error("Network error"));
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Network error"));
  });

  it("shows an error message when deleting an announcement fails", async () => {
    mockAdmin();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([announcement]);
    vi.mocked(apiClient.deleteAnnouncement).mockRejectedValue(new Error("Delete failed"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByText("Season kickoff")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Delete failed"));
  });

  it("deletes an announcement after confirmation and reloads", async () => {
    mockAdmin();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([announcement]);
    vi.mocked(apiClient.deleteAnnouncement).mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByText("Season kickoff")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(apiClient.deleteAnnouncement).toHaveBeenCalledWith(1));
    expect(apiClient.getAnnouncements).toHaveBeenCalledTimes(2);
  });

  it("does not delete when the confirmation is cancelled", async () => {
    mockAdmin();
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([announcement]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AnnouncementFeed />);
    await waitFor(() => expect(screen.getByText("Season kickoff")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(apiClient.deleteAnnouncement).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- AnnouncementFeed
```
Expected: FAIL — `src/pages/home/AnnouncementFeed.tsx` doesn't exist yet.

- [ ] **Step 3: Write `src/pages/home/AnnouncementFeed.tsx`**

```typescript
import { useEffect, useState } from "react";
import { useAuth } from "../../lib/AuthContext";
import {
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  addComment,
  deleteComment,
  type Announcement,
  type UpdateAnnouncementInput,
} from "../../lib/api-client";
import AnnouncementCard from "./AnnouncementCard";

export default function AnnouncementFeed() {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setAnnouncements(await getAnnouncements());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load announcements");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function withErrorHandling(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  async function handlePost() {
    if (!newTitle.trim() || !newBody.trim()) return;
    await withErrorHandling(async () => {
      await createAnnouncement({ title: newTitle, body: newBody });
      setNewTitle("");
      setNewBody("");
    });
  }

  async function handleUpdate(id: number, input: UpdateAnnouncementInput) {
    await withErrorHandling(() => updateAnnouncement(id, input));
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this announcement? This cannot be undone.")) return;
    await withErrorHandling(() => deleteAnnouncement(id));
  }

  async function handleAddComment(announcementId: number, body: string) {
    await withErrorHandling(() => addComment(announcementId, { body }));
  }

  async function handleDeleteComment(commentId: number) {
    if (!window.confirm("Delete this comment? This cannot be undone.")) return;
    await withErrorHandling(() => deleteComment(commentId));
  }

  if (!user) {
    return null;
  }

  if (loading) {
    return <p className="p-4">Loading…</p>;
  }

  return (
    <div className="p-4">
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}
      {user.role === "admin" && (
        <div className="mb-4 rounded border border-gray-300 p-3">
          <h2 className="font-heading mb-2 font-semibold">Post Announcement</h2>
          <div className="flex flex-col gap-2">
            <input
              aria-label="New announcement title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="rounded border border-gray-300 p-1"
            />
            <textarea
              aria-label="New announcement body"
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              className="rounded border border-gray-300 p-1"
            />
            <button onClick={() => void handlePost()} className="text-primary self-start underline">
              Post
            </button>
          </div>
        </div>
      )}
      {announcements.length === 0 ? (
        <p>No announcements yet</p>
      ) : (
        announcements.map((announcement) => (
          <AnnouncementCard
            key={announcement.id}
            announcement={announcement}
            currentUserId={user.id}
            isAdmin={user.role === "admin"}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onAddComment={handleAddComment}
            onDeleteComment={handleDeleteComment}
          />
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- AnnouncementFeed
```
Expected: PASS — all tests pass.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc -b && vite build` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/home/AnnouncementFeed.tsx src/pages/home/AnnouncementFeed.test.tsx
git commit -m "Add AnnouncementFeed component"
```

---

### Task 11: Wire `AnnouncementFeed` into `Home.tsx`

**Files:**
- Modify: `src/pages/Home.tsx`
- Modify: `src/pages/Home.test.tsx`

**Interfaces:**
- Consumes: `AnnouncementFeed` from Task 10.
- Produces: `Home` renders the existing header unchanged, plus `<AnnouncementFeed />` below it when `user` is truthy. No route changes — `/` already renders `Home` in `src/App.tsx`.

- [ ] **Step 1: Update `src/pages/Home.test.tsx`**

Replace the entire file with:

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Home from "./Home";
import { branding } from "../branding";
import { useAuth } from "../lib/AuthContext";
import * as apiClient from "../lib/api-client";

vi.mock("../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));
vi.mock("../lib/api-client");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.getAnnouncements).mockResolvedValue([]);
});

describe("Home", () => {
  it("renders the branded app name using the theme's primary color and heading font", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    const heading = screen.getByRole("heading", { name: branding.appName });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass("text-primary");
    expect(heading).toHaveClass("font-heading");
  });

  it("renders the branded logo", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    const logo = screen.getByRole("img", { name: branding.appName });
    expect(logo).toHaveAttribute("src", branding.logoSrc);
  });

  it("shows the logged-in user's display name and a logout button", async () => {
    const logoutMock = vi.fn();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: logoutMock,
    });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    await waitFor(() => expect(apiClient.getAnnouncements).toHaveBeenCalled());
  });
});

describe("Home navigation", () => {
  it("shows a Manage Members link for an admin", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Manage Members" })).toHaveAttribute("href", "/admin/members");
    await waitFor(() => expect(apiClient.getAnnouncements).toHaveBeenCalled());
  });

  it("does not show a Manage Members link for a player", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: "Manage Members" })).not.toBeInTheDocument();
    await waitFor(() => expect(apiClient.getAnnouncements).toHaveBeenCalled());
  });

  it("shows a Season link for every logged-in user, admin or player", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Season" })).toHaveAttribute("href", "/season");
    await waitFor(() => expect(apiClient.getAnnouncements).toHaveBeenCalled());
  });
});

describe("Home announcement feed", () => {
  it("renders the announcement feed below the header for a logged-in user", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("No announcements yet")).toBeInTheDocument());
  });

  it("does not render the announcement feed when logged out", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(apiClient.getAnnouncements).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- Home.test
```
Expected: FAIL — `Home` doesn't render `AnnouncementFeed` yet, so "No announcements yet" never appears.

- [ ] **Step 3: Update `src/pages/Home.tsx`**

```typescript
import { Link } from "react-router-dom";
import { branding } from "../branding";
import { useAuth } from "../lib/AuthContext";
import AnnouncementFeed from "./home/AnnouncementFeed";

export default function Home() {
  const { user, logout } = useAuth();

  return (
    <div>
      <div className="flex items-center gap-3 p-4">
        <img src={branding.logoSrc} alt={branding.appName} width={40} height={40} />
        <h1 className="text-primary font-heading text-3xl font-bold">{branding.appName}</h1>
        {user && (
          <div className="ml-auto flex items-center gap-3">
            <Link to="/season" className="text-primary underline">
              Season
            </Link>
            {user.role === "admin" && (
              <Link to="/admin/members" className="text-primary underline">
                Manage Members
              </Link>
            )}
            <span>{user.displayName}</span>
            <button onClick={() => void logout()} className="text-primary underline">
              Log out
            </button>
          </div>
        )}
      </div>
      {user && <AnnouncementFeed />}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- Home.test
```
Expected: PASS — all tests pass.

- [ ] **Step 5: Verify the whole project builds and the full suite passes**

```bash
npm run build
npm test
```
Expected: both succeed with no errors, in both the repo root and `api/` (run `npm run build && npm test` inside `api/` too).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Home.tsx src/pages/Home.test.tsx
git commit -m "Render the announcement feed on Home"
```

---

## Manual E2E Verification (after all tasks)

Once every task above is committed, do a manual pass in the browser (per the project's `run` skill) covering the golden path and edge cases:
1. Log in as admin, confirm the header is unchanged and the feed (with "Post Announcement" form) appears below it.
2. Post an announcement, confirm it appears newest-first at the top of the list.
3. Edit the announcement inline, confirm the change persists after reload.
4. Log in as a non-admin member, confirm no "Post Announcement" form and no Edit/Delete controls, but the announcement is visible.
5. Click "Reply", post a comment (test the 500-char limit is enforced by typing/pasting past it), confirm it appears under the announcement.
6. Confirm the commenter can delete their own comment but not others'; confirm admin can delete any comment.
7. Delete the announcement as admin, confirm its comments are gone too and it disappears from the list.
8. Log out, confirm the feed is entirely absent from `/`.
