# Standings / Tie-Break Calculation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every logged-in user a season's standings table (legs won descending, leg differential as tie-break) on both the active season page and any archived season page.

**Architecture:** A pure client-side derivation module (`src/lib/standings.ts`) computes standings from the `Season` object the pages already fetch — no new API endpoint, no new data model. A shared presentational component (`src/pages/season/Standings.tsx`) renders the resulting rows as a table, reused by both `Season.tsx` and `SeasonDetail.tsx`.

**Tech Stack:** No new dependencies. Same stack as prior phases (React, Vitest, React Testing Library).

## Global Constraints

- Primary sort key: total legs won across the season (descending). Tie-break: leg differential, legs won minus legs lost (descending). No separate win/loss points system.
- Only matches with `status === "played"` contribute legs to a player's totals — `"scheduled"`, `"cancelled"`, and `"in_progress"` matches contribute nothing (forfeit/unplayed-match scoring is explicitly out of scope per notes.md §3.6).
- Players tied on both legs won and differential share the same rank number; the next distinct row's rank is its 1-based position in the sorted list (standard competition ranking — two players tied for rank 1 are followed by a player at rank 3, not 2).
- A season participant with zero played matches still appears in the standings (0 matches played, 0-0-0, tied for last) — never hidden.
- No new routes, no new API calls, no backend changes.

---

### Task 1: `computeStandings` — pure derivation module

**Files:**
- Create: `src/lib/standings.ts`
- Test: `src/lib/standings.test.ts`

**Interfaces:**
- Consumes: `SeasonMatch`, `SeasonParticipantSummary` types from `./api-client` (already exist).
- Produces: `StandingsRow` (`{ player: SeasonParticipantSummary; matchesPlayed: number; legsWon: number; legsLost: number; diff: number; rank: number }`) and `computeStandings(participants: SeasonParticipantSummary[], matches: SeasonMatch[]): StandingsRow[]` — both named exports from `src/lib/standings.ts`. Task 2 (`Standings.tsx`) imports `StandingsRow`; Task 3 (`Season.tsx`/`SeasonDetail.tsx`) imports `computeStandings`.

- [ ] **Step 1: Write the failing test — `src/lib/standings.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { computeStandings } from "./standings";
import type { SeasonMatch, SeasonParticipantSummary } from "./api-client";

const alice: SeasonParticipantSummary = { id: 1, displayName: "Alice" };
const bob: SeasonParticipantSummary = { id: 2, displayName: "Bob" };
const carol: SeasonParticipantSummary = { id: 3, displayName: "Carol" };

function playedMatch(
  id: number,
  player1: SeasonParticipantSummary,
  player2: SeasonParticipantSummary,
  player1Legs: number,
  player2Legs: number
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
    player1Checkout: null,
    player2Checkout: null,
    resultEnteredBy: null,
    resultEnteredAt: null,
  };
}

function unplayedMatch(
  id: number,
  player1: SeasonParticipantSummary,
  player2: SeasonParticipantSummary,
  status: "scheduled" | "cancelled" | "in_progress"
): SeasonMatch {
  return {
    id,
    roundNumber: 1,
    date: "2026-08-01",
    status,
    player1,
    player2,
    player1Legs: null,
    player2Legs: null,
    player1Checkout: null,
    player2Checkout: null,
    resultEnteredBy: null,
    resultEnteredAt: null,
  };
}

describe("computeStandings", () => {
  it("sorts by total legs won descending", () => {
    const rows = computeStandings([alice, bob], [playedMatch(1, alice, bob, 3, 1)]);

    expect(rows.map((r) => r.player.displayName)).toEqual(["Alice", "Bob"]);
    expect(rows[0]).toMatchObject({ legsWon: 3, legsLost: 1, diff: 2, matchesPlayed: 1, rank: 1 });
    expect(rows[1]).toMatchObject({ legsWon: 1, legsLost: 3, diff: -2, matchesPlayed: 1, rank: 2 });
  });

  it("breaks a legs-won tie using leg differential", () => {
    const matches = [
      playedMatch(1, alice, carol, 3, 0),
      playedMatch(2, carol, alice, 3, 0),
      playedMatch(3, bob, carol, 3, 1),
    ];
    const rows = computeStandings([alice, bob, carol], matches);
    const alicesRow = rows.find((r) => r.player.id === alice.id)!;
    const bobsRow = rows.find((r) => r.player.id === bob.id)!;

    expect(alicesRow.legsWon).toBe(3);
    expect(alicesRow.diff).toBe(0);
    expect(bobsRow.legsWon).toBe(3);
    expect(bobsRow.diff).toBe(2);
    expect(bobsRow.rank).toBeLessThan(alicesRow.rank);
  });

  it("gives tied players the same rank and skips the next rank accordingly", () => {
    const matches = [playedMatch(1, alice, carol, 3, 0), playedMatch(2, bob, carol, 3, 0)];
    const rows = computeStandings([alice, bob, carol], matches);
    const byName = (name: string) => rows.find((r) => r.player.displayName === name)!;

    expect(byName("Alice").rank).toBe(1);
    expect(byName("Bob").rank).toBe(1);
    expect(byName("Carol").rank).toBe(3);
  });

  it("excludes unplayed, cancelled, and in-progress matches from the totals", () => {
    const matches = [
      playedMatch(1, alice, bob, 3, 1),
      unplayedMatch(2, alice, bob, "scheduled"),
      unplayedMatch(3, alice, bob, "cancelled"),
      unplayedMatch(4, alice, bob, "in_progress"),
    ];
    const rows = computeStandings([alice, bob], matches);
    const alicesRow = rows.find((r) => r.player.id === alice.id)!;

    expect(alicesRow.matchesPlayed).toBe(1);
    expect(alicesRow.legsWon).toBe(3);
    expect(alicesRow.legsLost).toBe(1);
  });

  it("includes a participant with zero played matches", () => {
    const rows = computeStandings([alice, bob, carol], [playedMatch(1, alice, bob, 3, 0)]);
    const carolsRow = rows.find((r) => r.player.id === carol.id)!;

    expect(carolsRow).toMatchObject({ matchesPlayed: 0, legsWon: 0, legsLost: 0, diff: 0 });
  });

  it("accumulates legs whether the player is player1 or player2 across matches", () => {
    const matches = [playedMatch(1, alice, bob, 3, 1), playedMatch(2, bob, alice, 2, 3)];
    const rows = computeStandings([alice, bob], matches);
    const alicesRow = rows.find((r) => r.player.id === alice.id)!;

    expect(alicesRow).toMatchObject({ matchesPlayed: 2, legsWon: 6, legsLost: 3, diff: 3 });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/lib/standings.ts` does not exist.

