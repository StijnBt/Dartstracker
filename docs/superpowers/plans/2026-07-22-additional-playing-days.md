# Additional Playing Days Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin add a single manually-picked match to an active season, and delete one or more matches (played or not) via a select-then-delete-selected flow with a hard confirmation.

**Architecture:** Two new backend endpoints — `POST /api/seasons/{id}/matches` (creates a `Match` with the reserved sentinel `roundNumber: 0`, meaning "not part of a generated round-robin round") and `DELETE /api/matches/{id}` (transactionally deletes a match's `Throw`/`Leg` rows before the `Match` row itself, since there's no cascading delete). On the frontend, `RoundRobinSchedule.tsx` is split so `roundNumber === 0` matches render in a separate "Additional Matches" section with no round header or bye computation, leaving all existing round-grouped rendering untouched. `Season.tsx` gets an admin-only add-match form and a select-then-delete-selected flow with one `window.confirm()` covering every selected match.

**Tech Stack:** No new dependencies. Same stack as prior phases (Azure Functions, Prisma, React, Vitest, React Testing Library).

## Global Constraints

- A manually-added match always gets `roundNumber: 0` — this is a reserved sentinel distinguishing it from generated round-robin rounds (numbered 1+). No schema changes.
- Both endpoints are admin-only (`requireAuth(request, "admin")`) and reuse the exact archived-season guard `update.ts` already has: `400` "Cannot modify a match in an archived season" whenever the match's/season's `status !== "active"`.
- Adding a match: both `player1Id` and `player2Id` must be participants of *this* season (not just any active member); they must differ from each other. No duplicate-pairing check — re-matches are allowed.
- Deleting a match works regardless of its current `status` (scheduled, played, in_progress, or cancelled). Since `Leg`/`Throw` have no cascading delete configured, deletion must happen inside one `prisma.$transaction`, in dependency order: delete `Throw` rows → delete `Leg` rows → delete the `Match` row.
- Deletion is only reachable via a select-then-delete-selected flow (checkboxes + one "Delete Selected (N)" button) — there is no separate single-match immediate-delete button.
- The confirmation before deleting is a single `window.confirm()` covering every selected match. If any selected match has `status === "played"`, the message explicitly warns that its recorded result and full throw history will be permanently lost.
- All of this is admin-only UI on the active season page (`Season.tsx`) only — `SeasonDetail.tsx`/archived seasons get no new controls.

---

### Task 1: `POST /api/seasons/{id}/matches` — add-match endpoint (backend)

**Files:**
- Create: `api/src/functions/seasons/addMatch.ts`
- Test: `api/test/functions/seasons/addMatch.test.ts`

**Interfaces:**
- Produces: the exported `addMatch` Azure Functions handler, registered at `POST /api/seasons/{id}/matches`, returning `{ match: { id, roundNumber: 0, date, status, player1: { id, displayName }, player2: { id, displayName }, player1Legs: null, player2Legs: null, player1Checkout: null, player2Checkout: null, resultEnteredBy: null, resultEnteredAt: null } }` on success (`201`). Task 4 (frontend `api-client.ts`) calls this route.

