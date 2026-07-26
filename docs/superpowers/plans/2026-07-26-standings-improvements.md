# Standings Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-player "highest checkout this season" column to the Standings table, and let both the Standings and Player Stats tables be sorted by clicking any column header.

**Architecture:** A new small shared module (`src/lib/sortable.ts`) provides direction-aware sort-state and comparator helpers, used by both `Standings.tsx` and `PlayerStats.tsx`. `computeStandings` (`src/lib/standings.ts`) gains a `highestCheckout: number | null` field per row, computed alongside the existing legs-won/lost accumulation.

**Tech Stack:** No new dependencies. Same stack as prior phases (React, Vitest, React Testing Library).

## Global Constraints

- `sortRows`'s comparators take the current sort direction as a parameter (not a generic "sort ascending then reverse the array") — reversing the whole array would flip null placement along with everything else, which is incompatible with "nulls always sort last regardless of direction" for the Highest Checkout column.
- `numericComparator`'s `nullsLast` option, when set, must place `null` values last in **both** ascending and descending order.
- Clicking a column header that isn't currently sorted starts it ascending; clicking the currently-active column's header flips its direction; clicking a different column resets to ascending on that column.
- The `rank` column's displayed values are never recomputed by sorting — a row's `rank` always reflects its actual competitive standing from `computeStandings`, regardless of which column the table is currently sorted by; sorting only changes display order.
- Each sortable `<th>` shows an arrow indicator (▲ ascending / ▼ descending) only when it's the active sort column, and sets `aria-sort="ascending" | "descending" | "none"` on itself.
- `HighestCheckoutAward.tsx`, `src/lib/awards.ts`, `SeasonStandings.tsx`, and `SeasonDetail.tsx` are not touched by this plan — the new checkout data is a per-row field on `StandingsRow`, independent of the existing single-winner award banner.

---

### Task 1: Shared sorting utility — `src/lib/sortable.ts`

**Files:**
- Create: `src/lib/sortable.ts`
- Test: `src/lib/sortable.test.ts`

**Interfaces:**
- Produces: `SortState<K extends string>` (`{ column: K; direction: "asc" | "desc" } | null`), `SortComparator<T>` (`(a: T, b: T, direction: "asc" | "desc") => number`), `toggleSort<K>(current, column): SortState<K>`, `sortRows<T, K>(rows: T[], sort: SortState<K>, comparators: Record<K, SortComparator<T>>): T[]`, `numericComparator<T>(getValue: (row: T) => number | null, options?: { nullsLast?: boolean }): SortComparator<T>`, `stringComparator<T>(getValue: (row: T) => string): SortComparator<T>` — all named exports. Tasks 2 and 3 (`Standings.tsx`/`PlayerStats.tsx`) import all of these.