- [ ] **Step 3: Create `src/lib/standings.ts`**

```typescript
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
  const playedMatches = matches.filter((m) => m.status === "played");

  const rows: StandingsRow[] = participants.map((player) => {
    let matchesPlayed = 0;
    let legsWon = 0;
    let legsLost = 0;

    for (const match of playedMatches) {
      if (match.player1.id === player.id) {
        matchesPlayed++;
        legsWon += match.player1Legs ?? 0;
        legsLost += match.player2Legs ?? 0;
      } else if (match.player2.id === player.id) {
        matchesPlayed++;
        legsWon += match.player2Legs ?? 0;
        legsLost += match.player1Legs ?? 0;
      }
    }

    return { player, matchesPlayed, legsWon, legsLost, diff: legsWon - legsLost, rank: 0 };
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

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including all new tests in `standings.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/standings.ts src/lib/standings.test.ts
git commit -m "Add computeStandings (legs-won ranking with differential tie-break)"
```

---

### Task 2: `Standings` presentational component

**Files:**
- Create: `src/pages/season/Standings.tsx`
- Test: `src/pages/season/Standings.test.tsx`

**Interfaces:**
- Consumes: `StandingsRow` from `../../lib/standings` (Task 1).
- Produces: default export `Standings` React component, taking `{ rows: StandingsRow[] }`. Consumed by Task 3 (`Season.tsx`, `SeasonDetail.tsx`).

- [ ] **Step 1: Write the failing test — `src/pages/season/Standings.test.tsx`**

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Standings from "./Standings";
import type { StandingsRow } from "../../lib/standings";

const rows: StandingsRow[] = [
  { player: { id: 1, displayName: "Alice" }, matchesPlayed: 2, legsWon: 6, legsLost: 1, diff: 5, rank: 1 },
  { player: { id: 2, displayName: "Bob" }, matchesPlayed: 2, legsWon: 3, legsLost: 4, diff: -1, rank: 2 },
];

describe("Standings", () => {
  it("renders a row per player with rank, name, and stats, in the given order", () => {
    render(<Standings rows={rows} />);

    const dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows).toHaveLength(2);
    expect(dataRows[0]).toHaveTextContent("Alice");
    expect(dataRows[0]).toHaveTextContent("6");
    expect(dataRows[1]).toHaveTextContent("Bob");
    expect(dataRows[1]).toHaveTextContent("-1");
  });

  it("renders the column headers", () => {
    render(<Standings rows={rows} />);

    expect(screen.getByText("Player")).toBeInTheDocument();
    expect(screen.getByText("Legs Won")).toBeInTheDocument();
    expect(screen.getByText("Legs Lost")).toBeInTheDocument();
    expect(screen.getByText("Diff")).toBeInTheDocument();
  });

  it("shows only the header row when there are no rows", () => {
    render(<Standings rows={[]} />);

    expect(screen.getAllByRole("row")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/pages/season/Standings.tsx` does not exist.

- [ ] **Step 3: Create `src/pages/season/Standings.tsx`**