- [ ] **Step 1: Write the failing test — `api/test/functions/seasons/addMatch.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { addMatch } from "../../../src/functions/seasons/addMatch";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    season: { findUnique: vi.fn() },
    seasonParticipant: { findMany: vi.fn() },
    match: { create: vi.fn() },
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

const activeSeason = { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: new Date() };
const validBody = { date: "2026-08-15", player1Id: 1, player2Id: 2 };

describe("addMatch function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await addMatch(createRequest("1", validBody), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the season id is invalid", async () => {
    const result = await addMatch(createRequest("abc", validBody), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when date is not a valid date", async () => {
    const result = await addMatch(createRequest("1", { ...validBody, date: "not-a-date" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when player1Id equals player2Id", async () => {
    const result = await addMatch(createRequest("1", { ...validBody, player2Id: 1 }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the season doesn't exist", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue(null);
    const result = await addMatch(createRequest("999", validBody), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 400 when the season is archived", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue({
      ...activeSeason,
      status: "archived",
    } as unknown as Awaited<ReturnType<typeof prisma.season.findUnique>>);
    const result = await addMatch(createRequest("1", validBody), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when a player is not a participant of this season", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue(
      activeSeason as unknown as Awaited<ReturnType<typeof prisma.season.findUnique>>
    );
    vi.mocked(prisma.seasonParticipant.findMany).mockResolvedValue([
      { id: 1, seasonId: 1, userId: 1, user: { id: 1, displayName: "Administrator" } },
    ] as unknown as Awaited<ReturnType<typeof prisma.seasonParticipant.findMany>>);
    const result = await addMatch(createRequest("1", validBody), createContext());
    expect(result.status).toBe(400);
    expect(prisma.match.create).not.toHaveBeenCalled();
  });

  it("returns 201 with roundNumber 0 on success", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue(
      activeSeason as unknown as Awaited<ReturnType<typeof prisma.season.findUnique>>
    );
    vi.mocked(prisma.seasonParticipant.findMany).mockResolvedValue([
      { id: 1, seasonId: 1, userId: 1, user: { id: 1, displayName: "Administrator" } },
      { id: 2, seasonId: 1, userId: 2, user: { id: 2, displayName: "Bob Smith" } },
    ] as unknown as Awaited<ReturnType<typeof prisma.seasonParticipant.findMany>>);
    vi.mocked(prisma.match.create).mockResolvedValue({
      id: 501,
      seasonId: 1,
      roundNumber: 0,
      date: new Date("2026-08-15"),
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
    } as unknown as Awaited<ReturnType<typeof prisma.match.create>>);

    const result = await addMatch(createRequest("1", validBody), createContext());

    expect(result.status).toBe(201);
    expect(prisma.match.create).toHaveBeenCalledWith({
      data: { seasonId: 1, roundNumber: 0, date: new Date("2026-08-15"), player1Id: 1, player2Id: 2 },
    });
    expect(result.jsonBody).toEqual({
      match: {
        id: 501,
        roundNumber: 0,
        date: new Date("2026-08-15"),
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
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `api/src/functions/seasons/addMatch.ts` does not exist.

- [ ] **Step 3: Create `api/src/functions/seasons/addMatch.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

type AddMatchBody = {
  date?: unknown;
  player1Id?: unknown;
  player2Id?: unknown;
};