- [ ] **Step 1: Write the failing test — `src/lib/sortable.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { toggleSort, sortRows, numericComparator, stringComparator, type SortState } from "./sortable";

describe("toggleSort", () => {
  it("starts a fresh column ascending when nothing is sorted yet", () => {
    expect(toggleSort<"name">(null, "name")).toEqual({ column: "name", direction: "asc" });
  });

  it("flips direction when clicking the same column again", () => {
    const afterFirst = toggleSort<"name">(null, "name");
    expect(toggleSort(afterFirst, "name")).toEqual({ column: "name", direction: "desc" });
  });

  it("flips back to ascending on a third click of the same column", () => {
    const first = toggleSort<"name">(null, "name");
    const second = toggleSort(first, "name");
    expect(toggleSort(second, "name")).toEqual({ column: "name", direction: "asc" });
  });

  it("resets to ascending when switching to a different column", () => {
    const sortedDesc: SortState<"name" | "age"> = { column: "name", direction: "desc" };
    expect(toggleSort(sortedDesc, "age")).toEqual({ column: "age", direction: "asc" });
  });
});

describe("sortRows", () => {
  type Row = { name: string; age: number };
  const rows: Row[] = [
    { name: "Carol", age: 30 },
    { name: "alice", age: 20 },
    { name: "Bob", age: 25 },
  ];
  const comparators = {
    name: stringComparator<Row>((r) => r.name),
    age: numericComparator<Row>((r) => r.age),
  };

  it("returns rows unchanged when sort is null", () => {
    expect(sortRows(rows, null, comparators)).toBe(rows);
  });

  it("sorts ascending by the active column", () => {
    const result = sortRows(rows, { column: "age", direction: "asc" }, comparators);
    expect(result.map((r) => r.name)).toEqual(["alice", "Bob", "Carol"]);
  });

  it("sorts descending by the active column", () => {
    const result = sortRows(rows, { column: "age", direction: "desc" }, comparators);
    expect(result.map((r) => r.name)).toEqual(["Carol", "Bob", "alice"]);
  });

  it("does not mutate the original array", () => {
    const original = [...rows];
    sortRows(rows, { column: "age", direction: "asc" }, comparators);
    expect(rows).toEqual(original);
  });
});

describe("numericComparator", () => {
  type Row = { value: number | null };
  const rows: Row[] = [{ value: 30 }, { value: null }, { value: 10 }, { value: 20 }];

  it("sorts ascending by value, treating null as 0 when nullsLast is not set", () => {
    const comparator = numericComparator<Row>((r) => r.value);
    const sorted = [...rows].sort((a, b) => comparator(a, b, "asc"));
    expect(sorted.map((r) => r.value)).toEqual([null, 10, 20, 30]);
  });

  it("sorts descending by value, treating null as 0 when nullsLast is not set", () => {
    const comparator = numericComparator<Row>((r) => r.value);
    const sorted = [...rows].sort((a, b) => comparator(a, b, "desc"));
    expect(sorted.map((r) => r.value)).toEqual([30, 20, 10, null]);
  });

  it("keeps nulls last in ascending order when nullsLast is set", () => {
    const comparator = numericComparator<Row>((r) => r.value, { nullsLast: true });
    const sorted = [...rows].sort((a, b) => comparator(a, b, "asc"));
    expect(sorted.map((r) => r.value)).toEqual([10, 20, 30, null]);
  });

  it("keeps nulls last in descending order when nullsLast is set", () => {
    const comparator = numericComparator<Row>((r) => r.value, { nullsLast: true });
    const sorted = [...rows].sort((a, b) => comparator(a, b, "desc"));
    expect(sorted.map((r) => r.value)).toEqual([30, 20, 10, null]);
  });
});

describe("stringComparator", () => {
  type Row = { name: string };
  const rows: Row[] = [{ name: "carol" }, { name: "Alice" }, { name: "bob" }];

  it("sorts case-insensitively ascending", () => {
    const comparator = stringComparator<Row>((r) => r.name);
    const sorted = [...rows].sort((a, b) => comparator(a, b, "asc"));
    expect(sorted.map((r) => r.name)).toEqual(["Alice", "bob", "carol"]);
  });

  it("sorts case-insensitively descending", () => {
    const comparator = stringComparator<Row>((r) => r.name);
    const sorted = [...rows].sort((a, b) => comparator(a, b, "desc"));
    expect(sorted.map((r) => r.name)).toEqual(["carol", "bob", "Alice"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- sortable
```
Expected: FAIL — `src/lib/sortable.ts` doesn't exist yet.

- [ ] **Step 3: Write `src/lib/sortable.ts`**

