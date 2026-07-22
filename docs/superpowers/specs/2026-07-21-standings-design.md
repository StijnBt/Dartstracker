# Standings / Tie-Break Calculation — Design

## Overview

Every logged-in user can see a season's standings table: for each participant, total legs won and lost across all their played matches in the season, ranked by legs won (descending), tie-broken by leg differential (legs won − legs lost) — per notes.md §3.7. No separate win/loss points system is used. Standings are shown for both the active season (`/season`) and any archived season (`/seasons/:id`), consistent with §3.2's requirement that past seasons' standings remain accessible after a new season starts.

Computation is entirely derived from data the season pages already fetch (`Season.participants` + `Season.matches`, which already carry `player1Legs`/`player2Legs` for played matches) — no new API endpoint, no new backend logic, no new data model. This mirrors the existing precedent of `src/lib/roundRobin.ts`, a pure client-side derivation module with its own test file.

Out of scope for this phase: forfeit/unplayed-match scoring rules (notes.md §3.6 explicitly defers this — unplayed/cancelled/in-progress matches simply contribute nothing to standings, which is the only sensible interim behavior given no forfeit rule exists yet), and statistics/awards beyond the ranking table itself (three-dart average, checkout %, 180 count, Highest Checkout award — a separate future phase per §3.8, though the data needed for it already exists from the Live Scoreboard phase's throw history).

## Section 1: Architecture

A new pure module, `src/lib/standings.ts`:

```ts
import type { SeasonMatch, SeasonParticipantSummary } from "./api-client";

export type StandingsRow = {
  player: SeasonParticipantSummary;
  matchesPlayed: number;
  legsWon: number;
  legsLost: number;
  diff: number;
  rank: number;
};

export function computeStandings(
  participants: SeasonParticipantSummary[],
  matches: SeasonMatch[]
): StandingsRow[] {
  // implementation in the plan
}
```

Algorithm: for each participant, sum `legsWon`/`legsLost` across every match where `status === "played"` in which that participant appears as either `player1` or `player2` (`player1Legs`/`player2Legs` are non-null once a match is `"played"`, per the existing `Match` model). `matchesPlayed` is the count of those matches. `diff = legsWon - legsLost`.

Sort the resulting rows by `legsWon` descending, then `diff` descending. Assign `rank` using standard competition ("1224") ranking: rows identical on both `legsWon` and `diff` share the same rank number; the next distinct row's rank is its 1-based position in the sorted list (so two players tied for rank 1 are followed by a player at rank 3, not 2).

A new presentational component, `src/pages/season/Standings.tsx`, takes `rows: StandingsRow[]` and renders a table with columns Rank, Player, MP (matches played), Legs Won, Legs Lost, Diff. Reused by both `Season.tsx` and `SeasonDetail.tsx`, mirroring how `RoundRobinSchedule` is already shared between those two pages.

## Section 2: Frontend Integration

`src/pages/season/Season.tsx`: after the existing season-load logic, render `<Standings rows={computeStandings(season.participants, season.matches)} />` above the existing `<RoundRobinSchedule .../>` call.

`src/pages/season/SeasonDetail.tsx`: identical placement and computation — it already fetches the full `Season` object via `getSeason`, which is all `computeStandings` needs.

No new routes, no new API calls, no changes to `App.tsx` or `src/lib/api-client.ts`. A participant with zero played matches still appears in the table (0 MP, 0-0-0, tied for last) — notes.md gives no reason to hide a participant who hasn't played yet.

## Section 3: Error Handling & Testing

**Error handling:** minimal by design — `computeStandings` is a pure function over data the page already successfully fetched. If the season fetch itself fails, the existing error state on `Season.tsx`/`SeasonDetail.tsx` already short-circuits rendering before standings would ever be computed. No new error states are introduced.

**Testing:**
- `src/lib/standings.test.ts` (unit tests for `computeStandings`): legs-won as the primary sort key; leg differential as the tie-break; a full tie (identical legs won and diff) sharing one rank with the next distinct row's rank correctly skipping ahead; unplayed/cancelled/in-progress matches contributing zero legs; a participant with zero played matches still appearing in the output; a player who appears as `player2` in some matches and `player1` in others accumulating correctly from both sides.
- `src/pages/season/Standings.test.tsx` (component test): renders the correct columns and values in rank order for a representative `StandingsRow[]` input.
- `Season.test.tsx` / `SeasonDetail.test.tsx`: one new assertion each confirming the standings table renders on the page alongside the existing schedule.
