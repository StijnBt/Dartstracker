# Season Player Stats (Three-Dart Average & 180 Count) — Design

## Overview

Every logged-in user can see two season-level per-player statistics, per notes.md §3.8's deferred "further statistics" (three-dart average, checkout %, number of 180s) — this phase implements three-dart average and count of 180s only. Checkout percentage is explicitly dropped from scope: under this app's 501 double-out rules, every leg is won by hitting a checkout double, so "legs won by checkout ÷ legs played" is mathematically identical to plain leg win rate, which the existing Standings table (§3.7) already shows. Building it as a separate stat would duplicate information rather than add any.

Shown on both the active season page (`/season`) and archived season pages (`/seasons/:id`), as a new table below the existing Standings table, above the existing round-robin schedule.

Unlike the two prior additive phases (Standings, Highest Checkout Award), this one cannot be a pure client-side derivation: the season page's existing `GET /api/seasons/:id` response carries no per-throw data, only match-level results. Computing an average or a 180 count requires scanning every individual `Throw` row for the season — a new backend endpoint and a new aggregation module are needed.

## Definitions

- **Three-dart average**: `(sum of counted turn totals) ÷ (total darts thrown) × 3`, rounded to 2 decimal places. A "turn" is a player's up-to-three-dart sequence within a leg (grouped by `legId` + `playerId` + `turnNumber`). A busted turn (the player's score would go below 0, or to exactly 1) contributes **0** to the sum of turn totals — matching standard darts scoring convention — but the darts thrown in that turn still count toward the total-darts denominator. This can only be computed correctly with per-throw data; it cannot be derived from anything currently in the `Match` or `Season` API responses.
- **180 count**: the number of turns (as defined above) where the turn was not busted and its three darts summed to exactly 180 (only reachable with all three darts landing, since two darts cap at 120).
- **Scope**: only throws belonging to a `Leg` whose `Match` has `status === "played"` count, consistent with how Standings and the Highest Checkout award already scope themselves to played matches only — an in-progress match's stats don't shift mid-session, and there's no double-counting risk once it completes.
- **Zero-dart players**: a season participant who hasn't thrown any dart yet this season (in a played match) does not appear in the stats output at all — there is no meaningful "0.0 average" to show, unlike Standings' 0-0-0 row for an unplayed participant, which is meaningful (they simply haven't played).

## Section 1: Backend

A new pure computation module, `api/src/lib/seasonStats.ts`, mirroring the existing `api/src/lib/liveScoring.ts` precedent of separating pure logic from DB access:

```ts
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

export function computeSeasonStats(throws: ThrowRecord[]): PlayerStat[] {
  // implementation in the plan
}
```

Algorithm: group `throws` by `(legId, playerId, turnNumber)` into turns. Every throw within a turn shares the same `busted` value (guaranteed by how `liveScoringStore.ts` persists `bustUpdates` — one shared boolean per turn, from `replayMatch`'s `LegResult.bustUpdates`), so any throw in the group can be read for the turn's bust status. For each turn: its dart count contributes to that player's total-darts count; if not busted, its summed `value` contributes to that player's total-score sum, and if that sum is exactly 180, the player's 180 count increments. After processing all turns, compute `threeDartAverage = totalScore / totalDarts * 3` (rounded to 2 decimals) per player. Players with zero total darts are excluded from the returned array — never divide by zero, never emit a row for them.

A new endpoint, `api/src/functions/seasons/stats.ts`:

```ts
app.http("seasonsStats", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "seasons/{id}/stats",
  handler: getSeasonStats,
});
```

`getSeasonStats` follows the exact structure of the existing `getSeason` (`api/src/functions/seasons/get.ts`): `requireAuth(request)` with no role argument (any authenticated user, same as the season GET), validate `request.params.id` is a number, `404` if the season doesn't exist. It then queries every `Throw` for that season's played matches:

```ts
const throws = await prisma.throw.findMany({
  where: { leg: { match: { seasonId, status: "played" } } },
  select: { legId: true, playerId: true, turnNumber: true, value: true, busted: true },
});
```

...calls `computeSeasonStats(throws)`, joins each resulting `playerId` against the season's participants (already fetched, same `include: { participants: { include: { user: true } } }` pattern as `getSeason`) to attach `displayName`, sorts the result by `threeDartAverage` descending, and returns `{ stats: [{ playerId, displayName, threeDartAverage, oneEightyCount }] }`.

## Section 2: Frontend

`src/lib/api-client.ts` gets a new type and function, following the exact pattern of `getSeason`:

```ts
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

A new presentational component, `src/pages/season/PlayerStats.tsx`, takes `{ stats: SeasonPlayerStat[] }` and renders a table (columns: Player, 3-Dart Avg, 180s) in the order given — no client-side sorting, since the backend already returns them sorted by average descending. Mirrors `Standings.tsx`'s structure.

`Season.tsx` and `SeasonDetail.tsx`: each page's existing load logic (the `async function load()` in `Season.tsx`, the `useEffect` chain in `SeasonDetail.tsx`) is extended to fetch `getSeasonStats(id)` alongside `getSeason(id)` (via `Promise.all`), storing the result in a new `stats` state variable. A failure in either fetch surfaces as the same page-level error state the page already has — no separate degraded-state handling. `<PlayerStats stats={stats} />` renders immediately below `<Standings .../>` and above `<RoundRobinSchedule .../>` on both pages.

No new routes, no changes to `App.tsx`, no changes to the existing `Season`/`SeasonMatch`/`SeasonParticipantSummary` types or the `getSeason`/`computeStandings`/`computeHighestCheckout` code paths.

## Section 3: Error Handling & Testing

**Error handling:** the new endpoint follows `getSeason`'s existing error shape exactly (`401` via `AuthError`, `400` for an invalid id, `404` for a missing season, `500` with a logged error for anything unexpected) — no new error handling patterns introduced. On the frontend, a stats-fetch failure is folded into the same error state the page already renders for a season-fetch failure.

**Testing:**
- `api/test/lib/seasonStats.test.ts` (unit tests for `computeSeasonStats`): a normal 3-dart turn summing correctly; a turn that busts contributing 0 to the average while its darts still count toward the denominator; a turn summing to exactly 180 incrementing the 180 count; a turn summing to some other total not incrementing it; a player accumulating correctly across multiple legs and multiple matches; a player with zero throws never appearing in the output; the rounding behavior (2 decimal places) on the average.
- `api/test/functions/seasons/stats.test.ts` (following `api/test/functions/seasons/get.test.ts`'s mocking pattern — `prisma.season.findUnique` and `prisma.throw.findMany` mocked, `requireAuth` mocked): `401` when not authenticated, `400` for an invalid id, `404` for an unknown season, `200` with correctly-shaped and correctly-sorted stats for a populated season, and confirmation that the `where` clause used for the throw query only reaches played matches (verified via the mock's call arguments).
- `src/pages/season/PlayerStats.test.tsx` (component test): renders the given rows, in the given order, with correct column values.
- `Season.test.tsx` / `SeasonDetail.test.tsx`: one new assertion each confirming the stats table renders alongside standings, using a mocked `getSeasonStats` response.
