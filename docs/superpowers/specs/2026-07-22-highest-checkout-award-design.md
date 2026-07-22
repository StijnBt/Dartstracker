# Highest Checkout Award — Design

## Overview

Every logged-in user can see a season's "Highest Checkout" award: the player (or players, on a tie) with the single highest recorded checkout across the whole season, per notes.md §3.8. Ties are allowed and result in a shared award — no tie-break needed. Shown for both the active season (`/season`) and any archived season (`/seasons/:id`), consistent with how Standings (§3.7) is already shown on both pages.

Computation is entirely derived from data the season pages already fetch: `Match.player1Checkout`/`player2Checkout`, the per-match highest checkout per player, are already populated for every match — by the Live Scoreboard phase's replay logic for live-scored matches, or entered directly on the Match Result Entry page for manually-recorded results — and already come back from `GET /api/seasons/:id`. No new API endpoint, no new backend logic, no new data model. This mirrors the precedent set by `src/lib/standings.ts`: a pure client-side derivation module with its own test file.

Out of scope for this phase: three-dart average, checkout percentage, and count of 180s. notes.md §3.8 explicitly frames these as future statistics that the stored throw history (§3.5) will support "without additional data-entry work later" — they are not part of the concrete "Highest Checkout" award this phase implements, and building them would require a new endpoint to expose per-throw data across a whole season (a materially bigger scope than this phase).

## Section 1: Architecture

A new pure module, `src/lib/awards.ts`:

```ts
import type { SeasonMatch, SeasonParticipantSummary } from "./api-client";

export type HighestCheckoutAward = {
  value: number;
  players: SeasonParticipantSummary[];
} | null;

export function computeHighestCheckout(
  participants: SeasonParticipantSummary[],
  matches: SeasonMatch[]
): HighestCheckoutAward {
  // implementation in the plan
}
```

Algorithm: scan every match's `player1Checkout` and `player2Checkout`. Track the highest non-null value seen (`value`) and the set of participants who recorded that value (`players`) — on a new strictly-higher value, reset the holder set to just that player; on a tie with the current max, add the player to the holder set. `participants` is accepted (mirroring `computeStandings`'s signature) so the module can resolve player identity consistently, even though every checkout holder is necessarily a match participant already present via `match.player1`/`match.player2`. If no match has a recorded checkout at all, return `null`.

A new presentational component, `src/pages/season/HighestCheckoutAward.tsx`, takes `award: HighestCheckoutAward` and renders:
- when `award` is non-null: `Highest Checkout: <value> — <player names joined with ", ">`
- when `award` is `null`: a placeholder message, `"No checkouts recorded yet"`

Reused by both `Season.tsx` and `SeasonDetail.tsx`, mirroring how `Standings` is already shared between those two pages.

## Section 2: Frontend Integration

`src/pages/season/Season.tsx`: render `<HighestCheckoutAward award={computeHighestCheckout(season.participants, season.matches)} />` immediately above the existing `<Standings .../>` call.

`src/pages/season/SeasonDetail.tsx`: identical placement and computation — it already fetches the full `Season` object via `getSeason`, which is all `computeHighestCheckout` needs.

No new routes, no new API calls, no changes to `App.tsx` or `src/lib/api-client.ts`.

## Section 3: Error Handling & Testing

**Error handling:** minimal by design — `computeHighestCheckout` is a pure function over data the page already successfully fetched. If the season fetch itself fails, the existing error state on `Season.tsx`/`SeasonDetail.tsx` already short-circuits rendering before the award would ever be computed. No new error states are introduced.

**Testing:**
- `src/lib/awards.test.ts` (unit tests for `computeHighestCheckout`): a single clear highest checkout; a tie between two or more players sharing the award; a player who appears as `player2` in the tie-holding match still being credited correctly; matches with `null` checkouts (unplayed, or played without a recorded checkout) being ignored; no matches with any recorded checkout returning `null`.
- `src/pages/season/HighestCheckoutAward.test.tsx` (component test): renders the value and player name(s) for a non-null award, including the tied-players case; renders the placeholder message for a `null` award.
- `Season.test.tsx` / `SeasonDetail.test.tsx`: one new assertion each confirming the award renders on the page alongside the existing standings table.