```typescript
export type SortState<K extends string> = { column: K; direction: "asc" | "desc" } | null;

export type SortComparator<T> = (a: T, b: T, direction: "asc" | "desc") => number;

export function toggleSort<K extends string>(current: SortState<K>, column: K): SortState<K> {
  if (!current || current.column !== column) {
    return { column, direction: "asc" };
  }
  return { column, direction: current.direction === "asc" ? "desc" : "asc" };
}

export function sortRows<T, K extends string>(
  rows: T[],
  sort: SortState<K>,
  comparators: Record<K, SortComparator<T>>
): T[] {
  if (!sort) return rows;
  const comparator = comparators[sort.column];
  return [...rows].sort((a, b) => comparator(a, b, sort.direction));
}

export function numericComparator<T>(
  getValue: (row: T) => number | null,
  { nullsLast = false }: { nullsLast?: boolean } = {}
): SortComparator<T> {
  return (a, b, direction) => {
    const av = getValue(a);
    const bv = getValue(b);
    if (nullsLast) {
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
    }
    const diff = (av ?? 0) - (bv ?? 0);
    return direction === "asc" ? diff : -diff;
  };
}

export function stringComparator<T>(getValue: (row: T) => string): SortComparator<T> {
  return (a, b, direction) => {
    const result = getValue(a).localeCompare(getValue(b), undefined, { sensitivity: "base" });
    return direction === "asc" ? result : -result;
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- sortable
```
Expected: PASS — all 14 tests pass.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc -b && vite build` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sortable.ts src/lib/sortable.test.ts
git commit -m "Add shared sortable-table utility"
```

---

### Task 2: Per-player highest checkout — `src/lib/standings.ts`

**Files:**
- Modify: `src/lib/standings.ts`
- Modify: `src/lib/standings.test.ts`

**Interfaces:**
- Produces: `StandingsRow` gains a `highestCheckout: number | null` field. Task 3 (`Standings.tsx`) reads this field.

- [ ] **Step 1: Add failing tests to `src/lib/standings.test.ts`**

