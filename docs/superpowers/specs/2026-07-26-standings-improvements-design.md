# Standings Improvements — Design

## Overview

First half of GitHub issue #20 ("GUI/structure improvements"), split out as its own sub-project since the issue's Matches half is a larger, more open-ended piece of work to be brainstormed separately. Two changes to the Standings page's tables:

1. A new per-player "Highest Checkout" column on the Standings table — each player's own best recorded checkout this season, distinct from the existing single-winner `HighestCheckoutAward` banner above it.
2. Click-to-sort column headers on both the Standings table and the Player Stats table.

Both `Standings.tsx` and `PlayerStats.tsx` are shared components also rendered on the archived-season page (`SeasonDetail.tsx`), so both changes apply there automatically — a natural consequence of touching shared components, not additional scope. `HighestCheckoutAward.tsx`/`src/lib/awards.ts` are untouched.

## Section 1: Per-Player Highest Checkout

`StandingsRow` (`src/lib/standings.ts`) gains one field:

```typescript
export type StandingsRow = {
  player: SeasonParticipantSummary;
  matchesPlayed: number;
  legsWon: number;
  legsLost: number;
  diff: number;
  rank: number;
  highestCheckout: number | null;
};
```

`computeStandings` computes it in the same per-player loop over `playedMatches` that already accumulates `legsWon`/`legsLost`: for each of the player's played matches, track the max of `player1Checkout`/`player2Checkout` (whichever side is this player), defaulting to `null` if the player has no played matches or never recorded a checkout.

`Standings.tsx` adds one column, "Highest Checkout", rendering the value or "—" when `null`.

## Section 2: Sortable Columns

New module `src/lib/sortable.ts`:

```typescript
export type SortState<K extends string> = { column: K; direction: "asc" | "desc" } | null;

export function toggleSort<K extends string>(current: SortState<K>, column: K): SortState<K> {
  if (!current || current.column !== column) {
    return { column, direction: "asc" };
  }
  return { column, direction: current.direction === "asc" ? "desc" : "asc" };
}

export function sortRows<T, K extends string>(
  rows: T[],
  sort: SortState<K>,
  comparators: Record<K, (a: T, b: T) => number>
): T[] {
  if (!sort) return rows;
  const comparator = comparators[sort.column];
  const sorted = [...rows].sort(comparator);
  return sort.direction === "asc" ? sorted : sorted.reverse();
}
```

`sortRows` performs a stable sort by the single active column only — no re-application of any other tiebreak. Comparators are supplied by each table; a comparator returning a value that treats `null` as "greater than any number" gives the required "nulls always last regardless of direction" behavior for the Highest Checkout column (reversing a nulls-last ascending sort for descending would put nulls first, which is why direction-independent null placement needs to be baked into the comparator itself, not left to the generic reverse).

**`Standings.tsx`**: holds `useState<SortState<"rank" | "player" | "matchesPlayed" | "legsWon" | "legsLost" | "diff" | "highestCheckout">>(null)`. Defines one comparator per column (numeric for all but `player`, which is case-insensitive alphabetical on `displayName`; `highestCheckout`'s comparator places `null` last in both directions). Calls `sortRows(rows, sort, comparators)` before rendering. Critically, the `rank` column's displayed values are **never recomputed** by sorting — they always reflect each row's actual `rank` from `computeStandings`, regardless of which column the table is currently sorted by; sorting only changes display order.

**`PlayerStats.tsx`**: same pattern, columns `"displayName" | "threeDartAverage" | "oneEightyCount"`.

Each sortable `<th>` renders as a clickable button showing the column label, a small arrow (▲ ascending / ▼ descending) when it's the active sort column, and `aria-sort="ascending" | "descending" | "none"` on the `<th>` itself.

## Section 3: Testing

- `src/lib/sortable.test.ts` (new): `toggleSort` starts a fresh column ascending, flips direction on repeated clicks of the same column, resets to ascending when switching columns; `sortRows` covers ascending/descending numeric and alphabetical ordering, stability on ties, no-op when `sort` is `null`.
- `src/lib/standings.test.ts`: new cases for `highestCheckout` — `null` for a player with no played matches or no recorded checkouts, correct max across multiple played matches.
- `src/pages/season/Standings.test.tsx`: new cases — Highest Checkout column values including "—" for `null`; clicking a header re-orders rows and sets the arrow/`aria-sort`; clicking twice reverses order; `rank` values stay fixed after a re-sort; nulls sort last for Highest Checkout in both directions.
- `src/pages/season/PlayerStats.test.tsx`: equivalent sorting cases for its three columns.
- No changes to `HighestCheckoutAward.tsx`, `src/lib/awards.ts`, `SeasonStandings.tsx`, or `SeasonDetail.tsx` (nor their tests) — they pass data through unchanged.