```typescript
import type { StandingsRow } from "../../lib/standings";

type StandingsProps = {
  rows: StandingsRow[];
};

export default function Standings({ rows }: StandingsProps) {
  return (
    <table className="mb-6 w-full text-left text-sm">
      <caption className="font-heading mb-2 text-left font-semibold">Standings</caption>
      <thead>
        <tr className="border-b border-gray-300">
          <th className="py-1 pr-2">Rank</th>
          <th className="py-1 pr-2">Player</th>
          <th className="py-1 pr-2 text-right">MP</th>
          <th className="py-1 pr-2 text-right">Legs Won</th>
          <th className="py-1 pr-2 text-right">Legs Lost</th>
          <th className="py-1 text-right">Diff</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.player.id} className="border-b border-gray-100">
            <td className="py-1 pr-2">{row.rank}</td>
            <td className="py-1 pr-2">{row.player.displayName}</td>
            <td className="py-1 pr-2 text-right">{row.matchesPlayed}</td>
            <td className="py-1 pr-2 text-right">{row.legsWon}</td>
            <td className="py-1 pr-2 text-right">{row.legsLost}</td>
            <td className="py-1 text-right">{row.diff}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including all new tests in `Standings.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/season/Standings.tsx src/pages/season/Standings.test.tsx
git commit -m "Add Standings table component"
```

---

### Task 3: Wire `Standings` into `Season.tsx` and `SeasonDetail.tsx`

**Files:**
- Modify: `src/pages/season/Season.tsx`
- Modify: `src/pages/season/Season.test.tsx`
- Modify: `src/pages/season/SeasonDetail.tsx`
- Modify: `src/pages/season/SeasonDetail.test.tsx`

**Interfaces:**
- Consumes: `computeStandings` from `../../lib/standings` (Task 1), `Standings` default export from `./Standings` (Task 2).

- [ ] **Step 1: Add a failing test to `src/pages/season/Season.test.tsx`**

Append inside the existing `describe("SeasonPage", ...)` block, after the `"renders the active season's schedule"` test:

```typescript
  it("renders a standings table computed from the season's matches", async () => {
    mockNonParticipant();
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

    expect(screen.getByText("Legs Won")).toBeInTheDocument();
    const administratorRow = screen.getByText("Administrator").closest("tr")!;
    expect(administratorRow).toHaveTextContent("3");
  });
```

- [ ] **Step 2: Add a failing test to `src/pages/season/SeasonDetail.test.tsx`**

Append inside the existing `describe("SeasonDetail", ...)` block, after the `"renders the season's read-only schedule"` test:

```typescript
  it("renders a standings table computed from the season's matches", async () => {
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

    renderWithRouter("1");

    await waitFor(() => expect(screen.getByText("Winter 2025")).toBeInTheDocument());
    expect(screen.getByText("Legs Won")).toBeInTheDocument();
    const administratorRow = screen.getByText("Administrator").closest("tr")!;
    expect(administratorRow).toHaveTextContent("3");
  });
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `npm test`
Expected: FAIL — neither page renders a "Legs Won" column yet.

- [ ] **Step 4: Modify `src/pages/season/Season.tsx`**

Change the import block:
```typescript
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { listSeasons, getSeason, archiveSeason, updateMatch, type Season, type SeasonMatch } from "../../lib/api-client";
import RoundRobinSchedule, { formatMatchSummary } from "./RoundRobinSchedule";
```
to:
```typescript
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { listSeasons, getSeason, archiveSeason, updateMatch, type Season, type SeasonMatch } from "../../lib/api-client";
import { computeStandings } from "../../lib/standings";
import RoundRobinSchedule, { formatMatchSummary } from "./RoundRobinSchedule";
import Standings from "./Standings";
```

Change the render block:
```typescript
      <RoundRobinSchedule
        matches={season.matches}
        participants={season.participants}
```
to:
```typescript
      <Standings rows={computeStandings(season.participants, season.matches)} />
      <RoundRobinSchedule
        matches={season.matches}
        participants={season.participants}
```

- [ ] **Step 5: Modify `src/pages/season/SeasonDetail.tsx`**

Change the import block:
```typescript
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSeason, type Season } from "../../lib/api-client";
import RoundRobinSchedule from "./RoundRobinSchedule";
```
to:
```typescript
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSeason, type Season } from "../../lib/api-client";
import { computeStandings } from "../../lib/standings";
import RoundRobinSchedule from "./RoundRobinSchedule";
import Standings from "./Standings";
```

Change the render block:
```typescript
      <RoundRobinSchedule matches={season.matches} participants={season.participants} />
```
to:
```typescript
      <Standings rows={computeStandings(season.participants, season.matches)} />
      <RoundRobinSchedule matches={season.matches} participants={season.participants} />
```

- [ ] **Step 6: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS — the whole suite passes, including the two new tests and all pre-existing `Season.test.tsx`/`SeasonDetail.test.tsx` tests unchanged.

- [ ] **Step 7: Verify the project builds**

Run: `npm run build`
Expected: `tsc` succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add src/pages/season/Season.tsx src/pages/season/Season.test.tsx src/pages/season/SeasonDetail.tsx src/pages/season/SeasonDetail.test.tsx
git commit -m "Show standings on the active and archived season pages"
```

---
