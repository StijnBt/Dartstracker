# Season & Schedule Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin a way to create a season (round type + participant roster), have the system auto-generate a round-robin schedule, adjust individual matches afterward, and let every logged-in user browse the current and past seasons' schedules.

**Architecture:** Backend: five new Azure Functions across `api/src/functions/seasons/` and `api/src/functions/matches/`, backed by a pure `generateRoundRobin`/`computeRoundCount` module reused by the create endpoint and its tests. Frontend: a shared `RoundRobinSchedule` presentational component (parallel to the Member Management phase's `MemberForm`) consumed by both the live season view and the read-only archive view, four new full-page routes, and a "Season" nav link visible to every logged-in user (not admin-gated, unlike "Manage Members").

**Tech Stack:** No new dependencies. Same stack as prior phases (Prisma, `@azure/functions` v4, Vitest, React Testing Library, react-router-dom v7). Dates use native `<input type="date">` — no date-picker library.

## Global Constraints

- Exactly one active season at a time: `POST /api/seasons` returns `409` if a `Season` with `status: "active"` already exists.
- The season roster (`SeasonParticipant` rows) is written once at creation and never modified afterward — no mid-season roster changes.
- No separate `Round` entity: a round is `roundNumber` shared by a group of matches, plus each match's own independent `date`.
- Byes are never persisted as rows — derive "player X has a bye this round" by diffing a round's participants against the players appearing in that round's matches.
- Round-robin generation uses the circle method. "Double" round type repeats the exact same pairings a second time, as fresh rounds with fresh round numbers — no home/away distinction.
- `Match.status` is `"scheduled" | "cancelled"` — cancelling sets the flag, never deletes the row.
- Archived-season matches are frozen: `PATCH /api/matches/{id}` rejects with `400` if the match's season is not `active`.
- `PATCH /api/seasons/{id}` supports only the `active` → `archived` transition; anything else is `400`.
- Read endpoints (`GET /api/seasons`, `GET /api/seasons/{id}`) call `requireAuth(request)` (any authenticated role). Write endpoints (`POST /api/seasons`, `PATCH /api/seasons/{id}`, `PATCH /api/matches/{id}`) call `requireAuth(request, "admin")`.
- `/season`, `/seasons`, and `/seasons/:id` are visible to every logged-in user, nested under `ProtectedRoute` — not admin-gated. `/season/new` is admin-only, nested under `AdminRoute`.
- No pagination anywhere (league is ≤30 people, seasons accumulate slowly).

---

### Task 1: Prisma schema — `Season`, `SeasonParticipant`, `Match` models

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: migration via `prisma migrate dev` (generates `api/prisma/migrations/<timestamp>_add_season_models/migration.sql`)

**Interfaces:**
- Produces: `Season`, `SeasonParticipant`, `Match` Prisma models, and three new relation fields on `User` (`seasonParticipations`, `player1Matches`, `player2Matches`). All later backend tasks query these via `prisma.season`, `prisma.seasonParticipant`, `prisma.match`.

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

  season  Season @relation(fields: [seasonId], references: [id])
  player1 User   @relation("Player1Matches", fields: [player1Id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  player2 User   @relation("Player2Matches", fields: [player2Id], references: [id], onDelete: NoAction, onUpdate: NoAction)
}
```

Note: `onDelete: NoAction, onUpdate: NoAction` on `player1`/`player2` is required — SQL Server rejects the implicit default (`Cascade`) here because two FKs from `Match` (`player1Id`, `player2Id`) both reference `User`, creating multiple cascade paths (Prisma error P1012). Without these two attributes, `prisma migrate dev` fails schema validation before ever touching the database.

- [ ] **Step 3: Generate and apply the migration**

```bash
cd "D:/WEB/Dartstracker/api" && npx prisma migrate dev --name add_season_models
```
Expected: creates `prisma/migrations/<timestamp>_add_season_models/migration.sql` with `CREATE TABLE` statements for `Season`, `SeasonParticipant`, `Match`, applies it to the local database, and regenerates the Prisma client. No errors.

- [ ] **Step 4: Verify the client builds**

```bash
npm run build
```
Expected: `tsc` succeeds with no errors (confirms the regenerated Prisma client types are valid).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add Season, SeasonParticipant, and Match models"
```

---

### Task 2: Round-robin schedule generator (backend)

**Files:**
- Create: `api/src/lib/roundRobin.ts`
- Test: `api/test/lib/roundRobin.test.ts`

**Interfaces:**
- Produces: `RoundType` (`"single" | "double"`), `isRoundType(value): value is RoundType`, `RoundRobinMatch` (`{ roundNumber: number; player1Id: number; player2Id: number }`), `computeRoundCount(participantCount: number, roundType: RoundType): number`, `generateRoundRobin(participantIds: number[], roundType: RoundType): RoundRobinMatch[]` — all named exports from `api/src/lib/roundRobin.ts`. Task 3 (`POST /api/seasons`) imports all four.

- [ ] **Step 1: Write the failing test — `api/test/lib/roundRobin.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { computeRoundCount, generateRoundRobin, isRoundType } from "../../src/lib/roundRobin";

describe("isRoundType", () => {
  it("accepts 'single' and 'double'", () => {
    expect(isRoundType("single")).toBe(true);
    expect(isRoundType("double")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isRoundType("triple")).toBe(false);
    expect(isRoundType(undefined)).toBe(false);
    expect(isRoundType(1)).toBe(false);
  });
});

describe("computeRoundCount", () => {
  it("returns n-1 rounds for an even roster, single round", () => {
    expect(computeRoundCount(4, "single")).toBe(3);
  });

  it("returns n rounds for an odd roster, single round (bye padding)", () => {
    expect(computeRoundCount(5, "single")).toBe(5);
  });

  it("doubles the round count for double round type", () => {
    expect(computeRoundCount(4, "double")).toBe(6);
    expect(computeRoundCount(5, "double")).toBe(10);
  });
});

function pairKey(a: number, b: number): string {
  return [a, b].sort((x, y) => x - y).join("-");
}

describe("generateRoundRobin", () => {
  it("pairs every participant with every other exactly once, single round, even roster", () => {
    const matches = generateRoundRobin([1, 2, 3, 4], "single");
    expect(matches).toHaveLength(6);
    expect(new Set(matches.map((m) => m.roundNumber))).toEqual(new Set([1, 2, 3]));

    const seenPairs = new Set(matches.map((m) => pairKey(m.player1Id, m.player2Id)));
    expect(seenPairs.size).toBe(6);
    for (const a of [1, 2, 3, 4]) {
      for (const b of [1, 2, 3, 4]) {
        if (a < b) {
          expect(seenPairs.has(pairKey(a, b))).toBe(true);
        }
      }
    }
  });

  it("leaves exactly one player on a bye each round with an odd roster", () => {
    const matches = generateRoundRobin([1, 2, 3, 4, 5], "single");
    expect(matches).toHaveLength(10); // C(5,2)

    for (const round of [1, 2, 3, 4, 5]) {
      const roundMatches = matches.filter((m) => m.roundNumber === round);
      expect(roundMatches).toHaveLength(2);
      const playing = new Set(roundMatches.flatMap((m) => [m.player1Id, m.player2Id]));
      expect(playing.size).toBe(4);
    }
  });

  it("repeats the same pairings twice for double round type", () => {
    const single = generateRoundRobin([1, 2, 3, 4], "single");
    const double = generateRoundRobin([1, 2, 3, 4], "double");
    expect(double).toHaveLength(12);

    const firstHalf = double.filter((m) => m.roundNumber <= 3);
    const secondHalf = double.filter((m) => m.roundNumber > 3);
    expect(firstHalf.map((m) => pairKey(m.player1Id, m.player2Id)).sort()).toEqual(
      single.map((m) => pairKey(m.player1Id, m.player2Id)).sort()
    );
    expect(secondHalf.map((m) => pairKey(m.player1Id, m.player2Id)).sort()).toEqual(
      single.map((m) => pairKey(m.player1Id, m.player2Id)).sort()
    );
    expect(secondHalf.map((m) => m.roundNumber).sort((a, b) => a - b)).toEqual([4, 4, 5, 5, 6, 6]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/lib/roundRobin.ts` does not exist.

- [ ] **Step 3: Create `api/src/lib/roundRobin.ts`**

```typescript
export type RoundType = "single" | "double";

export function isRoundType(value: unknown): value is RoundType {
  return value === "single" || value === "double";
}

export function computeRoundCount(participantCount: number, roundType: RoundType): number {
  const evenCount = participantCount % 2 === 0 ? participantCount : participantCount + 1;
  const singleRoundCount = evenCount - 1;
  return roundType === "double" ? singleRoundCount * 2 : singleRoundCount;
}

export type RoundRobinMatch = {
  roundNumber: number;
  player1Id: number;
  player2Id: number;
};

/**
 * Standard circle method: fix one seat, rotate the rest each round.
 * An odd roster gets a null "bye" seat appended; any pairing involving it
 * produces no match for that round.
 */
export function generateRoundRobin(participantIds: number[], roundType: RoundType): RoundRobinMatch[] {
  const seats: Array<number | null> = [...participantIds];
  if (seats.length % 2 !== 0) {
    seats.push(null);
  }
  const n = seats.length;
  const singleRoundCount = n - 1;

  const matches: RoundRobinMatch[] = [];
  for (let round = 0; round < singleRoundCount; round++) {
    const positions = [0];
    for (let i = 1; i < n; i++) {
      positions.push(1 + ((i - 1 + round) % (n - 1)));
    }
    for (let i = 0; i < n / 2; i++) {
      const a = seats[positions[i]];
      const b = seats[positions[n - 1 - i]];
      if (a !== null && b !== null) {
        matches.push({ roundNumber: round + 1, player1Id: a, player2Id: b });
      }
    }
  }

  if (roundType === "double") {
    const secondHalf = matches.map((m) => ({ ...m, roundNumber: m.roundNumber + singleRoundCount }));
    return [...matches, ...secondHalf];
  }

  return matches;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole suite passes, including 8 new tests in `roundRobin.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roundRobin.ts test/lib/roundRobin.test.ts
git commit -m "Add round-robin schedule generator"
```

---

### Task 3: `POST /api/seasons` (create season + schedule)

**Files:**
- Create: `api/src/functions/seasons/create.ts`
- Test: `api/test/functions/seasons/create.test.ts`

**Interfaces:**
- Consumes: `prisma` (`api/src/lib/prisma.ts`), `requireAuth`/`AuthError` (`api/src/lib/requireAuth.ts`), `generateRoundRobin`/`computeRoundCount`/`isRoundType` (Task 2).
- Produces: `createSeason` — named export, registered on route `POST /api/seasons`. `201` with `{ season: { id, name, roundType, status, participants: Array<{id, displayName}>, matches: Array<{id, roundNumber, date, status, player1: {id,displayName}, player2: {id,displayName}}> } }` on success; `400` for invalid fields; `401`/`403` via `requireAuth`; `409` if a season is already active.

- [ ] **Step 1: Write the failing test — `api/test/functions/seasons/create.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { createSeason } from "../../../src/functions/seasons/create";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    season: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
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

const activeMembers = [
  { id: 1, username: "admin", displayName: "Administrator", role: "admin", isActive: true, passwordHash: "h", createdAt: new Date() },
  { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: true, passwordHash: "h", createdAt: new Date() },
  { id: 3, username: "csmith", displayName: "Carol Smith", role: "player", isActive: true, passwordHash: "h", createdAt: new Date() },
  { id: 4, username: "dsmith", displayName: "Dave Smith", role: "player", isActive: true, passwordHash: "h", createdAt: new Date() },
];

const validBody = {
  name: "Spring 2026",
  roundType: "single",
  participantIds: [1, 2, 3, 4],
  roundDates: ["2026-08-01", "2026-08-08", "2026-08-15"],
};

function mockTransaction() {
  const createdMatches = [
    { id: 101, roundNumber: 1, date: new Date("2026-08-01"), player1Id: 1, player2Id: 4, status: "scheduled" },
    { id: 102, roundNumber: 1, date: new Date("2026-08-01"), player1Id: 2, player2Id: 3, status: "scheduled" },
    { id: 103, roundNumber: 2, date: new Date("2026-08-08"), player1Id: 1, player2Id: 3, status: "scheduled" },
    { id: 104, roundNumber: 2, date: new Date("2026-08-08"), player1Id: 4, player2Id: 2, status: "scheduled" },
    { id: 105, roundNumber: 3, date: new Date("2026-08-15"), player1Id: 1, player2Id: 2, status: "scheduled" },
    { id: 106, roundNumber: 3, date: new Date("2026-08-15"), player1Id: 3, player2Id: 4, status: "scheduled" },
  ];
  const tx = {
    season: { create: vi.fn().mockResolvedValue({ id: 10, name: "Spring 2026", roundType: "single", status: "active" }) },
    seasonParticipant: { createMany: vi.fn().mockResolvedValue({ count: 4 }) },
    match: { create: vi.fn() },
  };
  let callIndex = 0;
  vi.mocked(tx.match.create).mockImplementation(async () => createdMatches[callIndex++]);
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(tx));
  return tx;
}

describe("createSeason function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await createSeason(createRequest(validBody), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when name is blank", async () => {
    const result = await createSeason(createRequest({ ...validBody, name: "   " }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when roundType is invalid", async () => {
    const result = await createSeason(createRequest({ ...validBody, roundType: "triple" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when fewer than 2 participants are given", async () => {
    const result = await createSeason(createRequest({ ...validBody, participantIds: [1] }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when participantIds contains a duplicate", async () => {
    const result = await createSeason(
      createRequest({ ...validBody, participantIds: [1, 2, 2, 3] }),
      createContext()
    );
    expect(result.status).toBe(400);
  });

  it("returns 400 when roundDates length doesn't match the computed round count", async () => {
    const result = await createSeason(
      createRequest({ ...validBody, roundDates: ["2026-08-01"] }),
      createContext()
    );
    expect(result.status).toBe(400);
  });

  it("returns 409 when a season is already active", async () => {
    vi.mocked(prisma.season.findFirst).mockResolvedValue({ id: 5, status: "active" });
    const result = await createSeason(createRequest(validBody), createContext());
    expect(result.status).toBe(409);
  });

  it("returns 400 when a participant id is unknown or inactive", async () => {
    vi.mocked(prisma.season.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.findMany).mockResolvedValue(activeMembers.slice(0, 3)); // only 3 of 4 found
    const result = await createSeason(createRequest(validBody), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 201 with the created season and schedule on success", async () => {
    vi.mocked(prisma.season.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.findMany).mockResolvedValue(activeMembers);
    const tx = mockTransaction();

    const result = await createSeason(createRequest(validBody), createContext());

    expect(result.status).toBe(201);
    expect(tx.season.create).toHaveBeenCalledWith({ data: { name: "Spring 2026", roundType: "single" } });
    expect(tx.seasonParticipant.createMany).toHaveBeenCalledWith({
      data: [
        { seasonId: 10, userId: 1 },
        { seasonId: 10, userId: 2 },
        { seasonId: 10, userId: 3 },
        { seasonId: 10, userId: 4 },
      ],
    });
    expect(tx.match.create).toHaveBeenCalledTimes(6);
    const body = result.jsonBody as { season: { participants: unknown[]; matches: unknown[] } };
    expect(body.season.participants).toHaveLength(4);
    expect(body.season.matches).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/functions/seasons/create.ts` does not exist.

- [ ] **Step 3: Create `api/src/functions/seasons/create.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { generateRoundRobin, computeRoundCount, isRoundType } from "../../lib/roundRobin";

type CreateSeasonBody = {
  name?: unknown;
  roundType?: unknown;
  participantIds?: unknown;
  roundDates?: unknown;
};

export async function createSeason(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    let body: CreateSeasonBody;
    try {
      body = (await request.json()) as CreateSeasonBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return { status: 400, jsonBody: { error: "name is required" } };
    }

    if (!isRoundType(body.roundType)) {
      return { status: 400, jsonBody: { error: "roundType must be 'single' or 'double'" } };
    }
    const roundType = body.roundType;

    const participantIdsRaw = body.participantIds;
    if (!Array.isArray(participantIdsRaw) || participantIdsRaw.length < 2) {
      return { status: 400, jsonBody: { error: "participantIds must be an array of at least 2 user ids" } };
    }
    const isNumber = (value: unknown): value is number => typeof value === "number";
    if (!participantIdsRaw.every(isNumber)) {
      return { status: 400, jsonBody: { error: "participantIds must be an array of at least 2 user ids" } };
    }
    const participantIds = participantIdsRaw;
    if (new Set(participantIds).size !== participantIds.length) {
      return { status: 400, jsonBody: { error: "participantIds must not contain duplicates" } };
    }

    const expectedRoundCount = computeRoundCount(participantIds.length, roundType);
    const roundDatesRaw = body.roundDates;
    if (!Array.isArray(roundDatesRaw) || roundDatesRaw.length !== expectedRoundCount) {
      return {
        status: 400,
        jsonBody: { error: `roundDates must contain exactly ${expectedRoundCount} valid dates` },
      };
    }
    const isValidDateString = (value: unknown): value is string =>
      typeof value === "string" && !Number.isNaN(Date.parse(value));
    if (!roundDatesRaw.every(isValidDateString)) {
      return {
        status: 400,
        jsonBody: { error: `roundDates must contain exactly ${expectedRoundCount} valid dates` },
      };
    }
    const roundDates = roundDatesRaw;

    const activeSeason = await prisma.season.findFirst({ where: { status: "active" } });
    if (activeSeason) {
      return { status: 409, jsonBody: { error: "A season is already active" } };
    }

    const participants = await prisma.user.findMany({
      where: { id: { in: participantIds }, isActive: true },
    });
    if (participants.length !== participantIds.length) {
      return { status: 400, jsonBody: { error: "participantIds must all be existing, active members" } };
    }

    const pairings = generateRoundRobin(participantIds, roundType);
    const displayNameById = new Map(participants.map((p) => [p.id, p.displayName]));

    const { season, matches } = await prisma.$transaction(async (tx) => {
      const createdSeason = await tx.season.create({ data: { name, roundType } });

      await tx.seasonParticipant.createMany({
        data: participantIds.map((userId) => ({ seasonId: createdSeason.id, userId })),
      });

      const createdMatches = [];
      for (const pairing of pairings) {
        const match = await tx.match.create({
          data: {
            seasonId: createdSeason.id,
            roundNumber: pairing.roundNumber,
            date: new Date(roundDates[pairing.roundNumber - 1]),
            player1Id: pairing.player1Id,
            player2Id: pairing.player2Id,
          },
        });
        createdMatches.push(match);
      }

      return { season: createdSeason, matches: createdMatches };
    });

    return {
      status: 201,
      jsonBody: {
        season: {
          id: season.id,
          name: season.name,
          roundType: season.roundType,
          status: season.status,
          participants: participantIds.map((id) => ({ id, displayName: displayNameById.get(id) })),
          matches: matches.map((match) => ({
            id: match.id,
            roundNumber: match.roundNumber,
            date: match.date,
            status: match.status,
            player1: { id: match.player1Id, displayName: displayNameById.get(match.player1Id) },
            player2: { id: match.player2Id, displayName: displayNameById.get(match.player2Id) },
          })),
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/seasons failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("seasonsCreate", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "seasons",
  handler: createSeason,
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole suite passes, including 9 new tests in `create.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/functions/seasons/create.ts test/functions/seasons/create.test.ts
git commit -m "Add POST /api/seasons endpoint to create a season and its schedule"
```

---

### Task 4: `GET /api/seasons` (list seasons)

**Files:**
- Create: `api/src/functions/seasons/list.ts`
- Test: `api/test/functions/seasons/list.test.ts`

**Interfaces:**
- Consumes: `prisma`, `requireAuth`/`AuthError`.
- Produces: `listSeasons` — named export, registered on route `GET /api/seasons`. `200` with `{ seasons: Array<{id, name, roundType, status, createdAt}> }` for any authenticated user; `401` otherwise.

- [ ] **Step 1: Write the failing test — `api/test/functions/seasons/list.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { listSeasons } from "../../../src/functions/seasons/list";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { season: { findMany: vi.fn() } },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

describe("listSeasons function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await listSeasons({} as HttpRequest, createContext());
    expect(result.status).toBe(401);
  });

  it("does not require the admin role", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 2, role: "player" });
    vi.mocked(prisma.season.findMany).mockResolvedValue([]);
    const result = await listSeasons({} as HttpRequest, createContext());
    expect(result.status).toBe(200);
    expect(requireAuth).toHaveBeenCalledWith({});
  });

  it("returns 200 with all seasons", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
    const createdAt = new Date();
    vi.mocked(prisma.season.findMany).mockResolvedValue([
      { id: 2, name: "Summer 2026", roundType: "double", status: "active", createdAt },
      { id: 1, name: "Winter 2025", roundType: "single", status: "archived", createdAt },
    ]);

    const result = await listSeasons({} as HttpRequest, createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({
      seasons: [
        { id: 2, name: "Summer 2026", roundType: "double", status: "active", createdAt },
        { id: 1, name: "Winter 2025", roundType: "single", status: "archived", createdAt },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/functions/seasons/list.ts` does not exist.

- [ ] **Step 3: Create `api/src/functions/seasons/list.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

export async function listSeasons(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request);

    const seasons = await prisma.season.findMany({ orderBy: { createdAt: "desc" } });

    return {
      status: 200,
      jsonBody: {
        seasons: seasons.map((season) => ({
          id: season.id,
          name: season.name,
          roundType: season.roundType,
          status: season.status,
          createdAt: season.createdAt,
        })),
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`GET /api/seasons failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("seasonsList", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "seasons",
  handler: listSeasons,
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole suite passes, including 3 new tests in `list.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/functions/seasons/list.ts test/functions/seasons/list.test.ts
git commit -m "Add GET /api/seasons endpoint to list seasons"
```

---

### Task 5: `GET /api/seasons/{id}` (season detail)

**Files:**
- Create: `api/src/functions/seasons/get.ts`
- Test: `api/test/functions/seasons/get.test.ts`

**Interfaces:**
- Consumes: `prisma`, `requireAuth`/`AuthError`.
- Produces: `getSeason` — named export, registered on route `GET /api/seasons/{id}`. `200` with `{ season: { id, name, roundType, status, participants: Array<{id, displayName}>, matches: Array<{id, roundNumber, date, status, player1: {id,displayName}, player2: {id,displayName}}> } }` for any authenticated user; `404` if not found; `401` if unauthenticated. Task 8's `getSeason()` frontend function and Tasks 11/13's pages consume this exact response shape.

- [ ] **Step 1: Write the failing test — `api/test/functions/seasons/get.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { getSeason } from "../../../src/functions/seasons/get";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { season: { findUnique: vi.fn() } },
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

describe("getSeason function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 2, role: "player" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await getSeason(createRequest("1"), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 400 when the id is invalid", async () => {
    const result = await getSeason(createRequest("abc"), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the season doesn't exist", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue(null);
    const result = await getSeason(createRequest("999"), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 200 with participants and matches, resolving display names", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue({
      id: 1,
      name: "Spring 2026",
      roundType: "single",
      status: "active",
      participants: [
        { user: { id: 1, displayName: "Administrator" } },
        { user: { id: 2, displayName: "Bob Smith" } },
      ],
      matches: [
        {
          id: 101,
          roundNumber: 1,
          date: new Date("2026-08-01"),
          status: "scheduled",
          player1: { id: 1, displayName: "Administrator" },
          player2: { id: 2, displayName: "Bob Smith" },
        },
      ],
    });

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
            status: "scheduled",
            player1: { id: 1, displayName: "Administrator" },
            player2: { id: 2, displayName: "Bob Smith" },
          },
        ],
      },
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/functions/seasons/get.ts` does not exist.

- [ ] **Step 3: Create `api/src/functions/seasons/get.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

export async function getSeason(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request);

    const seasonId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(seasonId)) {
      return { status: 400, jsonBody: { error: "Invalid season id" } };
    }

    const season = await prisma.season.findUnique({
      where: { id: seasonId },
      include: {
        participants: { include: { user: true } },
        matches: {
          include: { player1: true, player2: true },
          orderBy: [{ roundNumber: "asc" }, { id: "asc" }],
        },
      },
    });

    if (!season) {
      return { status: 404, jsonBody: { error: "Season not found" } };
    }

    return {
      status: 200,
      jsonBody: {
        season: {
          id: season.id,
          name: season.name,
          roundType: season.roundType,
          status: season.status,
          participants: season.participants.map((p) => ({ id: p.user.id, displayName: p.user.displayName })),
          matches: season.matches.map((m) => ({
            id: m.id,
            roundNumber: m.roundNumber,
            date: m.date,
            status: m.status,
            player1: { id: m.player1.id, displayName: m.player1.displayName },
            player2: { id: m.player2.id, displayName: m.player2.displayName },
          })),
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`GET /api/seasons/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("seasonsGet", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "seasons/{id}",
  handler: getSeason,
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole suite passes, including 4 new tests in `get.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/functions/seasons/get.ts test/functions/seasons/get.test.ts
git commit -m "Add GET /api/seasons/{id} endpoint for season detail"
```

---

### Task 6: `PATCH /api/seasons/{id}` (archive a season)

**Files:**
- Create: `api/src/functions/seasons/archive.ts`
- Test: `api/test/functions/seasons/archive.test.ts`

**Interfaces:**
- Consumes: `prisma`, `requireAuth`/`AuthError`.
- Produces: `archiveSeason` — named export, registered on route `PATCH /api/seasons/{id}`. Request body `{ status: "archived" }`. `200` with `{ season: {id, name, roundType, status} }` on success; `400` for an invalid id, invalid `status` value, or archiving an already-archived season; `404` if not found; `401`/`403` via `requireAuth`.

- [ ] **Step 1: Write the failing test — `api/test/functions/seasons/archive.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { archiveSeason } from "../../../src/functions/seasons/archive";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { season: { findUnique: vi.fn(), update: vi.fn() } },
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

const activeSeason = { id: 1, name: "Spring 2026", roundType: "single", status: "active" };

describe("archiveSeason function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await archiveSeason(createRequest("1", { status: "archived" }), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the id is invalid", async () => {
    const result = await archiveSeason(createRequest("abc", { status: "archived" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when status is not 'archived'", async () => {
    const result = await archiveSeason(createRequest("1", { status: "active" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the season doesn't exist", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue(null);
    const result = await archiveSeason(createRequest("999", { status: "archived" }), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 400 when the season is already archived", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue({ ...activeSeason, status: "archived" });
    const result = await archiveSeason(createRequest("1", { status: "archived" }), createContext());
    expect(result.status).toBe(400);
    expect(prisma.season.update).not.toHaveBeenCalled();
  });

  it("returns 200 with the archived season on success", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue(activeSeason);
    vi.mocked(prisma.season.update).mockResolvedValue({ ...activeSeason, status: "archived" });

    const result = await archiveSeason(createRequest("1", { status: "archived" }), createContext());

    expect(result.status).toBe(200);
    expect(prisma.season.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: "archived" } });
    expect(result.jsonBody).toEqual({
      season: { id: 1, name: "Spring 2026", roundType: "single", status: "archived" },
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/functions/seasons/archive.ts` does not exist.

- [ ] **Step 3: Create `api/src/functions/seasons/archive.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

type ArchiveSeasonBody = {
  status?: unknown;
};

export async function archiveSeason(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    const seasonId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(seasonId)) {
      return { status: 400, jsonBody: { error: "Invalid season id" } };
    }

    let body: ArchiveSeasonBody;
    try {
      body = (await request.json()) as ArchiveSeasonBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    if (body.status !== "archived") {
      return { status: 400, jsonBody: { error: "status must be 'archived'" } };
    }

    const existing = await prisma.season.findUnique({ where: { id: seasonId } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Season not found" } };
    }
    if (existing.status !== "active") {
      return { status: 400, jsonBody: { error: "Only an active season can be archived" } };
    }

    const season = await prisma.season.update({ where: { id: seasonId }, data: { status: "archived" } });

    return {
      status: 200,
      jsonBody: {
        season: { id: season.id, name: season.name, roundType: season.roundType, status: season.status },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`PATCH /api/seasons/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("seasonsArchive", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "seasons/{id}",
  handler: archiveSeason,
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole suite passes, including 6 new tests in `archive.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/functions/seasons/archive.ts test/functions/seasons/archive.test.ts
git commit -m "Add PATCH /api/seasons/{id} endpoint to archive a season"
```

---

### Task 7: `PATCH /api/matches/{id}` (reschedule/cancel a match)

**Files:**
- Create: `api/src/functions/matches/update.ts`
- Test: `api/test/functions/matches/update.test.ts`

**Interfaces:**
- Consumes: `prisma`, `requireAuth`/`AuthError`.
- Produces: `updateMatch` — named export, registered on route `PATCH /api/matches/{id}`. Request body `{ date?, status? }`. `200` with `{ match: {id, roundNumber, date, status, player1Id, player2Id} }` on success; `400` for an invalid id, invalid body, no fields provided, or a match whose season isn't active; `404` if not found; `401`/`403` via `requireAuth`.

- [ ] **Step 1: Write the failing test — `api/test/functions/matches/update.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { updateMatch } from "../../../src/functions/matches/update";
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

const scheduledMatch = {
  id: 101,
  roundNumber: 1,
  date: new Date("2026-08-01"),
  player1Id: 1,
  player2Id: 2,
  status: "scheduled",
  season: { id: 1, status: "active" },
};

describe("updateMatch function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await updateMatch(createRequest("101", { status: "cancelled" }), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the id is invalid", async () => {
    const result = await updateMatch(createRequest("abc", { status: "cancelled" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the match doesn't exist", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
    const result = await updateMatch(createRequest("999", { status: "cancelled" }), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 400 when the match's season is archived", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      ...scheduledMatch,
      season: { id: 1, status: "archived" },
    });
    const result = await updateMatch(createRequest("101", { status: "cancelled" }), createContext());
    expect(result.status).toBe(400);
    expect(prisma.match.update).not.toHaveBeenCalled();
  });

  it("returns 400 when date is not a valid date", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(scheduledMatch);
    const result = await updateMatch(createRequest("101", { date: "not-a-date" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when status is not 'scheduled' or 'cancelled'", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(scheduledMatch);
    const result = await updateMatch(createRequest("101", { status: "played" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when neither date nor status is provided", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(scheduledMatch);
    const result = await updateMatch(createRequest("101", {}), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 200 and reschedules the match", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(scheduledMatch);
    vi.mocked(prisma.match.update).mockResolvedValue({ ...scheduledMatch, date: new Date("2026-08-15") });

    const result = await updateMatch(createRequest("101", { date: "2026-08-15" }), createContext());

    expect(result.status).toBe(200);
    expect(prisma.match.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { date: new Date("2026-08-15") },
    });
  });

  it("returns 200 and cancels the match", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(scheduledMatch);
    vi.mocked(prisma.match.update).mockResolvedValue({ ...scheduledMatch, status: "cancelled" });

    const result = await updateMatch(createRequest("101", { status: "cancelled" }), createContext());

    expect(result.status).toBe(200);
    expect(prisma.match.update).toHaveBeenCalledWith({ where: { id: 101 }, data: { status: "cancelled" } });
    const body = result.jsonBody as { match: { status: string } };
    expect(body.match.status).toBe("cancelled");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/functions/matches/update.ts` does not exist.

- [ ] **Step 3: Create `api/src/functions/matches/update.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

type UpdateMatchBody = {
  date?: unknown;
  status?: unknown;
};

function isMatchStatus(value: unknown): value is "scheduled" | "cancelled" {
  return value === "scheduled" || value === "cancelled";
}

export async function updateMatch(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    const matchId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(matchId)) {
      return { status: 400, jsonBody: { error: "Invalid match id" } };
    }

    let body: UpdateMatchBody;
    try {
      body = (await request.json()) as UpdateMatchBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    const existing = await prisma.match.findUnique({ where: { id: matchId }, include: { season: true } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Match not found" } };
    }
    if (existing.season.status !== "active") {
      return { status: 400, jsonBody: { error: "Cannot modify a match in an archived season" } };
    }

    const data: { date?: Date; status?: "scheduled" | "cancelled" } = {};

    if (body.date !== undefined) {
      if (typeof body.date !== "string" || Number.isNaN(Date.parse(body.date))) {
        return { status: 400, jsonBody: { error: "date must be a valid date" } };
      }
      data.date = new Date(body.date);
    }

    if (body.status !== undefined) {
      if (!isMatchStatus(body.status)) {
        return { status: 400, jsonBody: { error: "status must be 'scheduled' or 'cancelled'" } };
      }
      data.status = body.status;
    }

    if (Object.keys(data).length === 0) {
      return { status: 400, jsonBody: { error: "date or status is required" } };
    }

    const match = await prisma.match.update({ where: { id: matchId }, data });

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
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`PATCH /api/matches/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("matchesUpdate", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "matches/{id}",
  handler: updateMatch,
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole suite passes, including 9 new tests in `update.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/functions/matches/update.ts test/functions/matches/update.test.ts
git commit -m "Add PATCH /api/matches/{id} endpoint to reschedule or cancel a match"
```

---

### Task 8: Frontend API client and round-count helper

**Files:**
- Modify: `src/lib/api-client.ts`
- Modify: `src/lib/api-client.test.ts`
- Create: `src/lib/roundRobin.ts`
- Test: `src/lib/roundRobin.test.ts`

**Interfaces:**
- Produces from `src/lib/api-client.ts`: `SeasonParticipantSummary` (`{id, displayName}`), `SeasonMatch` (`{id, roundNumber, date, status: "scheduled"|"cancelled", player1: SeasonParticipantSummary, player2: SeasonParticipantSummary}`), `Season` (`{id, name, roundType: "single"|"double", status: "active"|"archived", participants: SeasonParticipantSummary[], matches: SeasonMatch[]}`), `SeasonSummary` (`{id, name, roundType, status, createdAt}`), `CreateSeasonInput` (`{name, roundType, participantIds: number[], roundDates: string[]}`), `UpdateMatchInput` (`{date?, status?}`), `listSeasons(): Promise<SeasonSummary[]>`, `getSeason(id): Promise<Season>`, `createSeason(input): Promise<Season>`, `archiveSeason(id): Promise<Season>`, `updateMatch(id, input): Promise<SeasonMatch>`.
- Produces from `src/lib/roundRobin.ts`: `RoundType`, `computeRoundCount(participantCount, roundType): number` — same formula as the backend's Task 2 (intentionally duplicated: separate deployable frontend/backend packages, not a shared module). Tasks 9–13 import from both files.

- [ ] **Step 1: Write the failing tests — append to `src/lib/api-client.test.ts`**

Add these imports alongside the existing ones at the top of the file:

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
} from "./api-client";
```

Add these `describe` blocks at the end of the file, inside the existing outer `describe("api-client", ...)` block:

```typescript
  describe("listSeasons", () => {
    it("fetches and returns all seasons", async () => {
      const seasons = [
        { id: 2, name: "Summer 2026", roundType: "double", status: "active", createdAt: "2026-06-01T00:00:00.000Z" },
      ];
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ seasons }), { status: 200 }));

      const result = await listSeasons();

      expect(fetch).toHaveBeenCalledWith("/api/seasons", expect.objectContaining({ credentials: "same-origin" }));
      expect(result).toEqual(seasons);
    });
  });

  describe("getSeason", () => {
    it("fetches and returns one season", async () => {
      const season = { id: 1, name: "Spring 2026", roundType: "single", status: "active", participants: [], matches: [] };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ season }), { status: 200 }));

      const result = await getSeason(1);

      expect(fetch).toHaveBeenCalledWith("/api/seasons/1", expect.objectContaining({ credentials: "same-origin" }));
      expect(result).toEqual(season);
    });
  });

  describe("createSeason", () => {
    it("posts the new season and returns it", async () => {
      const season = { id: 1, name: "Spring 2026", roundType: "single", status: "active", participants: [], matches: [] };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ season }), { status: 201 }));

      const input = { name: "Spring 2026", roundType: "single" as const, participantIds: [1, 2], roundDates: ["2026-08-01"] };
      const result = await createSeason(input);

      expect(fetch).toHaveBeenCalledWith(
        "/api/seasons",
        expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify(input) })
      );
      expect(result).toEqual(season);
    });

    it("throws the server's error message on failure", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: "A season is already active" }), { status: 409 })
      );

      await expect(
        createSeason({ name: "X", roundType: "single", participantIds: [1, 2], roundDates: ["2026-08-01"] })
      ).rejects.toThrow("A season is already active");
    });
  });

  describe("archiveSeason", () => {
    it("patches the season status to archived", async () => {
      const season = { id: 1, name: "Spring 2026", roundType: "single", status: "archived", participants: [], matches: [] };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ season }), { status: 200 }));

      const result = await archiveSeason(1);

      expect(fetch).toHaveBeenCalledWith(
        "/api/seasons/1",
        expect.objectContaining({
          method: "PATCH",
          credentials: "same-origin",
          body: JSON.stringify({ status: "archived" }),
        })
      );
      expect(result).toEqual(season);
    });
  });

  describe("updateMatch", () => {
    it("patches the match and returns it", async () => {
      const match = { id: 101, roundNumber: 1, date: "2026-08-15", status: "scheduled", player1: { id: 1, displayName: "A" }, player2: { id: 2, displayName: "B" } };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ match }), { status: 200 }));

      const result = await updateMatch(101, { date: "2026-08-15" });

      expect(fetch).toHaveBeenCalledWith(
        "/api/matches/101",
        expect.objectContaining({
          method: "PATCH",
          credentials: "same-origin",
          body: JSON.stringify({ date: "2026-08-15" }),
        })
      );
      expect(result).toEqual(match);
    });
  });
