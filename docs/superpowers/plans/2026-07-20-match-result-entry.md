# Match Result Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin or either match participant record a match's final result (legs won per player, optional highest checkout per player) via a dedicated page, with the same result overwritable by any authorized submitter at any time (last write wins), and a minimal audit trail of who last touched it.

**Architecture:** Backend: one new endpoint (`PATCH /api/matches/{id}/result`) with its own admin-or-participant authorization, separate from the existing admin-only schedule-management endpoint; the existing `GET /api/seasons/{id}` is extended to return the new result fields on every match. Frontend: a new `MatchResult` page reached from per-match links on the existing `Season` page (the link's visibility and the page's edit-vs-read-only rendering both key off the same admin-or-participant check), plus a small shared `formatMatchSummary` helper so the recorded score displays consistently on both the live and archived schedule views.

**Tech Stack:** No new dependencies. Same stack as prior phases (Prisma, `@azure/functions` v4, Vitest, React Testing Library, react-router-dom v7).

## Global Constraints

- Last-write-wins uniformly across channels: any authorized submitter (admin or either participant) can overwrite an existing result at any time — no locking, no confirmation step, no priority for admin entries over self-reports or vice versa.
- Legs must satisfy the fixed best-of-5 rule (not configurable): exactly one player's legs must equal `3`; the other's must be `0`, `1`, or `2`. Both `0`/`0`... `3`/`3` and anything where neither side is `3` is rejected.
- Checkouts are always optional (never required, even when a player won legs) and, if present, must be positive integers (`>= 1`). No further darts-legality range validation in this phase.
- `resultEnteredById` needs `onDelete: NoAction, onUpdate: NoAction` on its relation to `User`, per the SQL Server multi-cascade-path restriction already discovered for `Match.player1`/`player2` in the Season phase — this is now the third distinct FK from `Match` to `User`.
- `Match.status` widens to `"scheduled" | "cancelled" | "played"`. Submitting a result automatically sets `status: "played"`.
- A cancelled match cannot receive a result until an admin restores it to `"scheduled"` via the existing `PATCH /api/matches/{id}` endpoint first.
- `PATCH /api/matches/{id}/result` calls `requireAuth(request)` (any authenticated role), then an explicit check: caller must be `role === "admin"` OR `userId` equal to the match's `player1Id`/`player2Id`, else `403`. This is a different authorization model from the existing `PATCH /api/matches/{id}` (admin-only) — hence a separate endpoint, not an extension of it.
- Archived-season matches remain frozen for result submission too, reusing the same `season.status !== "active"` check already established for reschedule/cancel.
- `/season/matches/:id/result` is visible to every logged-in user (nested under `ProtectedRoute`, not `AdminRoute`) — read-only for a non-admin, non-participant viewer; editable for admin or either participant.
- No pagination anywhere.

---

### Task 1: Prisma schema — add match result fields

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: migration via `prisma migrate dev` (generates `api/prisma/migrations/<timestamp>_add_match_result_fields/migration.sql`)

**Interfaces:**
- Produces: six new fields on `Match` (`player1Legs`, `player2Legs`, `player1Checkout`, `player2Checkout`, `resultEnteredById`, `resultEnteredAt`), a new `resultEnteredBy` relation on `Match`, and a new `resultEnteredMatches` back-relation on `User`. Later backend tasks query/write these via `prisma.match`.

- [ ] **Step 1: Ensure the local dev database is running**

```bash
cd "D:/WEB/Dartstracker" && docker compose up -d
```
Expected: `dartstracker-sqlserver` container is `Up` (or already running).

- [ ] **Step 2: Replace `api/prisma/schema.prisma` with the following full content**

```prisma
datasource db {
  provider = "sqlserver"
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id           Int      @id @default(autoincrement())
  username     String   @unique
  passwordHash String
  role         String
  displayName  String
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())

  seasonParticipations SeasonParticipant[]
  player1Matches       Match[]             @relation("Player1Matches")
  player2Matches       Match[]             @relation("Player2Matches")
  resultEnteredMatches Match[]             @relation("MatchResultEnteredBy")
}

model Season {
  id        Int      @id @default(autoincrement())
  name      String
  roundType String
  status    String   @default("active")
  createdAt DateTime @default(now())

  participants SeasonParticipant[]
  matches      Match[]
}

model SeasonParticipant {
  id       Int @id @default(autoincrement())
  seasonId Int
  userId   Int

  season Season @relation(fields: [seasonId], references: [id])
  user   User   @relation(fields: [userId], references: [id])

  @@unique([seasonId, userId])
}

model Match {
  id          Int      @id @default(autoincrement())
  seasonId    Int
  roundNumber Int
  date        DateTime
  player1Id   Int
  player2Id   Int
  status      String   @default("scheduled")
  createdAt   DateTime @default(now())

  player1Legs       Int?
  player2Legs       Int?
  player1Checkout   Int?
  player2Checkout   Int?
  resultEnteredById Int?
  resultEnteredAt   DateTime?

  season          Season @relation(fields: [seasonId], references: [id])
  player1         User   @relation("Player1Matches", fields: [player1Id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  player2         User   @relation("Player2Matches", fields: [player2Id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  resultEnteredBy User?  @relation("MatchResultEnteredBy", fields: [resultEnteredById], references: [id], onDelete: NoAction, onUpdate: NoAction)
}
```

Note: `resultEnteredBy`'s `onDelete: NoAction, onUpdate: NoAction` is required up front this time — SQL Server rejects the implicit default (`Cascade`) because this is now a third distinct FK from `Match` back to `User` (alongside `player1Id`/`player2Id`), creating multiple cascade paths (Prisma error P1012). Without these two attributes, `prisma migrate dev` fails schema validation before touching the database — this was discovered the hard way in the Season phase's Task 1; don't rediscover it here.

- [ ] **Step 3: Generate and apply the migration**

```bash
cd "D:/WEB/Dartstracker/api" && npx prisma migrate dev --name add_match_result_fields
```
Expected: creates `prisma/migrations/<timestamp>_add_match_result_fields/migration.sql` with `ALTER TABLE` statements adding the six new nullable columns and the new FK constraint, applies it to the local database, and regenerates the Prisma client. No errors.

- [ ] **Step 4: Verify the client builds**