export async function addMatch(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    const seasonId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(seasonId)) {
      return { status: 400, jsonBody: { error: "Invalid season id" } };
    }

    let body: AddMatchBody;
    try {
      body = (await request.json()) as AddMatchBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    if (typeof body.date !== "string" || Number.isNaN(Date.parse(body.date))) {
      return { status: 400, jsonBody: { error: "date must be a valid date" } };
    }

    if (typeof body.player1Id !== "number" || typeof body.player2Id !== "number") {
      return { status: 400, jsonBody: { error: "player1Id and player2Id are required" } };
    }
    if (body.player1Id === body.player2Id) {
      return { status: 400, jsonBody: { error: "player1Id and player2Id must be different" } };
    }
    const player1Id = body.player1Id;
    const player2Id = body.player2Id;

    const season = await prisma.season.findUnique({ where: { id: seasonId } });
    if (!season) {
      return { status: 404, jsonBody: { error: "Season not found" } };
    }
    if (season.status !== "active") {
      return { status: 400, jsonBody: { error: "Cannot modify a match in an archived season" } };
    }

    const participants = await prisma.seasonParticipant.findMany({
      where: { seasonId, userId: { in: [player1Id, player2Id] } },
      include: { user: true },
    });
    if (participants.length !== 2) {
      return {
        status: 400,
        jsonBody: { error: "player1Id and player2Id must both be participants of this season" },
      };
    }
    const displayNameById = new Map(participants.map((p) => [p.user.id, p.user.displayName]));

    const match = await prisma.match.create({
      data: { seasonId, roundNumber: 0, date: new Date(body.date), player1Id, player2Id },
    });

    return {
      status: 201,
      jsonBody: {
        match: {
          id: match.id,
          roundNumber: match.roundNumber,
          date: match.date,
          status: match.status,
          player1: { id: player1Id, displayName: displayNameById.get(player1Id)! },
          player2: { id: player2Id, displayName: displayNameById.get(player2Id)! },
          player1Legs: null,
          player2Legs: null,
          player1Checkout: null,
          player2Checkout: null,
          resultEnteredBy: null,
          resultEnteredAt: null,
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/seasons/{id}/matches failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("seasonsAddMatch", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "seasons/{id}/matches",
  handler: addMatch,
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole backend suite passes, including all new tests in `addMatch.test.ts`.

- [ ] **Step 5: Verify the backend builds**

Run: `cd api && npm run build`
Expected: `tsc` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/functions/seasons/addMatch.ts api/test/functions/seasons/addMatch.test.ts
git commit -m "Add POST /api/seasons/{id}/matches endpoint"
```

---

### Task 2: `DELETE /api/matches/{id}` — delete-match endpoint (backend)

**Files:**
- Create: `api/src/functions/matches/delete.ts`
- Test: `api/test/functions/matches/delete.test.ts`

**Interfaces:**
- Produces: the exported `deleteMatch` Azure Functions handler, registered at `DELETE /api/matches/{id}`, returning `{ success: true }` (`200`) on success. Task 4 (frontend `api-client.ts`) calls this route.

- [ ] **Step 1: Write the failing test — `api/test/functions/matches/delete.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { deleteMatch } from "../../../src/functions/matches/delete";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { match: { findUnique: vi.fn() }, $transaction: vi.fn() },
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

const scheduledMatch = {
  id: 101,
  seasonId: 1,
  roundNumber: 0,
  date: new Date("2026-08-15"),
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
  season: { id: 1, status: "active" },
};

function mockTransaction() {
  const tx = {
    throw: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    leg: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    match: { delete: vi.fn().mockResolvedValue({}) },
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    (async (fn: (tx: unknown) => unknown) => fn(tx)) as unknown as typeof prisma.$transaction
  );
  return tx;
}

describe("deleteMatch function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await deleteMatch(createRequest("101"), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the id is invalid", async () => {
    const result = await deleteMatch(createRequest("abc"), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the match doesn't exist", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
    const result = await deleteMatch(createRequest("999"), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 400 when the match's season is archived", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      ...scheduledMatch,
      season: { id: 1, status: "archived" },
    } as unknown as Awaited<ReturnType<typeof prisma.match.findUnique>>);
    const result = await deleteMatch(createRequest("101"), createContext());
    expect(result.status).toBe(400);
  });

  it("deletes a scheduled match with no legs", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(
      scheduledMatch as unknown as Awaited<ReturnType<typeof prisma.match.findUnique>>
    );
    const tx = mockTransaction();

    const result = await deleteMatch(createRequest("101"), createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({ success: true });
    expect(tx.throw.deleteMany).toHaveBeenCalledWith({ where: { leg: { matchId: 101 } } });
    expect(tx.leg.deleteMany).toHaveBeenCalledWith({ where: { matchId: 101 } });
    expect(tx.match.delete).toHaveBeenCalledWith({ where: { id: 101 } });
  });

  it("deletes a played match, removing its throws and legs before the match itself", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      ...scheduledMatch,
      status: "played",
      player1Legs: 3,
      player2Legs: 1,
    } as unknown as Awaited<ReturnType<typeof prisma.match.findUnique>>);
    const tx = mockTransaction();
    const callOrder: string[] = [];
    tx.throw.deleteMany.mockImplementation(async () => {
      callOrder.push("throw");
      return { count: 9 };
    });
    tx.leg.deleteMany.mockImplementation(async () => {
      callOrder.push("leg");
      return { count: 3 };
    });
    tx.match.delete.mockImplementation(async () => {
      callOrder.push("match");
      return {};
    });

    const result = await deleteMatch(createRequest("101"), createContext());

    expect(result.status).toBe(200);
    expect(callOrder).toEqual(["throw", "leg", "match"]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `api/src/functions/matches/delete.ts` does not exist.

- [ ] **Step 3: Create `api/src/functions/matches/delete.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

export async function deleteMatch(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    const matchId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(matchId)) {
      return { status: 400, jsonBody: { error: "Invalid match id" } };
    }

    const existing = await prisma.match.findUnique({ where: { id: matchId }, include: { season: true } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Match not found" } };
    }
    if (existing.season.status !== "active") {
      return { status: 400, jsonBody: { error: "Cannot modify a match in an archived season" } };
    }

    await prisma.$transaction(async (tx) => {
      await tx.throw.deleteMany({ where: { leg: { matchId } } });
      await tx.leg.deleteMany({ where: { matchId } });
      await tx.match.delete({ where: { id: matchId } });
    });

    return { status: 200, jsonBody: { success: true } };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`DELETE /api/matches/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("matchesDelete", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "matches/{id}",
  handler: deleteMatch,
});
```

Note: this is a second Azure Functions registration on the same route template `matches/{id}` as the existing `matchesUpdate` (`api/src/functions/matches/update.ts`, `PATCH`). This is fine — Azure Functions distinguishes registrations by HTTP method, not just route, and the two files/function names (`matchesUpdate` vs `matchesDelete`) are distinct.

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole backend suite passes, including all new tests in `delete.test.ts`.

- [ ] **Step 5: Verify the backend builds**

Run: `cd api && npm run build`
Expected: `tsc` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/functions/matches/delete.ts api/test/functions/matches/delete.test.ts
git commit -m "Add DELETE /api/matches/{id} endpoint"
```

---

### Task 3: Split `RoundRobinSchedule` for an "Additional Matches" section (frontend)

**Files:**
- Modify: `src/pages/season/RoundRobinSchedule.tsx`
- Modify: `src/pages/season/RoundRobinSchedule.test.tsx`

**Interfaces:**
- No new exports or types — `RoundRobinScheduleProps` is unchanged. This task only changes internal rendering behavior based on the existing `roundNumber` field already present on `SeasonMatch`.

- [ ] **Step 1: Add failing tests to `src/pages/season/RoundRobinSchedule.test.tsx`**

Append inside the existing `describe("RoundRobinSchedule", ...)` block, after the `"renders no bye text when all participants have a match in a round"` test:

```typescript
  it("renders roundNumber 0 matches under an Additional Matches heading, separate from round groups", () => {
    const additionalMatch: SeasonMatch = {
      id: 401,
      roundNumber: 0,
      date: "2026-09-01",
      status: "scheduled",
      player1: { id: 2, displayName: "Bob Smith" },
      player2: { id: 3, displayName: "Carol Smith" },
      ...noResult,
    };
    render(<RoundRobinSchedule matches={[...matches, additionalMatch]} participants={participants} />);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Round 1", "Round 2", "Additional Matches"]);
    expect(screen.getByText("Bob Smith vs Carol Smith")).toBeInTheDocument();
  });

  it("does not compute byes for the Additional Matches section", () => {
    const additionalMatch: SeasonMatch = {
      id: 401,
      roundNumber: 0,
      date: "2026-09-01",
      status: "scheduled",
      player1: { id: 1, displayName: "Administrator" },
      player2: { id: 2, displayName: "Bob Smith" },
      ...noResult,
    };
    render(<RoundRobinSchedule matches={[additionalMatch]} participants={participants} />);

    expect(screen.queryByText(/: bye$/)).not.toBeInTheDocument();
  });

  it("omits the Additional Matches heading when there are no roundNumber 0 matches", () => {
    render(<RoundRobinSchedule matches={matches} participants={participants} />);
    expect(screen.queryByText("Additional Matches")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests and verify the new ones fail**

Run: `npm test`
Expected: FAIL — no "Additional Matches" heading is ever rendered yet.

- [ ] **Step 3: Modify `src/pages/season/RoundRobinSchedule.tsx`**

Replace the entire file with:

```typescript
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
  const regularMatches = matches.filter((m) => m.roundNumber > 0);
  const additionalMatches = matches.filter((m) => m.roundNumber === 0);
  const rounds = Array.from(new Set(regularMatches.map((m) => m.roundNumber))).sort((a, b) => a - b);

  function renderMatchRow(match: SeasonMatch) {
    return (
      <li key={match.id} className="flex items-center justify-between py-2">
        <span>
          {match.player1.displayName} vs {match.player2.displayName}
        </span>
        <span className="flex items-center gap-2 text-sm text-gray-500">
          {renderMatchActions ? renderMatchActions(match) : formatMatchSummary(match)}
          {match.status === "cancelled" && <span className="text-red-600">cancelled</span>}
        </span>
      </li>
    );
  }

  return (
    <>
      {rounds.map((roundNumber) => {
        const roundMatches = regularMatches.filter((m) => m.roundNumber === roundNumber);
        const byePlayers = participants.filter(
          (p) => !roundMatches.some((m) => m.player1.id === p.id || m.player2.id === p.id)
        );

        return (
          <div key={roundNumber} className="mb-4">
            <h2 className="font-heading mb-2 font-semibold">Round {roundNumber}</h2>
            <ul className="divide-y divide-gray-200">
              {roundMatches.map(renderMatchRow)}
              {byePlayers.map((player) => (
                <li key={`bye-${player.id}`} className="py-2 text-sm text-gray-500">
                  {player.displayName}: bye
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {additionalMatches.length > 0 && (
        <div className="mb-4">
          <h2 className="font-heading mb-2 font-semibold">Additional Matches</h2>
          <ul className="divide-y divide-gray-200">{additionalMatches.map(renderMatchRow)}</ul>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS — the whole suite passes, including the three new tests and every pre-existing `RoundRobinSchedule.test.tsx` test unchanged.

- [ ] **Step 5: Verify the project builds**

Run: `npm run build`
Expected: `tsc` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/season/RoundRobinSchedule.tsx src/pages/season/RoundRobinSchedule.test.tsx
git commit -m "Render roundNumber-0 matches as a separate Additional Matches section"
```

---

### Task 4: Frontend `api-client` additions

**Files:**
- Modify: `src/lib/api-client.ts`
- Modify: `src/lib/api-client.test.ts`

**Interfaces:**
- Produces: `AddMatchInput` type (`{ date: string; player1Id: number; player2Id: number }`), `addMatch(seasonId: number, input: AddMatchInput): Promise<SeasonMatch>`, and `deleteMatch(id: number): Promise<void>` — all named exports from `src/lib/api-client.ts`. Task 5 (`Season.tsx`) imports all three.

- [ ] **Step 1: Add failing tests to `src/lib/api-client.test.ts`**

Add `addMatch` and `deleteMatch` to the existing import list at the top of the file:

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
} from "./api-client";
```

Append new `describe` blocks immediately after the existing `describe("updateMatch", ...)` block:

```typescript
  describe("addMatch", () => {
    it("posts the new match and returns it", async () => {
      const match = {
        id: 501,
        roundNumber: 0,
        date: "2026-08-15",
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
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ match }), { status: 201 }));

      const input = { date: "2026-08-15", player1Id: 1, player2Id: 2 };
      const result = await addMatch(1, input);

      expect(fetch).toHaveBeenCalledWith(
        "/api/seasons/1/matches",
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
          body: JSON.stringify(input),
        })
      );
      expect(result).toEqual(match);
    });
  });

  describe("deleteMatch", () => {
    it("sends a DELETE request for the match", async () => {
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

      await deleteMatch(101);

      expect(fetch).toHaveBeenCalledWith(
        "/api/matches/101",
        expect.objectContaining({ method: "DELETE", credentials: "same-origin" })
      );
    });
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test`
Expected: FAIL — `addMatch`/`deleteMatch` are not exported from `src/lib/api-client.ts`.

- [ ] **Step 3: Modify `src/lib/api-client.ts`**

Immediately after the existing `updateMatch` function:

```typescript
export async function updateMatch(id: number, input: UpdateMatchInput): Promise<MatchUpdateResult> {
  const response = await fetch(`/api/matches/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ match: MatchUpdateResult }>(response);
  return data.match;
}
```

add:

```typescript
export type AddMatchInput = {
  date: string;
  player1Id: number;
  player2Id: number;
};

export async function addMatch(seasonId: number, input: AddMatchInput): Promise<SeasonMatch> {
  const response = await fetch(`/api/seasons/${seasonId}/matches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ match: SeasonMatch }>(response);
  return data.match;
}

export async function deleteMatch(id: number): Promise<void> {
  const response = await fetch(`/api/matches/${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  await parseJsonResponse<{ success: boolean }>(response);
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS — the whole suite passes, including the new `addMatch`/`deleteMatch` tests.

- [ ] **Step 5: Verify the project builds**

Run: `npm run build`
Expected: `tsc` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api-client.ts src/lib/api-client.test.ts
git commit -m "Add addMatch and deleteMatch to the api-client"
```

---

### Task 5: Wire the add-match form and select-then-delete-selected flow into `Season.tsx`

**Files:**
- Modify: `src/pages/season/Season.tsx`
- Modify: `src/pages/season/Season.test.tsx`

**Interfaces:**
- Consumes: `addMatch`, `deleteMatch`, `AddMatchInput` from `../../lib/api-client` (Task 4); the updated `RoundRobinSchedule` from `./RoundRobinSchedule` (Task 3, already merged, no prop-shape change).

- [ ] **Step 1: Add failing tests to `src/pages/season/Season.test.tsx`**

Append inside the existing `describe("SeasonPage", ...)` block, after the `"archives the season when the admin clicks Archive Season"` test:

```typescript
  it("shows an Add Match form for an admin, hidden for a non-admin", async () => {
    mockAdmin();
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
    expect(screen.getByRole("heading", { name: "Add Match" })).toBeInTheDocument();
  });

  it("hides the Add Match form for a non-admin participant", async () => {
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
    expect(screen.queryByRole("heading", { name: "Add Match" })).not.toBeInTheDocument();
  });

  it("adds a match with the form and reloads", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.addMatch).mockResolvedValue({ ...season.matches[0], id: 999, roundNumber: 0 });
    render(
      <MemoryRouter>
        <SeasonPage />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.type(screen.getByLabelText("New match date"), "2026-09-01");
    await userEvent.selectOptions(screen.getByLabelText("Player 1"), "1");
    await userEvent.selectOptions(screen.getByLabelText("Player 2"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Add Match" }));

    await waitFor(() => {
      expect(apiClient.addMatch).toHaveBeenCalledWith(1, { date: "2026-09-01", player1Id: 1, player2Id: 2 });
    });
    expect(apiClient.getSeason).toHaveBeenCalledTimes(2);
  });

  it("shows a selection checkbox per match for an admin, and a disabled Delete Selected button with none selected", async () => {
    mockAdmin();
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

    expect(screen.getByRole("button", { name: "Delete Selected (0)" })).toBeDisabled();
    expect(screen.getByLabelText("Select Administrator vs Bob Smith")).toBeInTheDocument();
  });

  it("deletes the selected matches after confirmation and reloads", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.deleteMatch).mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <MemoryRouter>
        <SeasonPage />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByLabelText("Select Administrator vs Bob Smith"));
    await userEvent.click(screen.getByRole("button", { name: "Delete Selected (1)" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("1 match"));
    await waitFor(() => {
      expect(apiClient.deleteMatch).toHaveBeenCalledWith(101);
    });
    expect(apiClient.getSeason).toHaveBeenCalledTimes(2);
  });

  it("warns about lost results/throw history when a selected match has already been played", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      ...season,
      matches: [{ ...season.matches[0], status: "played", player1Legs: 3, player2Legs: 1 }],
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <MemoryRouter>
        <SeasonPage />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByLabelText("Select Administrator vs Bob Smith"));
    await userEvent.click(screen.getByRole("button", { name: "Delete Selected (1)" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("permanently lost"));
    expect(apiClient.deleteMatch).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests and verify the new ones fail**

Run: `npm test`
Expected: FAIL — no "Add Match" form, checkboxes, or "Delete Selected" button exist yet.

- [ ] **Step 3: Modify `src/pages/season/Season.tsx`**

Change the import block:
```typescript
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import {
  listSeasons,
  getSeason,
  getSeasonStats,
  archiveSeason,
  updateMatch,
  type Season,
  type SeasonMatch,
  type SeasonPlayerStat,
} from "../../lib/api-client";
```
to:
```typescript
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import {
  listSeasons,
  getSeason,
  getSeasonStats,
  archiveSeason,
  updateMatch,
  addMatch,
  deleteMatch,
  type Season,
  type SeasonMatch,
  type SeasonPlayerStat,
} from "../../lib/api-client";
```

Change the state block (right after the existing `useState` declarations, before `async function load()`):
```typescript
  const { user } = useAuth();
  const [season, setSeason] = useState<Season | null>(null);
  const [stats, setStats] = useState<SeasonPlayerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
```
to:
```typescript
  const { user } = useAuth();
  const [season, setSeason] = useState<Season | null>(null);
  const [stats, setStats] = useState<SeasonPlayerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addMatchDate, setAddMatchDate] = useState("");
  const [addMatchPlayer1Id, setAddMatchPlayer1Id] = useState<number | "">("");
  const [addMatchPlayer2Id, setAddMatchPlayer2Id] = useState<number | "">("");
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<number>>(new Set());
```

Add three new handler functions right after the existing `handleToggleStatus` function:
```typescript
  async function handleToggleStatus(match: SeasonMatch) {
    await updateMatch(match.id, { status: match.status === "cancelled" ? "scheduled" : "cancelled" });
    void load();
  }
```
becomes:
```typescript
  async function handleToggleStatus(match: SeasonMatch) {
    await updateMatch(match.id, { status: match.status === "cancelled" ? "scheduled" : "cancelled" });
    void load();
  }

  async function handleAddMatch() {
    if (!season || !addMatchDate || addMatchPlayer1Id === "" || addMatchPlayer2Id === "") return;
    await addMatch(season.id, { date: addMatchDate, player1Id: addMatchPlayer1Id, player2Id: addMatchPlayer2Id });
    setAddMatchDate("");
    setAddMatchPlayer1Id("");
    setAddMatchPlayer2Id("");
    void load();
  }

  function toggleMatchSelection(matchId: number) {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) {
        next.delete(matchId);
      } else {
        next.add(matchId);
      }
      return next;
    });
  }

  async function handleDeleteSelected() {
    if (!season || selectedMatchIds.size === 0) return;
    const selected = season.matches.filter((m) => selectedMatchIds.has(m.id));
    const anyPlayed = selected.some((m) => m.status === "played");
    const message = anyPlayed
      ? `Delete ${selected.length} match(es)? This cannot be undone. At least one selected match has already been played — its recorded result and full throw history will be permanently lost.`
      : `Delete ${selected.length} match(es)? This cannot be undone.`;
    if (!window.confirm(message)) return;
    await Promise.all([...selectedMatchIds].map((id) => deleteMatch(id)));
    setSelectedMatchIds(new Set());
    void load();
  }
```

Change the render block — insert the Add Match form and the Delete Selected button between `<PlayerStats stats={stats} />` and `<RoundRobinSchedule`:
```typescript
      <PlayerStats stats={stats} />
      <RoundRobinSchedule
        matches={season.matches}
        participants={season.participants}
```
to:
```typescript
      <PlayerStats stats={stats} />
      {user?.role === "admin" && (
        <div className="mb-4 rounded border border-gray-300 p-3">
          <h2 className="font-heading mb-2 font-semibold">Add Match</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label="New match date"
              value={addMatchDate}
              onChange={(e) => setAddMatchDate(e.target.value)}
              className="rounded border border-gray-300 p-1"
            />
            <select
              aria-label="Player 1"
              value={addMatchPlayer1Id}
              onChange={(e) => setAddMatchPlayer1Id(e.target.value ? Number(e.target.value) : "")}
              className="rounded border border-gray-300 p-1"
            >
              <option value="">Player 1</option>
              {season.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <select
              aria-label="Player 2"
              value={addMatchPlayer2Id}
              onChange={(e) => setAddMatchPlayer2Id(e.target.value ? Number(e.target.value) : "")}
              className="rounded border border-gray-300 p-1"
            >
              <option value="">Player 2</option>
              {season.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <button onClick={() => void handleAddMatch()} className="text-primary underline">
              Add Match
            </button>
          </div>
        </div>
      )}
      {user?.role === "admin" && (
        <button
          onClick={() => void handleDeleteSelected()}
          disabled={selectedMatchIds.size === 0}
          className="text-primary mb-4 underline disabled:text-gray-400 disabled:no-underline"
        >
          Delete Selected ({selectedMatchIds.size})
        </button>
      )}
      <RoundRobinSchedule
        matches={season.matches}
        participants={season.participants}
```

Add a selection checkbox inside the existing admin-only block in `renderMatchActions`:
```typescript
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
```
to:
```typescript
              {user?.role === "admin" && (
                <>
                  <input
                    type="checkbox"
                    aria-label={`Select ${match.player1.displayName} vs ${match.player2.displayName}`}
                    checked={selectedMatchIds.has(match.id)}
                    onChange={() => toggleMatchSelection(match.id)}
                  />
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
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS — the whole suite passes, including all new tests and every pre-existing `Season.test.tsx` test unchanged.

- [ ] **Step 5: Verify the project builds**

Run: `npm run build`
Expected: `tsc` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/season/Season.tsx src/pages/season/Season.test.tsx
git commit -m "Add admin add-match form and select-then-delete-selected flow"
```

---