```

Also create the failing test for the round-count helper — `src/lib/roundRobin.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeRoundCount } from "./roundRobin";

describe("computeRoundCount", () => {
  it("returns n-1 for an even roster, single round", () => {
    expect(computeRoundCount(4, "single")).toBe(3);
  });

  it("returns n for an odd roster, single round", () => {
    expect(computeRoundCount(5, "single")).toBe(5);
  });

  it("doubles the round count for double round type", () => {
    expect(computeRoundCount(4, "double")).toBe(6);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `listSeasons`/`getSeason`/`createSeason`/`archiveSeason`/`updateMatch` are not exported from `./api-client`, and `src/lib/roundRobin.ts` does not exist.

- [ ] **Step 3: Create `src/lib/roundRobin.ts`**

```typescript
export type RoundType = "single" | "double";

export function computeRoundCount(participantCount: number, roundType: RoundType): number {
  const evenCount = participantCount % 2 === 0 ? participantCount : participantCount + 1;
  const singleRoundCount = evenCount - 1;
  return roundType === "double" ? singleRoundCount * 2 : singleRoundCount;
}
```

- [ ] **Step 4: Append the new types and functions to `src/lib/api-client.ts`**

Append this to the end of the file (after the existing `updateMember` function):

```typescript
export type SeasonParticipantSummary = {
  id: number;
  displayName: string;
};

export type SeasonMatch = {
  id: number;
  roundNumber: number;
  date: string;
  status: "scheduled" | "cancelled";
  player1: SeasonParticipantSummary;
  player2: SeasonParticipantSummary;
};

export type Season = {
  id: number;
  name: string;
  roundType: "single" | "double";
  status: "active" | "archived";
  participants: SeasonParticipantSummary[];
  matches: SeasonMatch[];
};

export type SeasonSummary = {
  id: number;
  name: string;
  roundType: "single" | "double";
  status: "active" | "archived";
  createdAt: string;
};

export type CreateSeasonInput = {
  name: string;
  roundType: "single" | "double";
  participantIds: number[];
  roundDates: string[];
};

export type UpdateMatchInput = {
  date?: string;
  status?: "scheduled" | "cancelled";
};

export async function listSeasons(): Promise<SeasonSummary[]> {
  const response = await fetch("/api/seasons", { credentials: "same-origin" });
  const data = await parseJsonResponse<{ seasons: SeasonSummary[] }>(response);
  return data.seasons;
}

export async function getSeason(id: number): Promise<Season> {
  const response = await fetch(`/api/seasons/${id}`, { credentials: "same-origin" });
  const data = await parseJsonResponse<{ season: Season }>(response);
  return data.season;
}

export async function createSeason(input: CreateSeasonInput): Promise<Season> {
  const response = await fetch("/api/seasons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ season: Season }>(response);
  return data.season;
}

export async function archiveSeason(id: number): Promise<Season> {
  const response = await fetch(`/api/seasons/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ status: "archived" }),
  });
  const data = await parseJsonResponse<{ season: Season }>(response);
  return data.season;
}