```bash
npm run build
```
Expected: `tsc` succeeds with no errors (confirms the regenerated Prisma client types are valid). This is the authoritative check — not `npm test` alone, since `vitest`'s esbuild transform doesn't type-check (this exact gap caused a mid-plan build break in the Season phase; don't repeat it).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add match result fields to the Match model"
```

---

### Task 2: `PATCH /api/matches/{id}/result` (submit a match result)

**Files:**
- Create: `api/src/functions/matches/result.ts`
- Test: `api/test/functions/matches/result.test.ts`

**Interfaces:**
- Consumes: `prisma` (`api/src/lib/prisma.ts`), `requireAuth`/`AuthError` (`api/src/lib/requireAuth.ts`).
- Produces: `submitMatchResult` — named export, registered on route `PATCH /api/matches/{id}/result`. Request body `{ player1Legs: number, player2Legs: number, player1Checkout?: number, player2Checkout?: number }`. `200` with `{ match: { id, roundNumber, date, status, player1Id, player2Id, player1Legs, player2Legs, player1Checkout, player2Checkout, resultEnteredBy: {id, displayName} | null, resultEnteredAt } }` on success; `400` for missing/invalid legs, an invalid best-of-5 combination, an invalid checkout, a cancelled match, or an archived season; `403` if the caller is neither admin nor a participant; `404` if the match doesn't exist; `401` via `requireAuth`.

- [ ] **Step 1: Write the failing test — `api/test/functions/matches/result.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { submitMatchResult } from "../../../src/functions/matches/result";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { match: { findUnique: vi.fn(), update: vi.fn() } },
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

const activeSeasonMatch = {
  id: 101,
  seasonId: 1,
  roundNumber: 1,
  date: new Date("2026-08-01"),
  player1Id: 1,
  player2Id: 2,
  status: "scheduled",
  createdAt: new Date(),
  player1Legs: null,
  player2Legs: null,
  player1Checkout: null,
  player2Checkout: null,
  resultEnteredById: null,
  resultEnteredAt: null,
  season: { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: new Date() },
};

const validBody = { player1Legs: 3, player2Legs: 1 };

describe("submitMatchResult function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await submitMatchResult(createRequest("101", validBody), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 400 when the id is invalid", async () => {
    const result = await submitMatchResult(createRequest("abc", validBody), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the match doesn't exist", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
    const result = await submitMatchResult(createRequest("999", validBody), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 403 when the caller is neither admin nor a participant", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 5, role: "player" });
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    const result = await submitMatchResult(createRequest("101", validBody), createContext());
    expect(result.status).toBe(403);
    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it("allows player1 (a non-admin participant) to submit", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "player" });
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    vi.mocked(prisma.match.update).mockResolvedValue({
      ...activeSeasonMatch,
      ...validBody,
      status: "played",
      resultEnteredBy: null,
    });
    const result = await submitMatchResult(createRequest("101", validBody), createContext());
    expect(result.status).toBe(200);
  });

  it("allows player2 (a non-admin participant) to submit", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 2, role: "player" });
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    vi.mocked(prisma.match.update).mockResolvedValue({
      ...activeSeasonMatch,
      ...validBody,
      status: "played",
      resultEnteredBy: null,
    });
    const result = await submitMatchResult(createRequest("101", validBody), createContext());
    expect(result.status).toBe(200);
  });

  it("returns 400 when the match's season is archived", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      ...activeSeasonMatch,
      season: { ...activeSeasonMatch.season, status: "archived" },
    });
    const result = await submitMatchResult(createRequest("101", validBody), createContext());
    expect(result.status).toBe(400);
    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it("returns 400 when the match is cancelled", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({ ...activeSeasonMatch, status: "cancelled" });
    const result = await submitMatchResult(createRequest("101", validBody), createContext());
    expect(result.status).toBe(400);
    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it("returns 400 when legs are missing", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    const result = await submitMatchResult(createRequest("101", { player1Legs: 3 }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when neither player has exactly 3 legs", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    const result = await submitMatchResult(
      createRequest("101", { player1Legs: 2, player2Legs: 2 }),
      createContext()
    );
    expect(result.status).toBe(400);
  });

  it("returns 400 when both players have 3 legs", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    const result = await submitMatchResult(
      createRequest("101", { player1Legs: 3, player2Legs: 3 }),
      createContext()
    );
    expect(result.status).toBe(400);
  });

  it("returns 400 when a checkout is not a positive integer", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    const result = await submitMatchResult(
      createRequest("101", { player1Legs: 3, player2Legs: 1, player1Checkout: 0 }),
      createContext()
    );
    expect(result.status).toBe(400);
  });

  it("returns 200 and records the result, setting status to played", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(activeSeasonMatch);
    vi.mocked(prisma.match.update).mockResolvedValue({
      ...activeSeasonMatch,
      player1Legs: 3,
      player2Legs: 1,
      player1Checkout: 82,
      player2Checkout: null,
      status: "played",
      resultEnteredById: 1,
      resultEnteredAt: new Date("2026-08-01T20:00:00.000Z"),
      resultEnteredBy: {
        id: 1,
        username: "admin",
        displayName: "Administrator",
        role: "admin",
        isActive: true,
        passwordHash: "h",
        createdAt: new Date(),
      },
    });

    const result = await submitMatchResult(
      createRequest("101", { player1Legs: 3, player2Legs: 1, player1Checkout: 82 }),
      createContext()
    );

    expect(result.status).toBe(200);
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: {
        player1Legs: 3,
        player2Legs: 1,
        player1Checkout: 82,
        player2Checkout: null,
        status: "played",
        resultEnteredById: 1,
        resultEnteredAt: expect.any(Date),
      },
      include: { resultEnteredBy: true },
    });
    const body = result.jsonBody as { match: { resultEnteredBy: { displayName: string } | null } };
    expect(body.match.resultEnteredBy).toEqual({ id: 1, displayName: "Administrator" });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/functions/matches/result.ts` does not exist.

- [ ] **Step 3: Create `api/src/functions/matches/result.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

type SubmitResultBody = {
  player1Legs?: unknown;
  player2Legs?: unknown;
  player1Checkout?: unknown;
  player2Checkout?: unknown;
};

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isValidBestOfFive(player1Legs: number, player2Legs: number): boolean {
  return (
    (player1Legs === 3 && player2Legs >= 0 && player2Legs <= 2) ||
    (player2Legs === 3 && player1Legs >= 0 && player1Legs <= 2)
  );
}

