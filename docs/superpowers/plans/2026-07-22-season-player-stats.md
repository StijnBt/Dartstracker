# Season Player Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every logged-in user two season-level per-player stats — three-dart average and count of 180s — on both the active season page and any archived season page.

**Architecture:** A new pure backend module (`api/src/lib/seasonStats.ts`) derives per-player stats from raw `Throw` rows. A new endpoint (`GET /api/seasons/{id}/stats`) queries throws scoped to the season's played matches and returns the computed stats, joined with display names. The frontend adds a matching `api-client` function/type, a new presentational `PlayerStats` component (mirroring the existing `Standings`/`HighestCheckoutAward` components), and wires both into `Season.tsx`/`SeasonDetail.tsx` via a parallel fetch alongside the existing `getSeason` call.

**Tech Stack:** No new dependencies. Same stack as prior phases (Azure Functions, Prisma, React, Vitest, React Testing Library).

## Global Constraints

- Two stats only: three-dart average and count of 180s. Checkout percentage is explicitly out of scope for this phase (see design spec's Overview for why).
- Three-dart average = `(sum of counted turn totals) ÷ (total darts thrown) × 3`, rounded to 2 decimal places. A "turn" is a player's dart sequence within one leg, grouped by `(legId, playerId, turnNumber)`. A busted turn contributes 0 to the sum of turn totals, but its darts still count toward the total-darts denominator.
- 180 count = number of turns that were not busted and whose darts summed to exactly 180.
- Only throws belonging to a `Leg` whose `Match` has `status === "played"` count.
- A player with zero total darts is omitted entirely from the stats output — never a `0`/placeholder row.
- The new endpoint uses the same auth as the existing `GET /api/seasons/{id}`: `requireAuth(request)` with no role argument (any authenticated user).
- No new routes beyond `GET /api/seasons/{id}/stats`. No changes to `App.tsx`. No changes to the existing `getSeason`/`computeStandings`/`computeHighestCheckout` code paths or their types.

---

### Task 1: `computeSeasonStats` — pure derivation module (backend)

**Files:**
- Create: `api/src/lib/seasonStats.ts`
- Test: `api/test/lib/seasonStats.test.ts`

**Interfaces:**
- Produces: `ThrowRecord` (`{ legId: number; playerId: number; turnNumber: number; value: number; busted: boolean }`), `PlayerStat` (`{ playerId: number; threeDartAverage: number; oneEightyCount: number }`), and `computeSeasonStats(throws: ThrowRecord[]): PlayerStat[]` — all named exports from `api/src/lib/seasonStats.ts`. Task 2 (the new endpoint) imports all three.

- [ ] **Step 1: Write the failing test — `api/test/lib/seasonStats.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { computeSeasonStats, type ThrowRecord } from "../../src/lib/seasonStats";

const P1 = 1;
const P2 = 2;

function th(legId: number, playerId: number, turnNumber: number, value: number, busted = false): ThrowRecord {
  return { legId, playerId, turnNumber, value, busted };
}

describe("computeSeasonStats", () => {
  it("computes a 3-dart average from a single unbusted 3-dart turn", () => {
    const throws = [th(1, P1, 1, 60), th(1, P1, 1, 60), th(1, P1, 1, 60)];

    const stats = computeSeasonStats(throws);

    expect(stats).toEqual([{ playerId: P1, threeDartAverage: 60, oneEightyCount: 1 }]);
  });

  it("excludes a busted turn's score from the average but still counts its darts", () => {
    const throws = [
      th(1, P1, 1, 20),
      th(1, P1, 1, 20),
      th(1, P1, 1, 20), // unbusted turn, total 60, 3 darts
      th(1, P1, 2, 40, true),
      th(1, P1, 2, 45, true), // busted turn, 2 darts, would total 85 if counted
    ];

    const stats = computeSeasonStats(throws);

    // total score 60 (busted turn contributes 0), total darts 5 -> 60 / 5 * 3 = 36
    expect(stats).toEqual([{ playerId: P1, threeDartAverage: 36, oneEightyCount: 0 }]);
  });

  it("does not count a non-180 turn total as a 180", () => {
    const throws = [th(1, P1, 1, 60), th(1, P1, 1, 60), th(1, P1, 1, 20)]; // sums to 140

    const stats = computeSeasonStats(throws);

    expect(stats[0].oneEightyCount).toBe(0);
  });

  it("accumulates across multiple legs for the same player", () => {
    const throws = [
      th(1, P1, 1, 60),
      th(1, P1, 1, 60),
      th(1, P1, 1, 60), // leg 1, turn total 180
      th(2, P1, 1, 60),
      th(2, P1, 1, 60),
      th(2, P1, 1, 60), // leg 2, turn total 180
    ];

    const stats = computeSeasonStats(throws);

    expect(stats).toEqual([{ playerId: P1, threeDartAverage: 60, oneEightyCount: 2 }]);
  });

  it("keeps stats separate per player", () => {
    const throws = [
      th(1, P1, 1, 60),
      th(1, P1, 1, 60),
      th(1, P1, 1, 60),
      th(1, P2, 2, 20),
      th(1, P2, 2, 20),
      th(1, P2, 2, 20),
    ];

    const stats = computeSeasonStats(throws);

    expect(stats.find((s) => s.playerId === P1)).toEqual({ playerId: P1, threeDartAverage: 60, oneEightyCount: 1 });
    expect(stats.find((s) => s.playerId === P2)).toEqual({ playerId: P2, threeDartAverage: 20, oneEightyCount: 0 });
  });

  it("omits any player who has no throws at all", () => {
    const throws = [th(1, P1, 1, 60), th(1, P1, 1, 60), th(1, P1, 1, 60)];

    const stats = computeSeasonStats(throws);

    expect(stats.map((s) => s.playerId)).toEqual([P1]);
  });

  it("returns an empty array for no throws", () => {
    expect(computeSeasonStats([])).toEqual([]);
  });

  it("rounds the average to 2 decimal places", () => {
    const throws = [
      th(1, P1, 1, 20),
      th(1, P1, 1, 15),
      th(1, P1, 1, 15), // turn 1 total 50
      th(1, P1, 2, 10),
      th(1, P1, 2, 10),
      th(1, P1, 2, 5), // turn 2 total 25
      th(1, P1, 3, 10),
      th(1, P1, 3, 5),
      th(1, P1, 3, 5), // turn 3 total 20
    ];
    // total score 95, total darts 9 -> 95 / 9 * 3 = 31.6666... -> 31.67

    const stats = computeSeasonStats(throws);

    expect(stats[0].threeDartAverage).toBe(31.67);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `api/src/lib/seasonStats.ts` does not exist.

- [ ] **Step 3: Create `api/src/lib/seasonStats.ts`**

```typescript
export type ThrowRecord = {
  legId: number;
  playerId: number;
  turnNumber: number;
  value: number;
  busted: boolean;
};

export type PlayerStat = {
  playerId: number;
  threeDartAverage: number;
  oneEightyCount: number;
};

type Turn = { playerId: number; darts: number; total: number; busted: boolean };

export function computeSeasonStats(throws: ThrowRecord[]): PlayerStat[] {
  const turns = new Map<string, Turn>();

  for (const th of throws) {
    const key = `${th.legId}:${th.playerId}:${th.turnNumber}`;
    const turn = turns.get(key);
    if (turn) {
      turn.darts += 1;
      turn.total += th.value;
    } else {
      turns.set(key, { playerId: th.playerId, darts: 1, total: th.value, busted: th.busted });
    }
  }

  type Accumulator = { totalDarts: number; totalScore: number; oneEightyCount: number };
  const perPlayer = new Map<number, Accumulator>();

  for (const turn of turns.values()) {
    const acc = perPlayer.get(turn.playerId) ?? { totalDarts: 0, totalScore: 0, oneEightyCount: 0 };
    acc.totalDarts += turn.darts;
    if (!turn.busted) {
      acc.totalScore += turn.total;
      if (turn.total === 180) {
        acc.oneEightyCount += 1;
      }
    }
    perPlayer.set(turn.playerId, acc);
  }

  return [...perPlayer.entries()].map(([playerId, acc]) => ({
    playerId,
    threeDartAverage: Math.round((acc.totalScore / acc.totalDarts) * 3 * 100) / 100,
    oneEightyCount: acc.oneEightyCount,
  }));
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole backend suite passes, including all new tests in `seasonStats.test.ts`.

- [ ] **Step 5: Verify the backend builds**

Run: `cd api && npm run build`
Expected: `tsc` succeeds with no errors. (This project's `tsconfig.json` has `noUnusedParameters`/strict settings that `vitest`'s esbuild transform does not check — always confirm the actual TypeScript build separately from tests.)

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/seasonStats.ts api/test/lib/seasonStats.test.ts
git commit -m "Add computeSeasonStats (three-dart average, 180 count)"
```

---

### Task 2: `GET /api/seasons/{id}/stats` endpoint (backend)

**Files:**
- Create: `api/src/functions/seasons/stats.ts`
- Test: `api/test/functions/seasons/stats.test.ts`

**Interfaces:**
- Consumes: `computeSeasonStats`, `ThrowRecord`, `PlayerStat` from `../../lib/seasonStats` (Task 1); `prisma` from `../../lib/prisma`; `requireAuth`, `AuthError` from `../../lib/requireAuth` (all pre-existing).
- Produces: the exported `getSeasonStats` Azure Functions handler, and the registered route `GET /api/seasons/{id}/stats`, returning `{ stats: [{ playerId: number; displayName: string; threeDartAverage: number; oneEightyCount: number }] }` sorted by `threeDartAverage` descending. Task 3 (frontend `api-client.ts`) calls this route.

- [ ] **Step 1: Write the failing test — `api/test/functions/seasons/stats.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { getSeasonStats } from "../../../src/functions/seasons/stats";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { season: { findUnique: vi.fn() }, throw: { findMany: vi.fn() } },
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

describe("getSeasonStats function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 2, role: "player" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await getSeasonStats(createRequest("1"), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 400 when the id is invalid", async () => {
    const result = await getSeasonStats(createRequest("abc"), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the season doesn't exist", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue(null);
    const result = await getSeasonStats(createRequest("999"), createContext());
    expect(result.status).toBe(404);
  });

  it("queries throws scoped to played matches in this season", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue({
      id: 1,
      participants: [{ user: { id: 1, displayName: "Administrator" } }],
    } as unknown as Awaited<ReturnType<typeof prisma.season.findUnique>>);
    vi.mocked(prisma.throw.findMany).mockResolvedValue([]);

    await getSeasonStats(createRequest("1"), createContext());

    expect(prisma.throw.findMany).toHaveBeenCalledWith({
      where: { leg: { match: { seasonId: 1, status: "played" } } },
      select: { legId: true, playerId: true, turnNumber: true, value: true, busted: true },
    });
  });

  it("returns 200 with stats joined to display names, sorted by average descending", async () => {
    vi.mocked(prisma.season.findUnique).mockResolvedValue({
      id: 1,
      participants: [
        { user: { id: 1, displayName: "Administrator" } },
        { user: { id: 2, displayName: "Bob Smith" } },
      ],
    } as unknown as Awaited<ReturnType<typeof prisma.season.findUnique>>);
    vi.mocked(prisma.throw.findMany).mockResolvedValue([
      { legId: 1, playerId: 1, turnNumber: 1, value: 20, busted: false },
      { legId: 1, playerId: 1, turnNumber: 1, value: 20, busted: false },
      { legId: 1, playerId: 1, turnNumber: 1, value: 20, busted: false },
      { legId: 1, playerId: 2, turnNumber: 2, value: 60, busted: false },
      { legId: 1, playerId: 2, turnNumber: 2, value: 60, busted: false },
      { legId: 1, playerId: 2, turnNumber: 2, value: 60, busted: false },
    ] as unknown as Awaited<ReturnType<typeof prisma.throw.findMany>>);

    const result = await getSeasonStats(createRequest("1"), createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({
      stats: [
        { playerId: 2, displayName: "Bob Smith", threeDartAverage: 180, oneEightyCount: 1 },
        { playerId: 1, displayName: "Administrator", threeDartAverage: 60, oneEightyCount: 0 },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `api/src/functions/seasons/stats.ts` does not exist.

- [ ] **Step 3: Create `api/src/functions/seasons/stats.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { computeSeasonStats } from "../../lib/seasonStats";

export async function getSeasonStats(
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
      include: { participants: { include: { user: true } } },
    });

    if (!season) {
      return { status: 404, jsonBody: { error: "Season not found" } };
    }

    const throws = await prisma.throw.findMany({
      where: { leg: { match: { seasonId, status: "played" } } },
      select: { legId: true, playerId: true, turnNumber: true, value: true, busted: true },
    });

    const displayNameById = new Map(season.participants.map((p) => [p.user.id, p.user.displayName]));

    const stats = computeSeasonStats(throws)
      .map((stat) => ({
        playerId: stat.playerId,
        displayName: displayNameById.get(stat.playerId)!,
        threeDartAverage: stat.threeDartAverage,
        oneEightyCount: stat.oneEightyCount,
      }))
      .sort((a, b) => b.threeDartAverage - a.threeDartAverage);

    return { status: 200, jsonBody: { stats } };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`GET /api/seasons/{id}/stats failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("seasonsStats", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "seasons/{id}/stats",
  handler: getSeasonStats,
});
```

Note: this endpoint's `season` query only needs `participants`, not `matches` — unlike `getSeason` (`api/src/functions/seasons/get.ts`), this endpoint doesn't return match data, so don't copy its `include: { matches: {...} }` clause.

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole backend suite passes, including all new tests in `stats.test.ts`.

- [ ] **Step 5: Verify the backend builds**

Run: `cd api && npm run build`
Expected: `tsc` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/functions/seasons/stats.ts api/test/functions/seasons/stats.test.ts
git commit -m "Add GET /api/seasons/{id}/stats endpoint"
```

---

### Task 3: Frontend `api-client` addition

**Files:**
- Modify: `src/lib/api-client.ts`
- Modify: `src/lib/api-client.test.ts`

**Interfaces:**
- Produces: `SeasonPlayerStat` type (`{ playerId: number; displayName: string; threeDartAverage: number; oneEightyCount: number }`) and `getSeasonStats(id: number): Promise<SeasonPlayerStat[]>` — both named exports from `src/lib/api-client.ts`. Task 4 (`PlayerStats.tsx`) imports `SeasonPlayerStat`; Task 5 (`Season.tsx`/`SeasonDetail.tsx`) imports both.

- [ ] **Step 1: Add a failing test to `src/lib/api-client.test.ts`**

Add `getSeasonStats` to the existing import list at the top of the file:

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
  submitMatchResult,
} from "./api-client";
```

Append a new `describe` block immediately after the existing `describe("getSeason", ...)` block:

```typescript
  describe("getSeasonStats", () => {
    it("fetches and returns season stats", async () => {
      const stats = [{ playerId: 1, displayName: "Administrator", threeDartAverage: 65.5, oneEightyCount: 2 }];
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ stats }), { status: 200 }));

      const result = await getSeasonStats(1);

      expect(fetch).toHaveBeenCalledWith(
        "/api/seasons/1/stats",
        expect.objectContaining({ credentials: "same-origin" })
      );
      expect(result).toEqual(stats);
    });
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `getSeasonStats` is not exported from `src/lib/api-client.ts`.

- [ ] **Step 3: Modify `src/lib/api-client.ts`**

Immediately after the existing `getSeason` function:

```typescript
export async function getSeason(id: number): Promise<Season> {
  const response = await fetch(`/api/seasons/${id}`, { credentials: "same-origin" });
  const data = await parseJsonResponse<{ season: Season }>(response);
  return data.season;
}
```

add:

```typescript
export type SeasonPlayerStat = {
  playerId: number;
  displayName: string;
  threeDartAverage: number;
  oneEightyCount: number;
};

export async function getSeasonStats(id: number): Promise<SeasonPlayerStat[]> {
  const response = await fetch(`/api/seasons/${id}/stats`, { credentials: "same-origin" });
  const data = await parseJsonResponse<{ stats: SeasonPlayerStat[] }>(response);
  return data.stats;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole frontend suite passes, including the new `getSeasonStats` test.

- [ ] **Step 5: Verify the project builds**

Run: `npm run build`
Expected: `tsc` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api-client.ts src/lib/api-client.test.ts
git commit -m "Add getSeasonStats to the api-client"
```

---

### Task 4: `PlayerStats` presentational component

**Files:**
- Create: `src/pages/season/PlayerStats.tsx`
- Test: `src/pages/season/PlayerStats.test.tsx`

**Interfaces:**
- Consumes: `SeasonPlayerStat` from `../../lib/api-client` (Task 3).
- Produces: default export `PlayerStats` React component, taking `{ stats: SeasonPlayerStat[] }`. Consumed by Task 5 (`Season.tsx`, `SeasonDetail.tsx`).

- [ ] **Step 1: Write the failing test — `src/pages/season/PlayerStats.test.tsx`**

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import PlayerStats from "./PlayerStats";
import type { SeasonPlayerStat } from "../../lib/api-client";

const stats: SeasonPlayerStat[] = [
  { playerId: 1, displayName: "Alice", threeDartAverage: 60.5, oneEightyCount: 2 },
  { playerId: 2, displayName: "Bob", threeDartAverage: 45.25, oneEightyCount: 0 },
];

describe("PlayerStats", () => {
  it("renders a row per player with name, average, and 180 count, in the given order", () => {
    render(<PlayerStats stats={stats} />);

    const dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows).toHaveLength(2);
    expect(dataRows[0]).toHaveTextContent("Alice");
    expect(dataRows[0]).toHaveTextContent("60.50");
    expect(dataRows[0]).toHaveTextContent("2");
    expect(dataRows[1]).toHaveTextContent("Bob");
    expect(dataRows[1]).toHaveTextContent("45.25");
  });

  it("renders the column headers", () => {
    render(<PlayerStats stats={stats} />);

    expect(screen.getByText("Player")).toBeInTheDocument();
    expect(screen.getByText("3-Dart Avg")).toBeInTheDocument();
    expect(screen.getByText("180s")).toBeInTheDocument();
  });

  it("shows only the header row when there are no stats", () => {
    render(<PlayerStats stats={[]} />);

    expect(screen.getAllByRole("row")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/pages/season/PlayerStats.tsx` does not exist.

- [ ] **Step 3: Create `src/pages/season/PlayerStats.tsx`**

```typescript
import type { SeasonPlayerStat } from "../../lib/api-client";

type PlayerStatsProps = {
  stats: SeasonPlayerStat[];
};

export default function PlayerStats({ stats }: PlayerStatsProps) {
  return (
    <table className="mb-6 w-full text-left text-sm">
      <caption className="font-heading mb-2 text-left font-semibold">Player Stats</caption>
      <thead>
        <tr className="border-b border-gray-300">
          <th className="py-1 pr-2">Player</th>
          <th className="py-1 pr-2 text-right">3-Dart Avg</th>
          <th className="py-1 text-right">180s</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((stat) => (
          <tr key={stat.playerId} className="border-b border-gray-100">
            <td className="py-1 pr-2">{stat.displayName}</td>
            <td className="py-1 pr-2 text-right">{stat.threeDartAverage.toFixed(2)}</td>
            <td className="py-1 text-right">{stat.oneEightyCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including all new tests in `PlayerStats.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/season/PlayerStats.tsx src/pages/season/PlayerStats.test.tsx
git commit -m "Add PlayerStats table component"
```

---

### Task 5: Wire `PlayerStats` into `Season.tsx` and `SeasonDetail.tsx`

**Files:**
- Modify: `src/pages/season/Season.tsx`
- Modify: `src/pages/season/Season.test.tsx`
- Modify: `src/pages/season/SeasonDetail.tsx`
- Modify: `src/pages/season/SeasonDetail.test.tsx`

**Interfaces:**
- Consumes: `getSeasonStats`, `SeasonPlayerStat` from `../../lib/api-client` (Task 3), `PlayerStats` default export from `./PlayerStats` (Task 4).

**Important:** both pages currently call `getSeason` alone to load season data. This task changes that to a parallel `Promise.all([getSeason(...), getSeasonStats(...)])` call, so a season's stats load together with everything else. Because `PlayerStats` calls `.map()` on its `stats` prop, **every existing test in `Season.test.tsx` and `SeasonDetail.test.tsx` that currently renders a loaded season needs `apiClient.getSeasonStats` to resolve to an array** (not the default auto-mocked `undefined`), or the component will throw. Rather than editing every existing test individually, this task adds one `beforeEach` per file providing a default empty-array mock; only the new test in each file overrides it with real data.

- [ ] **Step 1: Add a `beforeEach` default mock to `src/pages/season/Season.test.tsx`**

Change:
```typescript
describe("SeasonPage", () => {
  it("shows an empty state with no Create Season link for a player when there is no active season", async () => {
```
to:
```typescript
describe("SeasonPage", () => {
  beforeEach(() => {
    vi.mocked(apiClient.getSeasonStats).mockResolvedValue([]);
  });

  it("shows an empty state with no Create Season link for a player when there is no active season", async () => {
```

- [ ] **Step 2: Add a failing test to `src/pages/season/Season.test.tsx`**

Update the `@testing-library/react` import to add `within`:
```typescript
import { render, screen, waitFor } from "@testing-library/react";
```
becomes:
```typescript
import { render, screen, waitFor, within } from "@testing-library/react";
```

Append inside the `describe("SeasonPage", ...)` block, after the `"renders a standings table computed from the season's matches"` test:

```typescript
  it("renders the player stats table computed from the season's throw history", async () => {
    mockNonParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.getSeasonStats).mockResolvedValue([
      { playerId: 1, displayName: "Administrator", threeDartAverage: 65.5, oneEightyCount: 1 },
    ]);
    render(
      <MemoryRouter>
        <SeasonPage />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    expect(screen.getByText("3-Dart Avg")).toBeInTheDocument();
    const statsTable = screen.getByText("3-Dart Avg").closest("table")!;
    expect(within(statsTable).getByText("Administrator")).toBeInTheDocument();
    expect(within(statsTable).getByText("65.50")).toBeInTheDocument();
  });
```

- [ ] **Step 3: Add a `beforeEach` default mock and a failing test to `src/pages/season/SeasonDetail.test.tsx`**

Update the `@testing-library/react` import:
```typescript
import { render, screen, waitFor } from "@testing-library/react";
```
becomes:
```typescript
import { render, screen, waitFor, within } from "@testing-library/react";
```

Change:
```typescript
describe("SeasonDetail", () => {
  it("renders the season's read-only schedule", async () => {
```
to:
```typescript
describe("SeasonDetail", () => {
  beforeEach(() => {
    vi.mocked(apiClient.getSeasonStats).mockResolvedValue([]);
  });

  it("renders the season's read-only schedule", async () => {
```

Append inside the `describe("SeasonDetail", ...)` block, after the `"renders a standings table computed from the season's matches"` test:

```typescript
  it("renders the player stats table computed from the season's throw history", async () => {
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
          status: "played",
          player1: { id: 1, displayName: "Administrator" },
          player2: { id: 2, displayName: "Bob Smith" },
          player1Legs: 3,
          player2Legs: 0,
          player1Checkout: null,
          player2Checkout: null,
          resultEnteredBy: null,
          resultEnteredAt: null,
        },
      ],
    });
    vi.mocked(apiClient.getSeasonStats).mockResolvedValue([
      { playerId: 1, displayName: "Administrator", threeDartAverage: 72.25, oneEightyCount: 3 },
    ]);

    renderWithRouter("1");

    await waitFor(() => expect(screen.getByText("Winter 2025")).toBeInTheDocument());
    expect(screen.getByText("3-Dart Avg")).toBeInTheDocument();
    const statsTable = screen.getByText("3-Dart Avg").closest("table")!;
    expect(within(statsTable).getByText("Administrator")).toBeInTheDocument();
    expect(within(statsTable).getByText("72.25")).toBeInTheDocument();
  });
```

- [ ] **Step 4: Run the tests and verify the new ones fail**

Run: `npm test`
Expected: FAIL — neither page renders a "3-Dart Avg" column yet. (The `beforeEach` additions themselves shouldn't break any existing test, since `apiClient.getSeasonStats` doesn't exist as a call inside `load()`/the `useEffect` yet — this step confirms only the two new tests fail, not the whole suite.)

- [ ] **Step 5: Modify `src/pages/season/Season.tsx`**

Change the import block:
```typescript
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { listSeasons, getSeason, archiveSeason, updateMatch, type Season, type SeasonMatch } from "../../lib/api-client";
import { computeStandings } from "../../lib/standings";
import { computeHighestCheckout } from "../../lib/awards";
import RoundRobinSchedule, { formatMatchSummary } from "./RoundRobinSchedule";
import Standings from "./Standings";
import HighestCheckoutAward from "./HighestCheckoutAward";
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
  type Season,
  type SeasonMatch,
  type SeasonPlayerStat,
} from "../../lib/api-client";
import { computeStandings } from "../../lib/standings";
import { computeHighestCheckout } from "../../lib/awards";
import RoundRobinSchedule, { formatMatchSummary } from "./RoundRobinSchedule";
import Standings from "./Standings";
import HighestCheckoutAward from "./HighestCheckoutAward";
import PlayerStats from "./PlayerStats";
```

Change the state and `load` function:
```typescript
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
```
to:
```typescript
  const { user } = useAuth();
  const [season, setSeason] = useState<Season | null>(null);
  const [stats, setStats] = useState<SeasonPlayerStat[]>([]);
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
      const [seasonData, statsData] = await Promise.all([getSeason(active.id), getSeasonStats(active.id)]);
      setSeason(seasonData);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load season");
    } finally {
      setLoading(false);
    }
  }
```

Change the render block:
```typescript
      <HighestCheckoutAward award={computeHighestCheckout(season.participants, season.matches)} />
      <Standings rows={computeStandings(season.participants, season.matches)} />
      <RoundRobinSchedule
        matches={season.matches}
        participants={season.participants}
```
to:
```typescript
      <HighestCheckoutAward award={computeHighestCheckout(season.participants, season.matches)} />
      <Standings rows={computeStandings(season.participants, season.matches)} />
      <PlayerStats stats={stats} />
      <RoundRobinSchedule
        matches={season.matches}
        participants={season.participants}
```

- [ ] **Step 6: Modify `src/pages/season/SeasonDetail.tsx`**

Change the import block:
```typescript
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSeason, type Season } from "../../lib/api-client";
import { computeStandings } from "../../lib/standings";
import { computeHighestCheckout } from "../../lib/awards";
import RoundRobinSchedule from "./RoundRobinSchedule";
import Standings from "./Standings";
import HighestCheckoutAward from "./HighestCheckoutAward";
```
to:
```typescript
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSeason, getSeasonStats, type Season, type SeasonPlayerStat } from "../../lib/api-client";
import { computeStandings } from "../../lib/standings";
import { computeHighestCheckout } from "../../lib/awards";
import RoundRobinSchedule from "./RoundRobinSchedule";
import Standings from "./Standings";
import HighestCheckoutAward from "./HighestCheckoutAward";
import PlayerStats from "./PlayerStats";
```

Change the state and `useEffect`:
```typescript
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
```
to:
```typescript
  const { id } = useParams<{ id: string }>();
  const [season, setSeason] = useState<Season | null>(null);
  const [stats, setStats] = useState<SeasonPlayerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([getSeason(Number(id)), getSeasonStats(Number(id))])
      .then(([seasonData, statsData]) => {
        setSeason(seasonData);
        setStats(statsData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load season"))
      .finally(() => setLoading(false));
  }, [id]);
```

Change the render block:
```typescript
      <HighestCheckoutAward award={computeHighestCheckout(season.participants, season.matches)} />
      <Standings rows={computeStandings(season.participants, season.matches)} />
      <RoundRobinSchedule matches={season.matches} participants={season.participants} />
```
to:
```typescript
      <HighestCheckoutAward award={computeHighestCheckout(season.participants, season.matches)} />
      <Standings rows={computeStandings(season.participants, season.matches)} />
      <PlayerStats stats={stats} />
      <RoundRobinSchedule matches={season.matches} participants={season.participants} />
```

- [ ] **Step 7: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS — the whole suite passes, including the two new tests and every pre-existing `Season.test.tsx`/`SeasonDetail.test.tsx` test unchanged (the `beforeEach` default keeps them working without individual edits).

- [ ] **Step 8: Verify the project builds**

Run: `npm run build`
Expected: `tsc` succeeds with no errors.

- [ ] **Step 9: Commit**

```bash
git add src/pages/season/Season.tsx src/pages/season/Season.test.tsx src/pages/season/SeasonDetail.tsx src/pages/season/SeasonDetail.test.tsx
git commit -m "Show player stats on the active and archived season pages"
```

---