export async function updateMatch(id: number, input: UpdateMatchInput): Promise<SeasonMatch> {
  const response = await fetch(`/api/matches/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ match: SeasonMatch }>(response);
  return data.match;
}
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including 6 new tests in `api-client.test.ts` and 3 new tests in `roundRobin.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api-client.ts src/lib/api-client.test.ts src/lib/roundRobin.ts src/lib/roundRobin.test.ts
git commit -m "Add frontend API client functions and round-count helper for seasons"
```

---

### Task 9: `RoundRobinSchedule` shared component

**Files:**
- Create: `src/pages/season/RoundRobinSchedule.tsx`
- Test: `src/pages/season/RoundRobinSchedule.test.tsx`

**Interfaces:**
- Consumes: `type SeasonMatch`, `type SeasonParticipantSummary` (Task 8).
- Produces: default-exported `RoundRobinSchedule` component with props `{ matches: SeasonMatch[]; participants: SeasonParticipantSummary[]; renderMatchActions?: (match: SeasonMatch) => React.ReactNode }`. Groups matches by `roundNumber` (ascending), shows "Round N" headings, each match as "`player1` vs `player2`", a bye line for any participant with no match that round, and a "cancelled" marker when `match.status === "cancelled"`. When `renderMatchActions` is provided, its return value replaces the default date text for each match (used by Task 11 to inject admin controls); when omitted, each match shows its formatted date. Tasks 11 and 13 both render this component.

- [ ] **Step 1: Write the failing test — `src/pages/season/RoundRobinSchedule.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import RoundRobinSchedule from "./RoundRobinSchedule";
import type { SeasonMatch, SeasonParticipantSummary } from "../../lib/api-client";

const participants: SeasonParticipantSummary[] = [
  { id: 1, displayName: "Administrator" },
  { id: 2, displayName: "Bob Smith" },
  { id: 3, displayName: "Carol Smith" },
];

const matches: SeasonMatch[] = [
  {
    id: 101,
    roundNumber: 1,
    date: "2026-08-01",
    status: "scheduled",
    player1: { id: 1, displayName: "Administrator" },
    player2: { id: 2, displayName: "Bob Smith" },
  },
  {
    id: 102,
    roundNumber: 2,
    date: "2026-08-08",
    status: "cancelled",
    player1: { id: 1, displayName: "Administrator" },
    player2: { id: 3, displayName: "Carol Smith" },
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

  it("renders the formatted date by default", () => {
    render(<RoundRobinSchedule matches={[matches[0]]} participants={participants} />);
    expect(screen.getByText(new Date("2026-08-01").toLocaleDateString())).toBeInTheDocument();
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
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/pages/season/RoundRobinSchedule.tsx` does not exist.

- [ ] **Step 3: Create `src/pages/season/RoundRobinSchedule.tsx`**

```tsx
import type { ReactNode } from "react";
import type { SeasonMatch, SeasonParticipantSummary } from "../../lib/api-client";

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
        const byePlayer = participants.find(
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
                    {renderMatchActions ? renderMatchActions(match) : new Date(match.date).toLocaleDateString()}
                    {match.status === "cancelled" && <span className="text-red-600">cancelled</span>}
                  </span>
                </li>
              ))}
              {byePlayer && <li className="py-2 text-sm text-gray-500">{byePlayer.displayName}: bye</li>}
            </ul>
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including 6 new tests in `RoundRobinSchedule.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/season/RoundRobinSchedule.tsx src/pages/season/RoundRobinSchedule.test.tsx
git commit -m "Add shared RoundRobinSchedule component"
```

---

### Task 10: New season page

**Files:**
- Create: `src/pages/season/NewSeason.tsx`
- Test: `src/pages/season/NewSeason.test.tsx`

**Interfaces:**
- Consumes: `listMembers`, `type Member` (Member Management phase), `createSeason`, `type CreateSeasonInput` (Task 8), `computeRoundCount`, `type RoundType` (Task 8), `useNavigate` (`react-router-dom`).
- Produces: `NewSeason` — default-exported component. Fetches active members on mount; lets the admin pick a round type and a roster via checkboxes; once at least 2 are selected, renders one date input per computed round (via `computeRoundCount`); on submit calls `createSeason` and navigates to `/season`. Task 14 registers this on the `/season/new` route.

- [ ] **Step 1: Write the failing test — `src/pages/season/NewSeason.test.tsx`**

```tsx
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import NewSeason from "./NewSeason";
import * as apiClient from "../../lib/api-client";

vi.mock("../../lib/api-client");

const members = [
  { id: 1, username: "admin", displayName: "Administrator", role: "admin" as const, isActive: true },
  { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player" as const, isActive: true },
  { id: 3, username: "csmith", displayName: "Carol Smith", role: "player" as const, isActive: true },
  { id: 4, username: "dsmith", displayName: "Dave Smith", role: "player" as const, isActive: true },
  { id: 5, username: "old", displayName: "Old Player", role: "player" as const, isActive: false },
];

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={["/season/new"]}>
      <Routes>
        <Route path="/season/new" element={<NewSeason />} />
        <Route path="/season" element={<div>Season page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

async function selectFourPlayers() {
  await userEvent.click(screen.getByLabelText("Administrator"));
  await userEvent.click(screen.getByLabelText("Bob Smith"));
  await userEvent.click(screen.getByLabelText("Carol Smith"));
  await userEvent.click(screen.getByLabelText("Dave Smith"));
}

describe("NewSeason", () => {
  it("lists only active members as selectable participants", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter();
    await waitFor(() => expect(screen.getByLabelText("Administrator")).toBeInTheDocument());
    expect(screen.queryByLabelText("Old Player")).not.toBeInTheDocument();
  });

  it("renders 3 date inputs after selecting 4 participants with single round type", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter();
    await waitFor(() => screen.getByLabelText("Administrator"));

    await selectFourPlayers();

    expect(screen.getByText("Round 1")).toBeInTheDocument();
    expect(screen.getByText("Round 2")).toBeInTheDocument();
    expect(screen.getByText("Round 3")).toBeInTheDocument();
    expect(screen.queryByText("Round 4")).not.toBeInTheDocument();
  });

  it("renders 6 date inputs after selecting 4 participants with double round type", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter();
    await waitFor(() => screen.getByLabelText("Administrator"));

    await userEvent.selectOptions(screen.getByLabelText("Round type"), "double");
    await selectFourPlayers();

    expect(screen.getByText("Round 6")).toBeInTheDocument();
    expect(screen.queryByText("Round 7")).not.toBeInTheDocument();
  });

  it("blocks submission with fewer than 2 participants", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter();
    await waitFor(() => screen.getByLabelText("Administrator"));

    await userEvent.type(screen.getByLabelText("Name"), "Spring 2026");
    await userEvent.click(screen.getByLabelText("Administrator"));
    await userEvent.click(screen.getByRole("button", { name: "Create Season" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Select at least 2 participants");
    expect(apiClient.createSeason).not.toHaveBeenCalled();
  });

  it("submits the season with entered dates and navigates to /season", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    vi.mocked(apiClient.createSeason).mockResolvedValue({
      id: 1,
      name: "Spring 2026",
      roundType: "single",
      status: "active",
      participants: [],
      matches: [],
    });
    renderWithRouter();
    await waitFor(() => screen.getByLabelText("Administrator"));

    await userEvent.type(screen.getByLabelText("Name"), "Spring 2026");
    await selectFourPlayers();
    const dateInputs = screen.getAllByLabelText(/^Round \d date$/);
    expect(dateInputs).toHaveLength(3);
    fireEvent.change(dateInputs[0], { target: { value: "2026-08-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-08-08" } });
    fireEvent.change(dateInputs[2], { target: { value: "2026-08-15" } });

    await userEvent.click(screen.getByRole("button", { name: "Create Season" }));

    await waitFor(() => {
      expect(apiClient.createSeason).toHaveBeenCalledWith({
        name: "Spring 2026",
        roundType: "single",
        participantIds: [1, 2, 3, 4],
        roundDates: ["2026-08-01", "2026-08-08", "2026-08-15"],
      });
    });
    await waitFor(() => expect(screen.getByText("Season page")).toBeInTheDocument());
  });

  it("shows an error message when createSeason rejects", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    vi.mocked(apiClient.createSeason).mockRejectedValue(new Error("A season is already active"));
    renderWithRouter();
    await waitFor(() => screen.getByLabelText("Administrator"));

    await userEvent.type(screen.getByLabelText("Name"), "Spring 2026");
    await selectFourPlayers();
    for (const input of screen.getAllByLabelText(/^Round \d date$/)) {
      fireEvent.change(input, { target: { value: "2026-08-01" } });
    }
    await userEvent.click(screen.getByRole("button", { name: "Create Season" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("A season is already active");
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/pages/season/NewSeason.tsx` does not exist.

- [ ] **Step 3: Create `src/pages/season/NewSeason.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { listMembers, createSeason, type Member } from "../../lib/api-client";
import { computeRoundCount, type RoundType } from "../../lib/roundRobin";

export default function NewSeason() {
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [roundType, setRoundType] = useState<RoundType>("single");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [roundDates, setRoundDates] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listMembers().then((all) => setMembers(all.filter((m) => m.isActive)));
  }, []);

  const roundCount = selectedIds.length >= 2 ? computeRoundCount(selectedIds.length, roundType) : 0;

  useEffect(() => {
    setRoundDates(Array(roundCount).fill(""));
  }, [roundCount]);

  function toggleParticipant(id: number) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function updateRoundDate(index: number, value: string) {
    setRoundDates((prev) => prev.map((d, i) => (i === index ? value : d)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (selectedIds.length < 2) {
      setError("Select at least 2 participants");
      return;
    }
    if (roundDates.some((d) => !d)) {
      setError("Every round needs a date");
      return;
    }

    setSubmitting(true);
    try {
      await createSeason({ name: name.trim(), roundType, participantIds: selectedIds, roundDates });
      navigate("/season");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create season");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">New Season</h1>
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium">
            Name
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 p-2"
          />
        </div>
        <div>
          <label htmlFor="roundType" className="block text-sm font-medium">
            Round type
          </label>
          <select
            id="roundType"
            value={roundType}
            onChange={(e) => setRoundType(e.target.value as RoundType)}
            className="mt-1 w-full rounded border border-gray-300 p-2"
          >
            <option value="single">Single (everyone plays once)</option>
            <option value="double">Double (everyone plays twice)</option>
          </select>
        </div>
        <fieldset>
          <legend className="block text-sm font-medium">Participants</legend>
          <div className="mt-1 space-y-1">
            {members.map((member) => (
              <label key={member.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(member.id)}
                  onChange={() => toggleParticipant(member.id)}
                />
                {member.displayName}
              </label>
            ))}
          </div>
        </fieldset>
        {roundCount > 0 && (
          <fieldset>
            <legend className="block text-sm font-medium">Round dates</legend>
            <div className="mt-1 space-y-2">
              {roundDates.map((date, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="w-20 text-sm text-gray-500">Round {index + 1}</span>
                  <input
                    id={`round-date-${index}`}
                    type="date"
                    aria-label={`Round ${index + 1} date`}
                    required
                    value={date}
                    onChange={(e) => updateRoundDate(index, e.target.value)}
                    className="rounded border border-gray-300 p-2"
                  />
                </div>
              ))}
            </div>
          </fieldset>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="bg-primary text-primary-content font-heading w-full rounded p-2 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create Season"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including 6 new tests in `NewSeason.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/season/NewSeason.tsx src/pages/season/NewSeason.test.tsx
git commit -m "Add New Season page"
```

---

### Task 11: Active season page

**Files:**
- Create: `src/pages/season/Season.tsx`
- Test: `src/pages/season/Season.test.tsx`

**Interfaces:**
- Consumes: `RoundRobinSchedule` (Task 9), `listSeasons`, `getSeason`, `archiveSeason`, `updateMatch`, `type Season` (Task 8), `useAuth` (`src/lib/AuthContext.tsx`).
- Produces: `SeasonPage` — default-exported component. Loads the active season (finds it via `listSeasons()` then `getSeason(id)`); shows an empty state with a "Create Season" link for admins (no link for players) when none exists. Renders the schedule via `RoundRobinSchedule`; when `user.role === "admin"`, passes `renderMatchActions` that shows a reschedule date input plus a Cancel/Restore button per match, and shows an "Archive Season" button above the schedule. Task 14 registers this on the `/season` route.

- [ ] **Step 1: Write the failing test — `src/pages/season/Season.test.tsx`**

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
  ],
  matches: [
    {
      id: 101,
      roundNumber: 1,
      date: "2026-08-01",
      status: "scheduled",
      player1: { id: 1, displayName: "Administrator" },
      player2: { id: 2, displayName: "Bob Smith" },
    },
  ],
};

function mockPlayer() {
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
    mockPlayer();
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
    mockPlayer();
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

  it("does not show reschedule/cancel controls or Archive Season for a player", async () => {
    mockPlayer();
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
  });

  it("cancels a match when the admin clicks Cancel", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.updateMatch).mockResolvedValue({ ...season.matches[0], status: "cancelled" });
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
Expected: FAIL — `src/pages/season/Season.tsx` does not exist.

- [ ] **Step 3: Create `src/pages/season/Season.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { listSeasons, getSeason, archiveSeason, updateMatch, type Season, type SeasonMatch } from "../../lib/api-client";
import RoundRobinSchedule from "./RoundRobinSchedule";

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
        renderMatchActions={
          user?.role === "admin"
            ? (match) => (
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
              )
            : undefined
        }
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including 6 new tests in `Season.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/season/Season.tsx src/pages/season/Season.test.tsx
git commit -m "Add active Season page with admin schedule controls"
```

---

### Task 12: Season archive list page

**Files:**
- Create: `src/pages/season/SeasonArchive.tsx`
- Test: `src/pages/season/SeasonArchive.test.tsx`

**Interfaces:**
- Consumes: `listSeasons`, `type SeasonSummary` (Task 8).
- Produces: `SeasonArchive` — default-exported component. Fetches all seasons on mount, shows only `status: "archived"` ones, each linking to `/seasons/{id}`. Task 14 registers this on the `/seasons` route.

- [ ] **Step 1: Write the failing test — `src/pages/season/SeasonArchive.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import SeasonArchive from "./SeasonArchive";
import * as apiClient from "../../lib/api-client";

vi.mock("../../lib/api-client");

describe("SeasonArchive", () => {
  it("lists only archived seasons, linking to their detail page", async () => {
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 2, name: "Summer 2026", roundType: "double", status: "active", createdAt: "2026-06-01" },
      { id: 1, name: "Winter 2025", roundType: "single", status: "archived", createdAt: "2025-11-01" },
    ]);

    render(
      <MemoryRouter>
        <SeasonArchive />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("Winter 2025")).toBeInTheDocument());
    expect(screen.queryByText("Summer 2026")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Winter 2025/ })).toHaveAttribute("href", "/seasons/1");
  });

  it("shows an empty state when there are no archived seasons", async () => {
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 2, name: "Summer 2026", roundType: "double", status: "active", createdAt: "2026-06-01" },
    ]);

    render(
      <MemoryRouter>
        <SeasonArchive />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText("No archived seasons yet.")).toBeInTheDocument());
  });

  it("shows an error message when loading fails", async () => {
    vi.mocked(apiClient.listSeasons).mockRejectedValue(new Error("Failed to load seasons"));

    render(
      <MemoryRouter>
        <SeasonArchive />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to load seasons");
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/pages/season/SeasonArchive.tsx` does not exist.

- [ ] **Step 3: Create `src/pages/season/SeasonArchive.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listSeasons, type SeasonSummary } from "../../lib/api-client";

export default function SeasonArchive() {
  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSeasons()
      .then((all) => setSeasons(all.filter((s) => s.status === "archived")))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load seasons"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">Season Archive</h1>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading…</p>
      ) : seasons.length === 0 ? (
        <p>No archived seasons yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {seasons.map((season) => (
            <li key={season.id}>
              <Link to={`/seasons/${season.id}`} className="flex items-center justify-between py-3">
                <span>{season.name}</span>
                <span className="text-sm text-gray-500">{season.roundType}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including 3 new tests in `SeasonArchive.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/season/SeasonArchive.tsx src/pages/season/SeasonArchive.test.tsx
git commit -m "Add Season Archive list page"
```

---

### Task 13: Archived season detail page

**Files:**
- Create: `src/pages/season/SeasonDetail.tsx`
- Test: `src/pages/season/SeasonDetail.test.tsx`

**Interfaces:**
- Consumes: `RoundRobinSchedule` (Task 9), `getSeason`, `type Season` (Task 8), `useParams` (`react-router-dom`).
- Produces: `SeasonDetail` — default-exported component. Reads `id` from the route, calls `getSeason(id)`, renders the schedule read-only via `RoundRobinSchedule` (no `renderMatchActions`). Task 14 registers this on the `/seasons/:id` route.

- [ ] **Step 1: Write the failing test — `src/pages/season/SeasonDetail.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import SeasonDetail from "./SeasonDetail";
import * as apiClient from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithRouter(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/seasons/${id}`]}>
      <Routes>
        <Route path="/seasons/:id" element={<SeasonDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("SeasonDetail", () => {
  it("renders the season's read-only schedule", async () => {
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      id: 1,
      name: "Winter 2025",
      roundType: "single",
      status: "archived",
      participants: [
        { id: 1, displayName: "Administrator" },
        { id: 2, displayName: "Bob Smith" },
      ],
      matches: [
        {
          id: 101,
          roundNumber: 1,
          date: "2025-12-01",
          status: "scheduled",
          player1: { id: 1, displayName: "Administrator" },
          player2: { id: 2, displayName: "Bob Smith" },
        },
      ],
    });

    renderWithRouter("1");

    await waitFor(() => expect(screen.getByText("Winter 2025")).toBeInTheDocument());
    expect(screen.getByText("Administrator vs Bob Smith")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("shows an error message when the season doesn't exist", async () => {
    vi.mocked(apiClient.getSeason).mockRejectedValue(new Error("Season not found"));

    renderWithRouter("999");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Season not found");
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/pages/season/SeasonDetail.tsx` does not exist.

- [ ] **Step 3: Create `src/pages/season/SeasonDetail.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSeason, type Season } from "../../lib/api-client";
import RoundRobinSchedule from "./RoundRobinSchedule";

export default function SeasonDetail() {
  const { id } = useParams<{ id: string }>();
  const [season, setSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getSeason(Number(id))
      .then(setSeason)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load season"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <p className="p-4">Loading…</p>;
  }

  if (error || !season) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        {error ?? "Season not found"}
      </p>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">{season.name}</h1>
      <RoundRobinSchedule matches={season.matches} participants={season.participants} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including 2 new tests in `SeasonDetail.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/season/SeasonDetail.tsx src/pages/season/SeasonDetail.test.tsx
git commit -m "Add read-only archived Season detail page"
```

---

### Task 14: Wire `App.tsx` routing and the `Home.tsx` navigation link

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/pages/Home.tsx`
- Modify: `src/pages/Home.test.tsx`

**Interfaces:**
- Consumes: `SeasonPage` (Task 11), `NewSeason` (Task 10), `SeasonArchive` (Task 12), `SeasonDetail` (Task 13).
- Produces: `App` now registers `/season`, `/seasons`, `/seasons/:id` behind `ProtectedRoute`, and `/season/new` behind `AdminRoute`. `Home` renders a "Season" link visible to every logged-in user (not role-gated).

- [ ] **Step 1: Write the failing test — add to `src/pages/Home.test.tsx`**

Add this test inside the existing `describe("Home navigation", ...)` block added by the Member Management phase (after its two existing tests):

```tsx
  it("shows a Season link for every logged-in user, admin or player", () => {
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
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — no "Season" link exists yet.

- [ ] **Step 3: Update `src/pages/Home.tsx`**

```tsx
import { Link } from "react-router-dom";
import { branding } from "../branding";
import { useAuth } from "../lib/AuthContext";

export default function Home() {
  const { user, logout } = useAuth();

  return (
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
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including the 1 new test in `Home.test.tsx`.

- [ ] **Step 5: Update `src/App.tsx`**

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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Home />} />
            <Route path="/season" element={<SeasonPage />} />
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

- [ ] **Step 6: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS — all frontend tests passing.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/pages/Home.tsx src/pages/Home.test.tsx
git commit -m "Wire season routes into App and link from Home"
```

---

### Task 15: Manual end-to-end verification

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
Wait for it to log all functions, including `seasonsCreate`, `seasonsList`, `seasonsGet`, `seasonsArchive`, `matchesUpdate`, plus the existing `authLogin`/`authMe`/`authLogout`/`usersList`/`usersCreate`/`usersUpdate`/`health`.

From the repo root (separate terminal):
```bash
npm run dev:swa -- --api-devserver-url http://localhost:7071
```
If `func start` fails with a Functions Core Tools download error, see the local-dev workaround from prior phases (install `azure-functions-core-tools@4` globally and manually extract its zip if the postinstall step doesn't).

- [ ] **Step 2: Ensure the admin account and at least 4 active players exist**

From `api/`:
```bash
npm run db:seed
```
Then, logged in as admin (see Step 3), use the `/admin/members` UI (or `curl -b cookies.txt -X POST http://localhost:4280/api/users ...`) to create 3 additional active player accounts if they don't already exist, so there are at least 4 active members to build a season around.

- [ ] **Step 3: Verify the new endpoints via curl**

```bash
curl -i -c cookies.txt -X POST http://localhost:4280/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"ChangeMe123!"}'
```
Expected: `200` with a `Set-Cookie: authToken=...`.

```bash
curl -i -b cookies.txt -X POST http://localhost:4280/api/seasons \
  -H "Content-Type: application/json" \
  -d '{"name":"Spring 2026","roundType":"single","participantIds":[1,2,3,4],"roundDates":["2026-08-01","2026-08-08","2026-08-15"]}'
```
Expected: `201` with the created season, 3 rounds, 6 matches. Note the season `id`.

```bash
curl -i -b cookies.txt -X POST http://localhost:4280/api/seasons \
  -H "Content-Type: application/json" \
  -d '{"name":"Duplicate Attempt","roundType":"single","participantIds":[1,2,3,4],"roundDates":["2026-09-01","2026-09-08","2026-09-15"]}'
```
Expected: `409` (a season is already active).

```bash
curl -i -b cookies.txt http://localhost:4280/api/seasons/<season-id>
```
Expected: `200` with participants and matches, resolved display names.

```bash
curl -i -b cookies.txt -X PATCH http://localhost:4280/api/matches/<match-id> \
  -H "Content-Type: application/json" \
  -d '{"status":"cancelled"}'
```
Expected: `200` with `status: "cancelled"`.

```bash
curl -i -b cookies.txt -X PATCH http://localhost:4280/api/seasons/<season-id> \
  -H "Content-Type: application/json" \
  -d '{"status":"archived"}'
```
Expected: `200` with `status: "archived"`.

```bash
curl -i -b cookies.txt -X PATCH http://localhost:4280/api/matches/<match-id> \
  -H "Content-Type: application/json" \
  -d '{"status":"scheduled"}'
```
Expected: `400` (cannot modify a match in an archived season).

- [ ] **Step 4: Verify the browser flow with Playwright MCP**

Log in as `admin`. Confirm a "Season" link appears on the home page (before creating anything) leading to an empty state with a "Create Season" link. Click it.

On `/season/new`: pick "Single" round type, select 5 active members (an odd number, to exercise the bye), confirm exactly 5 date inputs appear, fill them all in, submit. Confirm it navigates to `/season` and shows 5 rounds with 2 matches each and one "bye" line per round.

On `/season`: reschedule one match's date and confirm the change persists after a reload. Cancel one match and confirm it shows "cancelled" and a "Restore" button appears in its place; click Restore and confirm it reverts.

Click "Archive Season". Confirm `/season` now shows the empty state again (with "Create Season" since still logged in as admin). Navigate to `/seasons`, confirm the archived season is listed, click into it, confirm the same schedule renders read-only (no reschedule/cancel controls, no Archive Season button).

Log out and log in as a non-admin active player. Confirm the "Season" link is visible (unlike "Manage Members"), the empty state (if no active season) shows no "Create Season" link, and navigating directly to `/season/new` redirects to `/` (via `AdminRoute`).

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

- **Spec coverage:** implements every section of `docs/superpowers/specs/2026-07-20-season-schedule-design.md` — Section 2 (data model, roster lock, no `Round` entity, un-persisted byes, single-active-season enforcement) in Task 1 (schema) and Task 3 (the `409` check); Section 3 (round-robin algorithm) in Task 2 and its backend tests, mirrored by the frontend's `computeRoundCount` in Task 8; Section 4 (all five endpoints and their status codes) in Tasks 3–7; Section 5 (API client, routes, shared `RoundRobinSchedule`, nav link) in Tasks 8–14; Section 6 (error handling: empty state, `409`, odd roster, archived-season freeze) is exercised throughout Tasks 3–13's tests and Task 15's manual pass; Section 7 (testing approach) is Tasks 1–15 themselves.
- **Placeholder scan:** no TBD/TODO markers. Every step has runnable code or an exact command with an expected result.
- **Type consistency:** `Season`/`SeasonSummary`/`SeasonMatch`/`SeasonParticipantSummary`/`CreateSeasonInput`/`UpdateMatchInput` (Task 8) are the single source of truth for the API shapes, consumed identically by Tasks 9–13. `RoundType`/`computeRoundCount` appear in both `api/src/lib/roundRobin.ts` (Task 2) and `src/lib/roundRobin.ts` (Task 8) with the same formula — an intentional duplication across the two separate deployable packages (Azure Functions API vs. Vite frontend bundle), not a DRY violation within either package. The backend's `RoundRobinMatch` (`roundNumber`, `player1Id`, `player2Id`) and the frontend's `SeasonMatch` (adds `id`, `date`, `status`, resolved `player1`/`player2` objects) are deliberately different shapes — the backend type is the generator's internal pairing output; the frontend type is the persisted, API-resolved shape returned after `POST`/`GET`.