export async function submitMatchResult(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const claims = await requireAuth(request);

    const matchId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(matchId)) {
      return { status: 400, jsonBody: { error: "Invalid match id" } };
    }

    let body: SubmitResultBody;
    try {
      body = (await request.json()) as SubmitResultBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    const existing = await prisma.match.findUnique({ where: { id: matchId }, include: { season: true } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Match not found" } };
    }

    if (claims.role !== "admin" && claims.userId !== existing.player1Id && claims.userId !== existing.player2Id) {
      return { status: 403, jsonBody: { error: "Insufficient permissions" } };
    }

    if (existing.season.status !== "active") {
      return { status: 400, jsonBody: { error: "Cannot modify a match in an archived season" } };
    }
    if (existing.status === "cancelled") {
      return { status: 400, jsonBody: { error: "Cannot record a result for a cancelled match" } };
    }

    if (!isNonNegativeInt(body.player1Legs)) {
      return { status: 400, jsonBody: { error: "player1Legs and player2Legs are required" } };
    }
    if (!isNonNegativeInt(body.player2Legs)) {
      return { status: 400, jsonBody: { error: "player1Legs and player2Legs are required" } };
    }
    if (!isValidBestOfFive(body.player1Legs, body.player2Legs)) {
      return {
        status: 400,
        jsonBody: { error: "One player must win exactly 3 legs; the other must have 0-2 legs" },
      };
    }

    let player1Checkout: number | null = null;
    if (body.player1Checkout !== undefined) {
      if (!isNonNegativeInt(body.player1Checkout)) {
        return { status: 400, jsonBody: { error: "player1Checkout must be a positive integer" } };
      }
      if (body.player1Checkout < 1) {
        return { status: 400, jsonBody: { error: "player1Checkout must be a positive integer" } };
      }
      player1Checkout = body.player1Checkout;
    }

    let player2Checkout: number | null = null;
    if (body.player2Checkout !== undefined) {
      if (!isNonNegativeInt(body.player2Checkout)) {
        return { status: 400, jsonBody: { error: "player2Checkout must be a positive integer" } };
      }
      if (body.player2Checkout < 1) {
        return { status: 400, jsonBody: { error: "player2Checkout must be a positive integer" } };
      }
      player2Checkout = body.player2Checkout;
    }

    const match = await prisma.match.update({
      where: { id: matchId },
      data: {
        player1Legs: body.player1Legs,
        player2Legs: body.player2Legs,
        player1Checkout,
        player2Checkout,
        status: "played",
        resultEnteredById: claims.userId,
        resultEnteredAt: new Date(),
      },
      include: { resultEnteredBy: true },
    });

    return {
      status: 200,
      jsonBody: {
        match: {
          id: match.id,
          roundNumber: match.roundNumber,
          date: match.date,
          status: match.status,
          player1Id: match.player1Id,
          player2Id: match.player2Id,
          player1Legs: match.player1Legs,
          player2Legs: match.player2Legs,
          player1Checkout: match.player1Checkout,
          player2Checkout: match.player2Checkout,
          resultEnteredBy: match.resultEnteredBy
            ? { id: match.resultEnteredBy.id, displayName: match.resultEnteredBy.displayName }
            : null,
          resultEnteredAt: match.resultEnteredAt,
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`PATCH /api/matches/{id}/result failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("matchesSubmitResult", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "matches/{id}/result",
  handler: submitMatchResult,
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole suite passes, including 13 new tests in `result.test.ts`.

- [ ] **Step 5: Verify the build**

Run: `cd api && npm run build`
Expected: `tsc` succeeds with zero errors. Run this explicitly, not just `npm test` — this endpoint does non-trivial type narrowing on request-body validation, exactly the kind of code where `vitest` alone previously let a real `tsc` error slip through in the Season phase.

- [ ] **Step 6: Commit**

```bash
git add src/functions/matches/result.ts test/functions/matches/result.test.ts
git commit -m "Add PATCH /api/matches/{id}/result endpoint to submit a match result"
```

---

### Task 3: Extend `GET /api/seasons/{id}` with result fields

**Files:**
- Modify: `api/src/functions/seasons/get.ts`
- Modify: `api/test/functions/seasons/get.test.ts`

**Interfaces:**
- Produces: `getSeason`'s response `matches` array now includes `player1Legs`, `player2Legs`, `player1Checkout`, `player2Checkout`, `resultEnteredBy: {id, displayName} | null`, `resultEnteredAt` on every match, alongside the existing fields. Task 4's frontend `SeasonMatch` type and Task 6/7's pages consume this exact shape.

- [ ] **Step 1: Update the failing assertions — `api/test/functions/seasons/get.test.ts`**

Replace the file's one `it("returns 200 with participants and matches, resolving display names", ...)` test body with this updated version (same test name, updated mock and expectation):

```typescript
  it("returns 200 with participants and matches, resolving display names", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue({
      id: 1,
      name: "Spring 2026",
      roundType: "single",
      status: "active",
      createdAt: new Date(),
      participants: [
        { user: { id: 1, displayName: "Administrator" } },
        { user: { id: 2, displayName: "Bob Smith" } },
      ],
      matches: [
        {
          id: 101,
          roundNumber: 1,
          date: new Date("2026-08-01"),
          status: "played",
          player1: { id: 1, displayName: "Administrator" },
          player2: { id: 2, displayName: "Bob Smith" },
          player1Legs: 3,
          player2Legs: 1,
          player1Checkout: 82,
          player2Checkout: null,
          resultEnteredBy: { id: 1, displayName: "Administrator" },
          resultEnteredAt: new Date("2026-08-01T20:00:00.000Z"),
        },
      ],
    } as unknown as Awaited<ReturnType<typeof prisma.season.findUnique>>);

    const result = await getSeason(createRequest("1"), createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({
      season: {
        id: 1,
        name: "Spring 2026",
        roundType: "single",
        status: "active",
        participants: [
          { id: 1, displayName: "Administrator" },
          { id: 2, displayName: "Bob Smith" },
        ],
        matches: [
          {
            id: 101,
            roundNumber: 1,
            date: new Date("2026-08-01"),
            status: "played",
            player1: { id: 1, displayName: "Administrator" },
            player2: { id: 2, displayName: "Bob Smith" },
            player1Legs: 3,
            player2Legs: 1,
            player1Checkout: 82,
            player2Checkout: null,
            resultEnteredBy: { id: 1, displayName: "Administrator" },
            resultEnteredAt: new Date("2026-08-01T20:00:00.000Z"),
          },
        ],
      },
    });
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — the actual response doesn't include the new result fields yet.

- [ ] **Step 3: Update `api/src/functions/seasons/get.ts`**

Replace the `matches` include and mapping with:

```typescript
    const season = await prisma.season.findUnique({
      where: { id: seasonId },
      include: {
        participants: { include: { user: true } },
        matches: {
          include: { player1: true, player2: true, resultEnteredBy: true },
          orderBy: [{ roundNumber: "asc" }, { id: "asc" }],
        },
      },
    });
```

and:

```typescript
          matches: season.matches.map((m) => ({
            id: m.id,
            roundNumber: m.roundNumber,
            date: m.date,
            status: m.status,
            player1: { id: m.player1.id, displayName: m.player1.displayName },
            player2: { id: m.player2.id, displayName: m.player2.displayName },
            player1Legs: m.player1Legs,
            player2Legs: m.player2Legs,
            player1Checkout: m.player1Checkout,
            player2Checkout: m.player2Checkout,
            resultEnteredBy: m.resultEnteredBy
              ? { id: m.resultEnteredBy.id, displayName: m.resultEnteredBy.displayName }
              : null,
            resultEnteredAt: m.resultEnteredAt,
          })),
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole suite passes.

- [ ] **Step 5: Verify the build**

Run: `cd api && npm run build`
Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/functions/seasons/get.ts test/functions/seasons/get.test.ts
git commit -m "Extend GET /api/seasons/{id} to include match result fields"
```

---

### Task 4: Frontend API client — result types and `submitMatchResult`

**Files:**
- Modify: `src/lib/api-client.ts`
- Modify: `src/lib/api-client.test.ts`

**Interfaces:**
- Produces: `SeasonMatch` widened with `player1Legs: number | null`, `player2Legs: number | null`, `player1Checkout: number | null`, `player2Checkout: number | null`, `resultEnteredBy: SeasonParticipantSummary | null`, `resultEnteredAt: string | null`, and `status` widened to `"scheduled" | "cancelled" | "played"`. `MatchUpdateResult.status` also widens to the same three-value union (the existing reschedule/cancel endpoint can return an already-played match's row unchanged aside from date/status). New `SubmitMatchResultInput` type (`{ player1Legs: number; player2Legs: number; player1Checkout?: number; player2Checkout?: number }`) and `submitMatchResult(id: number, input: SubmitMatchResultInput): Promise<SeasonMatch>`. Tasks 5–7 import all of these.

- [ ] **Step 1: Write the failing tests — append to `src/lib/api-client.test.ts`**

Add `submitMatchResult` to the existing multi-line import from `./api-client` at the top of the file, so it reads:

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
  createSeason,
  archiveSeason,
  updateMatch,
  submitMatchResult,
} from "./api-client";
```

Add this `describe` block at the end of the file, inside the existing outer `describe("api-client", ...)` block:

```typescript
  describe("submitMatchResult", () => {
    it("posts the result and returns the updated match", async () => {
      const match = {
        id: 101,
        roundNumber: 1,
        date: "2026-08-01",
        status: "played",
        player1: { id: 1, displayName: "Administrator" },
        player2: { id: 2, displayName: "Bob Smith" },
        player1Legs: 3,
        player2Legs: 1,
        player1Checkout: 82,
        player2Checkout: null,
        resultEnteredBy: { id: 1, displayName: "Administrator" },
        resultEnteredAt: "2026-08-01T20:00:00.000Z",
      };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ match }), { status: 200 }));

      const result = await submitMatchResult(101, { player1Legs: 3, player2Legs: 1, player1Checkout: 82 });

      expect(fetch).toHaveBeenCalledWith(
        "/api/matches/101/result",
        expect.objectContaining({
          method: "PATCH",
          credentials: "same-origin",
          body: JSON.stringify({ player1Legs: 3, player2Legs: 1, player1Checkout: 82 }),
        })
      );
      expect(result).toEqual(match);
    });

    it("throws the server's error message on failure", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(
          JSON.stringify({ error: "One player must win exactly 3 legs; the other must have 0-2 legs" }),
          { status: 400 }
        )
      );

      await expect(submitMatchResult(101, { player1Legs: 3, player2Legs: 3 })).rejects.toThrow(
        "One player must win exactly 3 legs; the other must have 0-2 legs"
      );
    });
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `submitMatchResult` is not exported from `./api-client`.

- [ ] **Step 3: Update `src/lib/api-client.ts`**

Replace the existing `SeasonMatch` type with:

```typescript
export type SeasonMatch = {
  id: number;
  roundNumber: number;
  date: string;
  status: "scheduled" | "cancelled" | "played";
  player1: SeasonParticipantSummary;
  player2: SeasonParticipantSummary;
  player1Legs: number | null;
  player2Legs: number | null;
  player1Checkout: number | null;
  player2Checkout: number | null;
  resultEnteredBy: SeasonParticipantSummary | null;
  resultEnteredAt: string | null;
};
```

Replace the existing `MatchUpdateResult` type's `status` field type from `"scheduled" | "cancelled"` to `"scheduled" | "cancelled" | "played"` (the endpoint's input is still restricted to setting `"scheduled"`/`"cancelled"`, but the row it returns can already be `"played"` if a result was previously recorded).

Append this to the end of the file (after the existing `updateMatch` function):

```typescript
export type SubmitMatchResultInput = {
  player1Legs: number;
  player2Legs: number;
  player1Checkout?: number;
  player2Checkout?: number;
};

export async function submitMatchResult(id: number, input: SubmitMatchResultInput): Promise<SeasonMatch> {
  const response = await fetch(`/api/matches/${id}/result`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ match: SeasonMatch }>(response);
  return data.match;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including 2 new tests in `api-client.test.ts`.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api-client.ts src/lib/api-client.test.ts
git commit -m "Add submitMatchResult and widen SeasonMatch with result fields"
```

---

### Task 5: `RoundRobinSchedule` — show final score for played matches

**Files:**
- Modify: `src/pages/season/RoundRobinSchedule.tsx`
- Modify: `src/pages/season/RoundRobinSchedule.test.tsx`
- Modify: `src/pages/season/SeasonDetail.test.tsx`

**Interfaces:**
- Consumes: the widened `type SeasonMatch` (Task 4).
- Produces: a new named export `formatMatchSummary(match: SeasonMatch): string` — returns the final score (e.g. `"3–1"`) when `match.status === "played"`, otherwise the formatted date, exactly as the component's own default (no-`renderMatchActions`) branch now uses internally. Task 7 imports and reuses this same function for its own read-only fallback branch.

- [ ] **Step 1: Update the failing tests — `src/pages/season/RoundRobinSchedule.test.tsx`**

Replace the file's full content with:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import RoundRobinSchedule, { formatMatchSummary } from "./RoundRobinSchedule";
import type { SeasonMatch, SeasonParticipantSummary } from "../../lib/api-client";

const participants: SeasonParticipantSummary[] = [
  { id: 1, displayName: "Administrator" },
  { id: 2, displayName: "Bob Smith" },
  { id: 3, displayName: "Carol Smith" },
];

const noResult = {
  player1Legs: null,
  player2Legs: null,
  player1Checkout: null,
  player2Checkout: null,
  resultEnteredBy: null,
  resultEnteredAt: null,
} as const;

const matches: SeasonMatch[] = [
  {
    id: 101,
    roundNumber: 1,
    date: "2026-08-01",
    status: "scheduled",
    player1: { id: 1, displayName: "Administrator" },
    player2: { id: 2, displayName: "Bob Smith" },
    ...noResult,
  },
  {
    id: 102,
    roundNumber: 2,
    date: "2026-08-08",
    status: "cancelled",
    player1: { id: 1, displayName: "Administrator" },
    player2: { id: 3, displayName: "Carol Smith" },
    ...noResult,
  },
];

describe("RoundRobinSchedule", () => {
  it("groups matches under round headings in ascending order", () => {
    render(<RoundRobinSchedule matches={matches} participants={participants} />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Round 1", "Round 2"]);
  });

  it("shows the opponent pairing for each match", () => {
    render(<RoundRobinSchedule matches={matches} participants={participants} />);
    expect(screen.getByText("Administrator vs Bob Smith")).toBeInTheDocument();
    expect(screen.getByText("Administrator vs Carol Smith")).toBeInTheDocument();
  });

  it("shows a bye for the participant missing from that round", () => {
    render(<RoundRobinSchedule matches={matches} participants={participants} />);
    expect(screen.getByText("Carol Smith: bye")).toBeInTheDocument(); // round 1
    expect(screen.getByText("Bob Smith: bye")).toBeInTheDocument(); // round 2
  });

  it("marks a cancelled match", () => {
    render(<RoundRobinSchedule matches={matches} participants={participants} />);
    expect(screen.getByText("cancelled")).toBeInTheDocument();
  });

  it("renders the formatted date by default for a scheduled match", () => {
    render(<RoundRobinSchedule matches={[matches[0]]} participants={participants} />);
    expect(screen.getByText(new Date("2026-08-01").toLocaleDateString())).toBeInTheDocument();
  });

  it("renders the final score instead of the date for a played match", () => {
    const playedMatch: SeasonMatch = { ...matches[0], status: "played", player1Legs: 3, player2Legs: 1 };
    render(<RoundRobinSchedule matches={[playedMatch]} participants={participants} />);
    expect(screen.getByText("3–1")).toBeInTheDocument();
    expect(screen.queryByText(new Date("2026-08-01").toLocaleDateString())).not.toBeInTheDocument();
  });

  it("renders custom match actions when provided instead of the date", () => {
    render(
      <RoundRobinSchedule
        matches={[matches[0]]}
        participants={participants}
        renderMatchActions={(match) => <button>Cancel {match.id}</button>}
      />
    );
    expect(screen.getByRole("button", { name: "Cancel 101" })).toBeInTheDocument();
    expect(screen.queryByText(new Date("2026-08-01").toLocaleDateString())).not.toBeInTheDocument();
  });

  it("renders multiple byes when 2+ participants have no match in a round", () => {
    const fiveParticipants: SeasonParticipantSummary[] = [
      { id: 1, displayName: "Alice" },
      { id: 2, displayName: "Bob" },
      { id: 3, displayName: "Carol" },
      { id: 4, displayName: "Dave" },
      { id: 5, displayName: "Eve" },
    ];
    const oneMatchPerRound: SeasonMatch[] = [
      {
        id: 201,
        roundNumber: 1,
        date: "2026-08-01",
        status: "scheduled",
        player1: { id: 1, displayName: "Alice" },
        player2: { id: 2, displayName: "Bob" },
        ...noResult,
      },
    ];
    render(<RoundRobinSchedule matches={oneMatchPerRound} participants={fiveParticipants} />);
    expect(screen.getByText("Carol: bye")).toBeInTheDocument();
    expect(screen.getByText("Dave: bye")).toBeInTheDocument();
    expect(screen.getByText("Eve: bye")).toBeInTheDocument();
  });

  it("renders no bye text when all participants have a match in a round", () => {
    const fourParticipants: SeasonParticipantSummary[] = [
      { id: 1, displayName: "Alice" },
      { id: 2, displayName: "Bob" },
      { id: 3, displayName: "Carol" },
      { id: 4, displayName: "Dave" },
    ];
    const allMatchesRound: SeasonMatch[] = [
      {
        id: 301,
        roundNumber: 1,
        date: "2026-08-01",
        status: "scheduled",
        player1: { id: 1, displayName: "Alice" },
        player2: { id: 2, displayName: "Bob" },
        ...noResult,
      },
      {
        id: 302,
        roundNumber: 1,
        date: "2026-08-01",
        status: "scheduled",
        player1: { id: 3, displayName: "Carol" },
        player2: { id: 4, displayName: "Dave" },
        ...noResult,
      },
    ];
    render(<RoundRobinSchedule matches={allMatchesRound} participants={fourParticipants} />);
    expect(screen.queryByText(/: bye$/)).not.toBeInTheDocument();
  });

  it("formatMatchSummary returns the score for a played match and the date otherwise", () => {
    expect(formatMatchSummary({ ...matches[0], status: "played", player1Legs: 3, player2Legs: 0 })).toBe("3–0");
    expect(formatMatchSummary(matches[0])).toBe(new Date("2026-08-01").toLocaleDateString());
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `formatMatchSummary` is not exported, and the score isn't shown for a played match.

- [ ] **Step 3: Update `src/pages/season/RoundRobinSchedule.tsx`**

Replace the file's full content with:

```tsx
import type { ReactNode } from "react";
import type { SeasonMatch, SeasonParticipantSummary } from "../../lib/api-client";

export function formatMatchSummary(match: SeasonMatch): string {
  if (match.status === "played") {
    return `${match.player1Legs}–${match.player2Legs}`;
  }
  return new Date(match.date).toLocaleDateString();
}

type RoundRobinScheduleProps = {
  matches: SeasonMatch[];
  participants: SeasonParticipantSummary[];
  renderMatchActions?: (match: SeasonMatch) => ReactNode;
};

export default function RoundRobinSchedule({ matches, participants, renderMatchActions }: RoundRobinScheduleProps) {
  const rounds = Array.from(new Set(matches.map((m) => m.roundNumber))).sort((a, b) => a - b);

  return (
    <>
      {rounds.map((roundNumber) => {
        const roundMatches = matches.filter((m) => m.roundNumber === roundNumber);
        const byePlayers = participants.filter(
          (p) => !roundMatches.some((m) => m.player1.id === p.id || m.player2.id === p.id)
        );

        return (
          <div key={roundNumber} className="mb-4">
            <h2 className="font-heading mb-2 font-semibold">Round {roundNumber}</h2>
            <ul className="divide-y divide-gray-200">
              {roundMatches.map((match) => (
                <li key={match.id} className="flex items-center justify-between py-2">
                  <span>
                    {match.player1.displayName} vs {match.player2.displayName}
                  </span>
                  <span className="flex items-center gap-2 text-sm text-gray-500">
                    {renderMatchActions ? renderMatchActions(match) : formatMatchSummary(match)}
                    {match.status === "cancelled" && <span className="text-red-600">cancelled</span>}
                  </span>
                </li>
              ))}
              {byePlayers.map((player) => (
                <li key={`bye-${player.id}`} className="py-2 text-sm text-gray-500">
                  {player.displayName}: bye
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 4: Update the one match literal in `src/pages/season/SeasonDetail.test.tsx`**

In its `"renders the season's read-only schedule"` test, add the six new required fields to the mocked match object so it satisfies the widened `SeasonMatch` type:

```tsx
      matches: [
        {
          id: 101,
          roundNumber: 1,
          date: "2025-12-01",
          status: "scheduled",
          player1: { id: 1, displayName: "Administrator" },
          player2: { id: 2, displayName: "Bob Smith" },
          player1Legs: null,
          player2Legs: null,
          player1Checkout: null,
          player2Checkout: null,
          resultEnteredBy: null,
          resultEnteredAt: null,
        },
      ],
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including 10 tests in `RoundRobinSchedule.test.tsx` and both tests in `SeasonDetail.test.tsx`.

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: zero TypeScript errors. This step matters here specifically — the widened `SeasonMatch` type makes the new fields required everywhere a `SeasonMatch` literal is constructed, and `vitest` alone won't catch a fixture that's missing them.

- [ ] **Step 7: Commit**

```bash
git add src/pages/season/RoundRobinSchedule.tsx src/pages/season/RoundRobinSchedule.test.tsx src/pages/season/SeasonDetail.test.tsx
git commit -m "Show final score for played matches in RoundRobinSchedule"
```

---

### Task 6: Match result entry page

**Files:**
- Create: `src/pages/season/MatchResult.tsx`
- Test: `src/pages/season/MatchResult.test.tsx`

**Interfaces:**
- Consumes: `listSeasons`, `getSeason`, `submitMatchResult`, `type SeasonMatch` (Task 4), `useAuth` (`src/lib/AuthContext.tsx`).
- Produces: `MatchResult` — default-exported component. Reads `id` from the route, finds the match by fetching the active season and filtering client-side (same pattern as `EditMember`/`Season`/`SeasonDetail`). Renders an editable form when the current user is admin or one of the match's two participants; otherwise renders the same data read-only. On submit, calls `submitMatchResult` and navigates to `/season`. Task 8 registers this on the `/season/matches/:id/result` route.

- [ ] **Step 1: Write the failing test — `src/pages/season/MatchResult.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import MatchResult from "./MatchResult";
import * as apiClient from "../../lib/api-client";
import { useAuth } from "../../lib/AuthContext";

vi.mock("../../lib/api-client");
vi.mock("../../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const scheduledMatch: apiClient.SeasonMatch = {
  id: 101,
  roundNumber: 1,
  date: "2026-08-01",
  status: "scheduled",
  player1: { id: 1, displayName: "Administrator" },
  player2: { id: 2, displayName: "Bob Smith" },
  player1Legs: null,
  player2Legs: null,
  player1Checkout: null,
  player2Checkout: null,
  resultEnteredBy: null,
  resultEnteredAt: null,
};

const playedMatch: apiClient.SeasonMatch = {
  ...scheduledMatch,
  id: 102,
  status: "played",
  player1Legs: 3,
  player2Legs: 1,
  player1Checkout: 82,
  resultEnteredBy: { id: 1, displayName: "Administrator" },
  resultEnteredAt: "2026-08-01T20:00:00.000Z",
};

const season: apiClient.Season = {
  id: 1,
  name: "Spring 2026",
  roundType: "single",
  status: "active",
  participants: [
    { id: 1, displayName: "Administrator" },
    { id: 2, displayName: "Bob Smith" },
    { id: 3, displayName: "Carol Jones" },
  ],
  matches: [scheduledMatch, playedMatch],
};

function mockAuth(id: number, role: "admin" | "player") {
  vi.mocked(useAuth).mockReturnValue({
    user: { id, username: "x", role, displayName: "X" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function renderWithRouter(matchId: number) {
  return render(
    <MemoryRouter initialEntries={[`/season/matches/${matchId}/result`]}>
      <Routes>
        <Route path="/season/matches/:id/result" element={<MatchResult />} />
        <Route path="/season" element={<div>Season page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function mockSeasonLoad() {
  vi.mocked(apiClient.listSeasons).mockResolvedValue([
    { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
  ]);
  vi.mocked(apiClient.getSeason).mockResolvedValue(season);
}

describe("MatchResult", () => {
  it("renders an editable form for the admin", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();

    renderWithRouter(101);

    await waitFor(() => expect(screen.getByLabelText("Administrator legs")).toBeInTheDocument());
    expect(screen.getByLabelText("Bob Smith legs")).toBeInTheDocument();
  });

  it("renders an editable form for a participant who is not admin", async () => {
    mockAuth(2, "player");
    mockSeasonLoad();

    renderWithRouter(101);

    await waitFor(() => expect(screen.getByLabelText("Administrator legs")).toBeInTheDocument());
  });

  it("renders a read-only view with no controls for a non-participant player", async () => {
    mockAuth(3, "player");
    mockSeasonLoad();

    renderWithRouter(101);

    await waitFor(() => expect(screen.getByText("No result recorded yet.")).toBeInTheDocument());
    expect(screen.queryByLabelText("Administrator legs")).not.toBeInTheDocument();
  });

  it("shows the recorded result read-only for a non-participant when the match is played", async () => {
    mockAuth(3, "player");
    mockSeasonLoad();

    renderWithRouter(102);

    await waitFor(() => {
      expect(screen.getByText("Result: Administrator 3–1 Bob Smith")).toBeInTheDocument();
    });
  });

  it("pre-fills the form with the existing result when editing a played match", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();

    renderWithRouter(102);

    await waitFor(() => expect(screen.getByLabelText("Administrator legs")).toHaveValue(3));
    expect(screen.getByLabelText("Bob Smith legs")).toHaveValue(1);
    expect(screen.getByLabelText("Administrator highest checkout (optional)")).toHaveValue(82);
  });

  it("submits the entered result and navigates to /season", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.submitMatchResult).mockResolvedValue({
      ...scheduledMatch,
      status: "played",
      player1Legs: 3,
      player2Legs: 0,
    });

    renderWithRouter(101);
    await waitFor(() => screen.getByLabelText("Administrator legs"));

    await userEvent.type(screen.getByLabelText("Administrator legs"), "3");
    await userEvent.type(screen.getByLabelText("Bob Smith legs"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Save Result" }));

    await waitFor(() => {
      expect(apiClient.submitMatchResult).toHaveBeenCalledWith(101, { player1Legs: 3, player2Legs: 0 });
    });
    await waitFor(() => expect(screen.getByText("Season page")).toBeInTheDocument());
  });

  it("includes a checkout in the payload only when entered", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.submitMatchResult).mockResolvedValue({ ...scheduledMatch, status: "played" });

    renderWithRouter(101);
    await waitFor(() => screen.getByLabelText("Administrator legs"));

    await userEvent.type(screen.getByLabelText("Administrator legs"), "3");
    await userEvent.type(screen.getByLabelText("Bob Smith legs"), "1");
    await userEvent.type(screen.getByLabelText("Administrator highest checkout (optional)"), "82");
    await userEvent.click(screen.getByRole("button", { name: "Save Result" }));

    await waitFor(() => {
      expect(apiClient.submitMatchResult).toHaveBeenCalledWith(101, {
        player1Legs: 3,
        player2Legs: 1,
        player1Checkout: 82,
      });
    });
  });

  it("shows an error message when submitMatchResult rejects", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.submitMatchResult).mockRejectedValue(
      new Error("Cannot modify a match in an archived season")
    );

    renderWithRouter(101);
    await waitFor(() => screen.getByLabelText("Administrator legs"));

    await userEvent.type(screen.getByLabelText("Administrator legs"), "3");
    await userEvent.type(screen.getByLabelText("Bob Smith legs"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Save Result" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Cannot modify a match in an archived season");
    });
  });

  it("shows an error when no match with that id exists in the active season", async () => {
    mockAuth(1, "admin");
    vi.mocked(apiClient.listSeasons).mockResolvedValue([]);

    renderWithRouter(999);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Match not found");
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/pages/season/MatchResult.tsx` does not exist.

- [ ] **Step 3: Create `src/pages/season/MatchResult.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { listSeasons, getSeason, submitMatchResult, type SeasonMatch } from "../../lib/api-client";

export default function MatchResult() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [match, setMatch] = useState<SeasonMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [player1Legs, setPlayer1Legs] = useState("");
  const [player2Legs, setPlayer2Legs] = useState("");
  const [player1Checkout, setPlayer1Checkout] = useState("");
  const [player2Checkout, setPlayer2Checkout] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    const matchId = Number(id);
    listSeasons()
      .then((seasons) => {
        const active = seasons.find((s) => s.status === "active");
        if (!active) {
          setError("Match not found");
          return null;
        }
        return getSeason(active.id);
      })
      .then((season) => {
        if (!season) return;
        const found = season.matches.find((m) => m.id === matchId);
        if (!found) {
          setError("Match not found");
          return;
        }
        setMatch(found);
        setPlayer1Legs(found.player1Legs !== null ? String(found.player1Legs) : "");
        setPlayer2Legs(found.player2Legs !== null ? String(found.player2Legs) : "");
        setPlayer1Checkout(found.player1Checkout !== null ? String(found.player1Checkout) : "");
        setPlayer2Checkout(found.player2Checkout !== null ? String(found.player2Checkout) : "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load match"))
      .finally(() => setLoading(false));
  }, [id]);

  const canEdit =
    !!match && !!user && (user.role === "admin" || user.id === match.player1.id || user.id === match.player2.id);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!match) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await submitMatchResult(match.id, {
        player1Legs: Number(player1Legs),
        player2Legs: Number(player2Legs),
        ...(player1Checkout ? { player1Checkout: Number(player1Checkout) } : {}),
        ...(player2Checkout ? { player2Checkout: Number(player2Checkout) } : {}),
      });
      navigate("/season");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save result");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="p-4">Loading…</p>;
  }

  if (error || !match) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        {error ?? "Match not found"}
      </p>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">
        {match.player1.displayName} vs {match.player2.displayName}
      </h1>
      {canEdit ? (
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
          <div>
            <label htmlFor="player1Legs" className="block text-sm font-medium">
              {match.player1.displayName} legs
            </label>
            <input
              id="player1Legs"
              type="number"
              min={0}
              max={3}
              required
              value={player1Legs}
              onChange={(e) => setPlayer1Legs(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-2"
            />
          </div>
          <div>
            <label htmlFor="player2Legs" className="block text-sm font-medium">
              {match.player2.displayName} legs
            </label>
            <input
              id="player2Legs"
              type="number"
              min={0}
              max={3}
              required
              value={player2Legs}
              onChange={(e) => setPlayer2Legs(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-2"
            />
          </div>
          <div>
            <label htmlFor="player1Checkout" className="block text-sm font-medium">
              {match.player1.displayName} highest checkout (optional)
            </label>
            <input
              id="player1Checkout"
              type="number"
              min={1}
              value={player1Checkout}
              onChange={(e) => setPlayer1Checkout(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-2"
            />
          </div>
          <div>
            <label htmlFor="player2Checkout" className="block text-sm font-medium">
              {match.player2.displayName} highest checkout (optional)
            </label>
            <input
              id="player2Checkout"
              type="number"
              min={1}
              value={player2Checkout}
              onChange={(e) => setPlayer2Checkout(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-2"
            />
          </div>
          {submitError && (
            <p role="alert" className="text-sm text-red-600">
              {submitError}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="bg-primary text-primary-content font-heading w-full rounded p-2 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save Result"}
          </button>
        </form>
      ) : match.status === "played" ? (
        <p>
          Result: {match.player1.displayName} {match.player1Legs}–{match.player2Legs} {match.player2.displayName}
        </p>
      ) : (
        <p>No result recorded yet.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including 10 new tests in `MatchResult.test.tsx`.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/season/MatchResult.tsx src/pages/season/MatchResult.test.tsx
git commit -m "Add match result entry page"
```

---

### Task 7: `Season` page — per-match Enter/Edit Result link

**Files:**
- Modify: `src/pages/season/Season.tsx`
- Modify: `src/pages/season/Season.test.tsx`

**Interfaces:**
- Consumes: `formatMatchSummary` (Task 5, named export alongside `RoundRobinSchedule`'s default export).
- Produces: `SeasonPage`'s `renderMatchActions` render-prop is now always passed to `RoundRobinSchedule` (never `undefined`); internally it checks per-match whether the current user is admin or one of that match's two participants. When true: admin additionally sees the existing reschedule input and Cancel/Restore button; everyone who passes the check sees an "Enter Result"/"Edit Result" link (label depends on `match.status === "played"`) to `/season/matches/{id}/result`. When false: falls back to `formatMatchSummary(match)`, matching what `RoundRobinSchedule`'s own default branch would have shown.

- [ ] **Step 1: Update the failing tests — `src/pages/season/Season.test.tsx`**

Replace the file's full content with:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import SeasonPage from "./Season";
import * as apiClient from "../../lib/api-client";
import { useAuth } from "../../lib/AuthContext";

vi.mock("../../lib/api-client");
vi.mock("../../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const season: apiClient.Season = {
  id: 1,
  name: "Spring 2026",
  roundType: "single",
  status: "active",
  participants: [
    { id: 1, displayName: "Administrator" },
    { id: 2, displayName: "Bob Smith" },
    { id: 3, displayName: "Carol Jones" },
  ],
  matches: [
    {
      id: 101,
      roundNumber: 1,
      date: "2026-08-01",
      status: "scheduled",
      player1: { id: 1, displayName: "Administrator" },
      player2: { id: 2, displayName: "Bob Smith" },
      player1Legs: null,
      player2Legs: null,
      player1Checkout: null,
      player2Checkout: null,
      resultEnteredBy: null,
      resultEnteredAt: null,
    },
  ],
};

function mockNonParticipant() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 3, username: "cjones", role: "player", displayName: "Carol Jones" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function mockParticipant() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function mockAdmin() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

describe("SeasonPage", () => {
  it("shows an empty state with no Create Season link for a player when there is no active season", async () => {
    mockNonParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <SeasonPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("No active season.")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Create Season" })).not.toBeInTheDocument();
  });

  it("shows a Create Season link for an admin when there is no active season", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <SeasonPage />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Create Season" })).toHaveAttribute("href", "/season/new");
    });
  });

  it("renders the active season's schedule", async () => {
    mockNonParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonPage />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Spring 2026")).toBeInTheDocument());
    expect(screen.getByText("Administrator vs Bob Smith")).toBeInTheDocument();
  });

  it("shows no controls, not even Enter Result, for a non-participant player", async () => {
    mockNonParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonPage />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive Season" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Enter Result" })).not.toBeInTheDocument();
  });

  it("shows only an Enter Result link, no reschedule/cancel, for a non-admin participant", async () => {
    mockParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonPage />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enter Result" })).toHaveAttribute(
      "href",
      "/season/matches/101/result"
    );
  });

  it("shows Edit Result instead of Enter Result once a match is played", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      ...season,
      matches: [{ ...season.matches[0], status: "played", player1Legs: 3, player2Legs: 1 }],
    });
    render(
      <MemoryRouter>
        <SeasonPage />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.getByRole("link", { name: "Edit Result" })).toBeInTheDocument();
  });

  it("cancels a match when the admin clicks Cancel", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.updateMatch).mockResolvedValue({
      id: 101,
      roundNumber: 1,
      date: "2026-08-01",
      status: "cancelled",
      player1Id: 1,
      player2Id: 2,
    });
    render(
      <MemoryRouter>
        <SeasonPage />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(apiClient.updateMatch).toHaveBeenCalledWith(101, { status: "cancelled" });
    });
  });

  it("archives the season when the admin clicks Archive Season", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.archiveSeason).mockResolvedValue({ ...season, status: "archived" });
    render(
      <MemoryRouter>
        <SeasonPage />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByRole("button", { name: "Archive Season" }));

    await waitFor(() => {
      expect(apiClient.archiveSeason).toHaveBeenCalledWith(1);
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — no "Enter Result" link exists yet, and the non-participant test now expects one to be absent while everything else about that assertion already passes (so the newly added assertions are what fail).

- [ ] **Step 3: Update `src/pages/season/Season.tsx`**

Replace the file's full content with:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { listSeasons, getSeason, archiveSeason, updateMatch, type Season, type SeasonMatch } from "../../lib/api-client";
import RoundRobinSchedule, { formatMatchSummary } from "./RoundRobinSchedule";

export default function SeasonPage() {
  const { user } = useAuth();
  const [season, setSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const seasons = await listSeasons();
      const active = seasons.find((s) => s.status === "active");
      if (!active) {
        setSeason(null);
        return;
      }
      setSeason(await getSeason(active.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load season");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleArchive() {
    if (!season) return;
    await archiveSeason(season.id);
    void load();
  }

  async function handleReschedule(matchId: number, date: string) {
    await updateMatch(matchId, { date });
    void load();
  }

  async function handleToggleStatus(match: SeasonMatch) {
    await updateMatch(match.id, { status: match.status === "cancelled" ? "scheduled" : "cancelled" });
    void load();
  }

  if (loading) {
    return <p className="p-4">Loading…</p>;
  }

  if (error) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        {error}
      </p>
    );
  }

  if (!season) {
    return (
      <div className="p-4">
        <h1 className="text-primary font-heading mb-4 text-2xl font-bold">Season</h1>
        <p>No active season.</p>
        {user?.role === "admin" && (
          <Link to="/season/new" className="text-primary underline">
            Create Season
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-primary font-heading text-2xl font-bold">{season.name}</h1>
        {user?.role === "admin" && (
          <button onClick={() => void handleArchive()} className="text-primary underline">
            Archive Season
          </button>
        )}
      </div>
      <RoundRobinSchedule
        matches={season.matches}
        participants={season.participants}
        renderMatchActions={(match) => {
          const canRecordResult =
            !!user && (user.role === "admin" || user.id === match.player1.id || user.id === match.player2.id);

          if (!canRecordResult) {
            return formatMatchSummary(match);
          }

          return (
            <>
              {user?.role === "admin" && (
                <>
                  <input
                    type="date"
                    aria-label={`Reschedule ${match.player1.displayName} vs ${match.player2.displayName}`}
                    value={match.date.slice(0, 10)}
                    onChange={(e) => void handleReschedule(match.id, e.target.value)}
                    className="rounded border border-gray-300 p-1"
                  />
                  <button onClick={() => void handleToggleStatus(match)} className="text-primary underline">
                    {match.status === "cancelled" ? "Restore" : "Cancel"}
                  </button>
                </>
              )}
              <Link to={`/season/matches/${match.id}/result`} className="text-primary underline">
                {match.status === "played" ? "Edit Result" : "Enter Result"}
              </Link>
            </>
          );
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including 9 tests in `Season.test.tsx`.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/season/Season.tsx src/pages/season/Season.test.tsx
git commit -m "Add per-match Enter/Edit Result link to the Season page"
```

---

### Task 8: Wire the `/season/matches/:id/result` route

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `MatchResult` (Task 6).
- Produces: `App` registers `/season/matches/:id/result` under `ProtectedRoute` (any logged-in user — the page itself handles the admin/participant-vs-read-only split, matching the constraint that this isn't admin-gated at the router level).

- [ ] **Step 1: Update `src/App.tsx`**

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminRoute } from "./components/AdminRoute";
import Login from "./pages/auth/Login";
import Home from "./pages/Home";
import Members from "./pages/admin/Members";
import NewMember from "./pages/admin/NewMember";
import EditMember from "./pages/admin/EditMember";
import SeasonPage from "./pages/season/Season";
import NewSeason from "./pages/season/NewSeason";
import SeasonArchive from "./pages/season/SeasonArchive";
import SeasonDetail from "./pages/season/SeasonDetail";
import MatchResult from "./pages/season/MatchResult";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Home />} />
            <Route path="/season" element={<SeasonPage />} />
            <Route path="/season/matches/:id/result" element={<MatchResult />} />
            <Route path="/seasons" element={<SeasonArchive />} />
            <Route path="/seasons/:id" element={<SeasonDetail />} />
          </Route>
          <Route element={<AdminRoute />}>
            <Route path="/admin/members" element={<Members />} />
            <Route path="/admin/members/new" element={<NewMember />} />
            <Route path="/admin/members/:id/edit" element={<EditMember />} />
            <Route path="/season/new" element={<NewSeason />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 2: Run the full test suite and verify the build**

Run: `npm test`
Expected: PASS — all frontend tests still passing (this change is purely additive routing; no existing test exercises the new route directly, consistent with how the Season phase's own route-wiring task also had no dedicated route test beyond manual E2E).

Run: `npm run build`
Expected: zero TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "Wire /season/matches/:id/result route into App"
```

---

### Task 9: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Start the full local stack**

From the repo root:
```bash
docker compose up -d
```
From `api/` (separate terminals, leave running):
```bash
npm run build
npm run azurite
func start
```
Wait for it to log all functions, including `matchesSubmitResult`, plus the existing `seasonsCreate`/`seasonsList`/`seasonsGet`/`seasonsArchive`/`matchesUpdate` and the Auth/Member Management functions.

From the repo root (separate terminal):
```bash
npm run dev:swa -- --api-devserver-url http://localhost:7071
```

- [ ] **Step 2: Ensure an active season with at least 2 active players exists**

From `api/`:
```bash
npm run db:seed
```
Log in as admin, create 1–2 additional active player accounts via `/admin/members` if needed, then create a season (via `/season/new`) with at least 2 participants if none is currently active. Note the resulting match ids for use below.

- [ ] **Step 3: Verify the endpoint via curl**

```bash
curl -i -c cookies.txt -X POST http://localhost:4280/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"ChangeMe123!"}'
```
Expected: `200` with a `Set-Cookie: authToken=...`.

```bash
curl -i -b cookies.txt -X PATCH http://localhost:4280/api/matches/<match-id>/result \
  -H "Content-Type: application/json" \
  -d '{"player1Legs":3,"player2Legs":1,"player1Checkout":82}'
```
Expected: `201` — wait, `200` with the recorded result, `status: "played"`, and `resultEnteredBy` resolved to the admin's `{id, displayName}`.

```bash
curl -i -b cookies.txt -X PATCH http://localhost:4280/api/matches/<match-id>/result \
  -H "Content-Type: application/json" \
  -d '{"player1Legs":3,"player2Legs":3}'
```
Expected: `400` (both players can't have 3 legs).

Log in as a non-participant player account (or, if none exists, create one via `/admin/members`), then:
```bash
curl -i -c player-cookies.txt -X POST http://localhost:4280/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<non-participant-username>","password":"<their-password>"}'

curl -i -b player-cookies.txt -X PATCH http://localhost:4280/api/matches/<match-id>/result \
  -H "Content-Type: application/json" \
  -d '{"player1Legs":3,"player2Legs":1}'
```
Expected: `403` (not admin, not a participant in that match).

- [ ] **Step 4: Verify the browser flow with Playwright MCP**

Log in as admin. Navigate to `/season`, confirm each scheduled match shows an "Enter Result" link alongside the reschedule/cancel controls. Click it, fill in legs (e.g. `3` and `1`) and a checkout for the winner, save. Confirm it navigates back to `/season` and the match now shows the score (`"3–1"`) and an "Edit Result" link instead of the date.

Log in as one of that match's participants (not admin). Confirm they see the "Edit Result" link but not the reschedule input or Cancel button. Click it, confirm the form is pre-filled with the existing result, change a value, save, confirm it persists.

Log in as a different active player who is NOT a participant in that match. Confirm no result-entry controls appear for that match on `/season` (just the score, read-only). Navigate directly to `/season/matches/<match-id>/result`, confirm the page renders the recorded result read-only with no form controls.

Attempt (as that same non-participant, via a direct API call or by temporarily editing the DOM) to submit a result — confirm the server still rejects it with `403` even if the UI were somehow bypassed.

Confirm the score also renders correctly on the read-only archived view: archive the season, navigate to `/seasons/:id`, confirm the played match's score shows there too.

- [ ] **Step 5: Confirm both test suites still pass**

```bash
cd api && npm test
```
Expected: all backend tests passing.

```bash
npm test
```
(from the repo root)
Expected: all frontend tests passing.

---

## Plan Self-Review Notes

- **Spec coverage:** implements every section of `docs/superpowers/specs/2026-07-20-match-result-entry-design.md` — Section 2 (data model, status widening, uniform last-write-wins, `onDelete: NoAction` requirement) in Task 1; Section 3 (the new endpoint and its authorization/validation, plus the extended read endpoint) in Tasks 2–3; Section 4 (API client, the shared `formatMatchSummary` helper, the new page, and its integration into the existing `Season` page) in Tasks 4–7; Section 5 (cancelled/archived/unauthorized error handling, re-editing semantics) is exercised throughout Tasks 2, 6, 7's tests and Task 9's manual pass; Section 6 (testing approach) is Tasks 1–9 themselves.
- **Placeholder scan:** no TBD/TODO markers. Every step has runnable code or an exact command with an expected result.
- **Type consistency:** `SeasonMatch`'s six new fields (Task 4) are the single source of truth for the result shape, consumed identically by `formatMatchSummary` (Task 5), `MatchResult` (Task 6), and `Season`'s render-prop (Task 7) — and cross-checked against the backend's actual response shape in Tasks 2–3, avoiding the frontend/backend type-mismatch class of bug the Season phase's final review caught. Widening `SeasonMatch`/`MatchUpdateResult`'s `status` field is applied consistently everywhere the type is used; Task 5 explicitly identifies and fixes every existing test fixture across `RoundRobinSchedule.test.tsx`, `SeasonDetail.test.tsx`, and `Season.test.tsx` (Task 7) that constructs a `SeasonMatch` literal, rather than letting `tsc` discover the gap mid-plan the way it did in the Season phase.
- **Endpoint separation:** `PATCH /api/matches/{id}/result` (Task 2, admin-or-participant) is deliberately kept separate from the existing `PATCH /api/matches/{id}` (admin-only reschedule/cancel, unchanged) — different authorization models on one endpoint were explicitly rejected during brainstorming in favor of two focused endpoints.