Replace the existing `playedMatch` helper with one that accepts optional checkout values (defaulting to `null`, matching every existing call site that doesn't pass them):

```typescript
function playedMatch(
  id: number,
  player1: SeasonParticipantSummary,
  player2: SeasonParticipantSummary,
  player1Legs: number,
  player2Legs: number,
  player1Checkout: number | null = null,
  player2Checkout: number | null = null
): SeasonMatch {
  return {
    id,
    roundNumber: 1,
    date: "2026-08-01",
    status: "played",
    player1,
    player2,
    player1Legs,
    player2Legs,
    player1Checkout,
    player2Checkout,
    resultEnteredBy: null,
    resultEnteredAt: null,
  };
}
```

Append these new test cases inside the existing `describe("computeStandings", ...)` block, immediately before its closing `});`:

```typescript
  it("computes each player's highest checkout across their played matches", () => {
    const matches = [
      playedMatch(1, alice, bob, 3, 1, 80, null),
      playedMatch(2, bob, alice, 3, 2, 40, 121),
    ];
    const rows = computeStandings([alice, bob], matches);
    const alicesRow = rows.find((r) => r.player.id === alice.id)!;
    const bobsRow = rows.find((r) => r.player.id === bob.id)!;

    expect(alicesRow.highestCheckout).toBe(121);
    expect(bobsRow.highestCheckout).toBe(40);
  });

  it("gives a player with no recorded checkouts a null highestCheckout", () => {
    const rows = computeStandings([alice, bob], [playedMatch(1, alice, bob, 3, 1)]);
    const alicesRow = rows.find((r) => r.player.id === alice.id)!;

    expect(alicesRow.highestCheckout).toBeNull();
  });

  it("gives a participant with zero played matches a null highestCheckout", () => {
    const rows = computeStandings([alice, bob, carol], [playedMatch(1, alice, bob, 3, 0, 100, null)]);
    const carolsRow = rows.find((r) => r.player.id === carol.id)!;

    expect(carolsRow.highestCheckout).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- standings
```
Expected: FAIL — `highestCheckout` doesn't exist on `StandingsRow` yet (TypeScript error) and the new assertions fail.

- [ ] **Step 3: Modify `src/lib/standings.ts`**

Replace the whole file:

```typescript
import type { SeasonMatch, SeasonParticipantSummary } from "./api-client";

export type StandingsRow = {
  player: SeasonParticipantSummary;
  matchesPlayed: number;
  legsWon: number;
  legsLost: number;
  diff: number;
  rank: number;
  highestCheckout: number | null;
};

export function computeStandings(
  participants: SeasonParticipantSummary[],
  matches: SeasonMatch[]
): StandingsRow[] {
  const playedMatches = matches.filter((m) => m.status === "played");

  const rows: StandingsRow[] = participants.map((player) => {
    let matchesPlayed = 0;
    let legsWon = 0;
    let legsLost = 0;
    let highestCheckout: number | null = null;

    for (const match of playedMatches) {
      if (match.player1.id === player.id) {
        matchesPlayed++;
        legsWon += match.player1Legs ?? 0;
        legsLost += match.player2Legs ?? 0;
        if (match.player1Checkout !== null && (highestCheckout === null || match.player1Checkout > highestCheckout)) {
          highestCheckout = match.player1Checkout;
        }
      } else if (match.player2.id === player.id) {
        matchesPlayed++;
        legsWon += match.player2Legs ?? 0;
        legsLost += match.player1Legs ?? 0;
        if (match.player2Checkout !== null && (highestCheckout === null || match.player2Checkout > highestCheckout)) {
          highestCheckout = match.player2Checkout;
        }
      }
    }

    return { player, matchesPlayed, legsWon, legsLost, diff: legsWon - legsLost, rank: 0, highestCheckout };
  });

  rows.sort((a, b) => b.legsWon - a.legsWon || b.diff - a.diff);

  let currentRank = 0;
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    if (index === 0 || row.legsWon !== previous.legsWon || row.diff !== previous.diff) {
      currentRank = index + 1;
    }
    row.rank = currentRank;
  });

  return rows;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- standings
```
Expected: PASS — the whole file passes, including the three new cases.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc -b && vite build` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/standings.ts src/lib/standings.test.ts
git commit -m "Add per-player highest checkout to computeStandings"
```

---

### Task 3: Sortable `Standings` table with the new column

**Files:**
- Modify: `src/pages/season/Standings.tsx`
- Modify: `src/pages/season/Standings.test.tsx`

**Interfaces:**
- Consumes: `toggleSort`, `sortRows`, `numericComparator`, `stringComparator`, `SortState`, `SortComparator` from Task 1 (`src/lib/sortable.ts`); `highestCheckout` field from Task 2 (`src/lib/standings.ts`).
- Produces: `Standings` unchanged prop signature (`{ rows: StandingsRow[] }`), now renders a "Highest Checkout" column and clickable sortable headers.

- [ ] **Step 1: Replace `src/pages/season/Standings.test.tsx`**

```typescript
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import Standings from "./Standings";
import type { StandingsRow } from "../../lib/standings";

const rows: StandingsRow[] = [
  { player: { id: 1, displayName: "Alice" }, matchesPlayed: 3, legsWon: 6, legsLost: 1, diff: 5, rank: 1, highestCheckout: 80 },
  { player: { id: 2, displayName: "Bob" }, matchesPlayed: 2, legsWon: 3, legsLost: 4, diff: -1, rank: 2, highestCheckout: null },
  { player: { id: 3, displayName: "Carol" }, matchesPlayed: 1, legsWon: 1, legsLost: 3, diff: -2, rank: 3, highestCheckout: 150 },
];

describe("Standings", () => {
  it("renders a row per player with rank, name, and stats, in the given order", () => {
    render(<Standings rows={rows} />);

    const dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows).toHaveLength(3);
    expect(dataRows[0]).toHaveTextContent("Alice");
    expect(dataRows[0]).toHaveTextContent("6");
    expect(dataRows[1]).toHaveTextContent("Bob");
    expect(dataRows[1]).toHaveTextContent("-1");
    expect(dataRows[2]).toHaveTextContent("Carol");
  });

  it("renders the column headers", () => {
    render(<Standings rows={rows} />);

    expect(screen.getByText("Player")).toBeInTheDocument();
    expect(screen.getByText("Legs Won")).toBeInTheDocument();
    expect(screen.getByText("Legs Lost")).toBeInTheDocument();
    expect(screen.getByText("Diff")).toBeInTheDocument();
    expect(screen.getByText("Highest Checkout")).toBeInTheDocument();
  });

  it("shows only the header row when there are no rows", () => {
    render(<Standings rows={[]} />);

    expect(screen.getAllByRole("row")).toHaveLength(1);
  });

  it("renders each player's highest checkout, or a dash when null", () => {
    render(<Standings rows={rows} />);

    const dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("80");
    expect(within(dataRows[1]).getByText("—")).toBeInTheDocument();
    expect(dataRows[2]).toHaveTextContent("150");
  });

  it("sorts by a column ascending on first click, descending on second click", async () => {
    render(<Standings rows={rows} />);

    await userEvent.click(screen.getByRole("button", { name: "Legs Won" }));
    let dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Carol");
    expect(dataRows[1]).toHaveTextContent("Bob");
    expect(dataRows[2]).toHaveTextContent("Alice");
    expect(screen.getByRole("columnheader", { name: /Legs Won/ })).toHaveAttribute("aria-sort", "ascending");

    await userEvent.click(screen.getByRole("button", { name: /Legs Won/ }));
    dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Alice");
    expect(dataRows[1]).toHaveTextContent("Bob");
    expect(dataRows[2]).toHaveTextContent("Carol");
    expect(screen.getByRole("columnheader", { name: /Legs Won/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("keeps each row's rank unchanged when the table is sorted by a different column", async () => {
    render(<Standings rows={rows} />);

    await userEvent.click(screen.getByRole("button", { name: "Legs Won" }));

    const dataRows = screen.getAllByRole("row").slice(1);
    const firstRowCells = within(dataRows[0]).getAllByRole("cell");
    expect(firstRowCells[0]).toHaveTextContent("3");
    expect(firstRowCells[1]).toHaveTextContent("Carol");
  });

  it("sorts nulls last for Highest Checkout in both directions", async () => {
    render(<Standings rows={rows} />);

    await userEvent.click(screen.getByRole("button", { name: "Highest Checkout" }));
    let dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Alice");
    expect(dataRows[1]).toHaveTextContent("Carol");
    expect(dataRows[2]).toHaveTextContent("Bob");

    await userEvent.click(screen.getByRole("button", { name: /Highest Checkout/ }));
    dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Carol");
    expect(dataRows[1]).toHaveTextContent("Alice");
    expect(dataRows[2]).toHaveTextContent("Bob");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- Standings.test
```
Expected: FAIL — no "Highest Checkout" column exists yet, no sortable headers, and `rows` fixtures don't type-check without `highestCheckout` in the component's expectations (the fixtures themselves already have it from Task 2's type change, but `Standings.tsx` doesn't render or sort by it yet).

- [ ] **Step 3: Replace `src/pages/season/Standings.tsx`**

```typescript
import { useState } from "react";
import type { StandingsRow } from "../../lib/standings";
import {
  toggleSort,
  sortRows,
  numericComparator,
  stringComparator,
  type SortState,
  type SortComparator,
} from "../../lib/sortable";

type StandingsProps = {
  rows: StandingsRow[];
};

type Column = "rank" | "player" | "matchesPlayed" | "legsWon" | "legsLost" | "diff" | "highestCheckout";

const comparators: Record<Column, SortComparator<StandingsRow>> = {
  rank: numericComparator<StandingsRow>((r) => r.rank),
  player: stringComparator<StandingsRow>((r) => r.player.displayName),
  matchesPlayed: numericComparator<StandingsRow>((r) => r.matchesPlayed),
  legsWon: numericComparator<StandingsRow>((r) => r.legsWon),
  legsLost: numericComparator<StandingsRow>((r) => r.legsLost),
  diff: numericComparator<StandingsRow>((r) => r.diff),
  highestCheckout: numericComparator<StandingsRow>((r) => r.highestCheckout, { nullsLast: true }),
};

const columnLabels: Record<Column, string> = {
  rank: "Rank",
  player: "Player",
  matchesPlayed: "MP",
  legsWon: "Legs Won",
  legsLost: "Legs Lost",
  diff: "Diff",
  highestCheckout: "Highest Checkout",
};

export default function Standings({ rows }: StandingsProps) {
  const [sort, setSort] = useState<SortState<Column>>(null);
  const sortedRows = sortRows(rows, sort, comparators);

  function renderHeader(column: Column, className: string) {
    let direction: "asc" | "desc" | null = null;
    if (sort && sort.column === column) {
      direction = sort.direction;
    }
    const ariaSort = direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";

    return (
      <th className={className} aria-sort={ariaSort}>
        <button type="button" onClick={() => setSort(toggleSort(sort, column))} className="underline">
          {columnLabels[column]}
          {direction === "asc" && " ▲"}
          {direction === "desc" && " ▼"}
        </button>
      </th>
    );
  }

  return (
    <table className="mb-6 w-full text-left text-sm">
      <caption className="font-heading mb-2 text-left font-semibold">Standings</caption>
      <thead>
        <tr className="border-b border-gray-300">
          {renderHeader("rank", "py-1 pr-2")}
          {renderHeader("player", "py-1 pr-2")}
          {renderHeader("matchesPlayed", "py-1 pr-2 text-right")}
          {renderHeader("legsWon", "py-1 pr-2 text-right")}
          {renderHeader("legsLost", "py-1 pr-2 text-right")}
          {renderHeader("diff", "py-1 pr-2 text-right")}
          {renderHeader("highestCheckout", "py-1 text-right")}
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => (
          <tr key={row.player.id} className="border-b border-gray-100">
            <td className="py-1 pr-2">{row.rank}</td>
            <td className="py-1 pr-2">{row.player.displayName}</td>
            <td className="py-1 pr-2 text-right">{row.matchesPlayed}</td>
            <td className="py-1 pr-2 text-right">{row.legsWon}</td>
            <td className="py-1 pr-2 text-right">{row.legsLost}</td>
            <td className="py-1 pr-2 text-right">{row.diff}</td>
            <td className="py-1 text-right">{row.highestCheckout ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- Standings.test
```
Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc -b && vite build` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/season/Standings.tsx src/pages/season/Standings.test.tsx
git commit -m "Add Highest Checkout column and sortable headers to Standings"
```

---

### Task 4: Sortable `PlayerStats` table

**Files:**
- Modify: `src/pages/season/PlayerStats.tsx`
- Modify: `src/pages/season/PlayerStats.test.tsx`

**Interfaces:**
- Consumes: `toggleSort`, `sortRows`, `numericComparator`, `stringComparator`, `SortState`, `SortComparator` from Task 1 (`src/lib/sortable.ts`).
- Produces: `PlayerStats` unchanged prop signature (`{ stats: SeasonPlayerStat[] }`), now renders clickable sortable headers on all three columns.

- [ ] **Step 1: Replace `src/pages/season/PlayerStats.test.tsx`**

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("sorts by a column ascending on first click, descending on second click", async () => {
    render(<PlayerStats stats={stats} />);

    await userEvent.click(screen.getByRole("button", { name: "3-Dart Avg" }));
    let dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Bob");
    expect(dataRows[1]).toHaveTextContent("Alice");
    expect(screen.getByRole("columnheader", { name: /3-Dart Avg/ })).toHaveAttribute("aria-sort", "ascending");

    await userEvent.click(screen.getByRole("button", { name: /3-Dart Avg/ }));
    dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Alice");
    expect(dataRows[1]).toHaveTextContent("Bob");
    expect(screen.getByRole("columnheader", { name: /3-Dart Avg/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("sorts by player name case-insensitively", async () => {
    render(
      <PlayerStats
        stats={[
          { playerId: 1, displayName: "bob", threeDartAverage: 50, oneEightyCount: 1 },
          { playerId: 2, displayName: "Alice", threeDartAverage: 40, oneEightyCount: 0 },
        ]}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Player" }));

    const dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("Alice");
    expect(dataRows[1]).toHaveTextContent("bob");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- PlayerStats.test
```
Expected: FAIL — no sortable headers exist yet.

- [ ] **Step 3: Replace `src/pages/season/PlayerStats.tsx`**

```typescript
import { useState } from "react";
import type { SeasonPlayerStat } from "../../lib/api-client";
import {
  toggleSort,
  sortRows,
  numericComparator,
  stringComparator,
  type SortState,
  type SortComparator,
} from "../../lib/sortable";

type PlayerStatsProps = {
  stats: SeasonPlayerStat[];
};

type Column = "displayName" | "threeDartAverage" | "oneEightyCount";

const comparators: Record<Column, SortComparator<SeasonPlayerStat>> = {
  displayName: stringComparator<SeasonPlayerStat>((s) => s.displayName),
  threeDartAverage: numericComparator<SeasonPlayerStat>((s) => s.threeDartAverage),
  oneEightyCount: numericComparator<SeasonPlayerStat>((s) => s.oneEightyCount),
};

const columnLabels: Record<Column, string> = {
  displayName: "Player",
  threeDartAverage: "3-Dart Avg",
  oneEightyCount: "180s",
};

export default function PlayerStats({ stats }: PlayerStatsProps) {
  const [sort, setSort] = useState<SortState<Column>>(null);
  const sortedStats = sortRows(stats, sort, comparators);

  function renderHeader(column: Column, className: string) {
    let direction: "asc" | "desc" | null = null;
    if (sort && sort.column === column) {
      direction = sort.direction;
    }
    const ariaSort = direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";

    return (
      <th className={className} aria-sort={ariaSort}>
        <button type="button" onClick={() => setSort(toggleSort(sort, column))} className="underline">
          {columnLabels[column]}
          {direction === "asc" && " ▲"}
          {direction === "desc" && " ▼"}
        </button>
      </th>
    );
  }

  return (
    <table className="mb-6 w-full text-left text-sm">
      <caption className="font-heading mb-2 text-left font-semibold">Player Stats</caption>
      <thead>
        <tr className="border-b border-gray-300">
          {renderHeader("displayName", "py-1 pr-2")}
          {renderHeader("threeDartAverage", "py-1 pr-2 text-right")}
          {renderHeader("oneEightyCount", "py-1 text-right")}
        </tr>
      </thead>
      <tbody>
        {sortedStats.map((stat) => (
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

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- PlayerStats.test
```
Expected: PASS — all 5 tests pass.

- [ ] **Step 5: Verify the whole project builds and the full suite passes**

```bash
npm run build
npm test
```
Expected: both succeed with no errors — this is the last task in the plan, so the full suite (not just this file) must be green, including `SeasonStandings.test.tsx` and `SeasonDetail.test.tsx`, which render `Standings`/`PlayerStats` through real `computeStandings` output and aren't expected to need any changes themselves.

- [ ] **Step 6: Commit**

```bash
git add src/pages/season/PlayerStats.tsx src/pages/season/PlayerStats.test.tsx
git commit -m "Add sortable headers to PlayerStats"
```

---

## Manual E2E Verification (after all tasks)

Once every task above is committed, do a manual pass in the browser (per the project's `run` skill):
1. On `/season/standings` (and an archived season's page, `/seasons/:id`), confirm the new "Highest Checkout" column shows each player's own best checkout, or "—" if they haven't recorded one.
2. Click each column header on the Standings table in turn; confirm the table re-sorts, an arrow appears on the active column, and clicking the same header again reverses the order.
3. Confirm the Rank column's numbers don't change when sorting by a different column — only the row order changes.
4. Click each column header on the Player Stats table; confirm the same sorting behavior.
5. Confirm a player with no recorded checkout ("—") always sorts to the bottom of the Highest Checkout column, in both ascending and descending order.
