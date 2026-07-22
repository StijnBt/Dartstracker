# Highest Checkout Award Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every logged-in user a season's "Highest Checkout" award (the player, or tied players, with the single highest recorded checkout across the whole season) on both the active season page and any archived season page.

**Architecture:** A pure client-side derivation module (`src/lib/awards.ts`) computes the award from the `Season` object the pages already fetch — no new API endpoint, no new data model. A shared presentational component (`src/pages/season/HighestCheckoutAward.tsx`) renders the result, reused by both `Season.tsx` and `SeasonDetail.tsx`, placed above the existing `Standings` table.

**Tech Stack:** No new dependencies. Same stack as prior phases (React, Vitest, React Testing Library).

## Global Constraints

- The award is the single highest value across every match's `player1Checkout`/`player2Checkout` fields (already populated for every match, live-scored or manually entered) — no separate data entry, no new backend logic.
- Ties are allowed and share the award — no tie-break (notes.md §3.8).
- If no match in the season has any recorded checkout, render a placeholder message rather than hiding the section.
- Out of scope: three-dart average, checkout percentage, count of 180s — explicitly deferred future statistics per notes.md §3.8, not part of this phase.
- No new routes, no new API calls, no backend changes.

---

### Task 1: `computeHighestCheckout` — pure derivation module

**Files:**
- Create: `src/lib/awards.ts`
- Test: `src/lib/awards.test.ts`

**Interfaces:**
- Consumes: `SeasonMatch`, `SeasonParticipantSummary` types from `./api-client` (already exist).
- Produces: `HighestCheckoutAward` (`{ value: number; players: SeasonParticipantSummary[] } | null`) and `computeHighestCheckout(participants: SeasonParticipantSummary[], matches: SeasonMatch[]): HighestCheckoutAward` — both named exports from `src/lib/awards.ts`. Task 2 (`HighestCheckoutAward.tsx`) imports `HighestCheckoutAward`; Task 3 (`Season.tsx`/`SeasonDetail.tsx`) imports `computeHighestCheckout`.

- [ ] **Step 1: Write the failing test — `src/lib/awards.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { computeHighestCheckout } from "./awards";
import type { SeasonMatch, SeasonParticipantSummary } from "./api-client";

const alice: SeasonParticipantSummary = { id: 1, displayName: "Alice" };
const bob: SeasonParticipantSummary = { id: 2, displayName: "Bob" };
const carol: SeasonParticipantSummary = { id: 3, displayName: "Carol" };

function playedMatch(
  id: number,
  player1: SeasonParticipantSummary,
  player2: SeasonParticipantSummary,
  player1Checkout: number | null,
  player2Checkout: number | null
): SeasonMatch {
  return {
    id,
    roundNumber: 1,
    date: "2026-08-01",
    status: "played",
    player1,
    player2,
    player1Legs: 3,
    player2Legs: 1,
    player1Checkout,
    player2Checkout,
    resultEnteredBy: null,
    resultEnteredAt: null,
  };
}

function unplayedMatch(id: number, player1: SeasonParticipantSummary, player2: SeasonParticipantSummary): SeasonMatch {
  return {
    id,
    roundNumber: 1,
    date: "2026-08-01",
    status: "scheduled",
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

describe("computeHighestCheckout", () => {
  it("returns the single player with the highest checkout", () => {
    const matches = [playedMatch(1, alice, bob, 121, 40), playedMatch(2, bob, carol, 60, 32)];
    const award = computeHighestCheckout([alice, bob, carol], matches);

    expect(award).toEqual({ value: 121, players: [alice] });
  });

  it("credits the player whether they are player1 or player2 in the checkout-holding match", () => {
    const matches = [playedMatch(1, alice, bob, 40, 121)];
    const award = computeHighestCheckout([alice, bob], matches);

    expect(award).toEqual({ value: 121, players: [bob] });
  });

  it("shares the award on a tie", () => {
    const matches = [playedMatch(1, alice, bob, 100, 40), playedMatch(2, bob, carol, 40, 100)];
    const award = computeHighestCheckout([alice, bob, carol], matches);

    expect(award).not.toBeNull();
    expect(award!.value).toBe(100);
    expect(award!.players.map((p) => p.id).sort()).toEqual([alice.id, carol.id].sort());
  });

  it("ignores matches with no recorded checkout", () => {
    const matches = [unplayedMatch(1, alice, bob), playedMatch(2, alice, bob, null, null), playedMatch(3, alice, bob, 85, null)];
    const award = computeHighestCheckout([alice, bob], matches);

    expect(award).toEqual({ value: 85, players: [alice] });
  });

  it("returns null when no match has a recorded checkout", () => {
    const matches = [unplayedMatch(1, alice, bob), playedMatch(2, alice, bob, null, null)];
    const award = computeHighestCheckout([alice, bob], matches);

    expect(award).toBeNull();
  });

  it("returns null for an empty match list", () => {
    expect(computeHighestCheckout([alice, bob], [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/lib/awards.ts` does not exist.

- [ ] **Step 3: Create `src/lib/awards.ts`**

```typescript
import type { SeasonMatch, SeasonParticipantSummary } from "./api-client";

export type HighestCheckoutAward = {
  value: number;
  players: SeasonParticipantSummary[];
} | null;

export function computeHighestCheckout(
  participants: SeasonParticipantSummary[],
  matches: SeasonMatch[]
): HighestCheckoutAward {
  let value: number | null = null;
  const holders = new Map<number, SeasonParticipantSummary>();

  function consider(player: SeasonParticipantSummary, checkout: number | null) {
    if (checkout === null) return;
    if (value === null || checkout > value) {
      value = checkout;
      holders.clear();
      holders.set(player.id, player);
    } else if (checkout === value) {
      holders.set(player.id, player);
    }
  }

  for (const match of matches) {
    consider(match.player1, match.player1Checkout);
    consider(match.player2, match.player2Checkout);
  }

  if (value === null) return null;
  return { value, players: [...holders.values()] };
}
```

Note: `participants` is accepted for signature consistency with `computeStandings` and future-proofing, even though every checkout holder is already present via `match.player1`/`match.player2`.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including all new tests in `awards.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/awards.ts src/lib/awards.test.ts
git commit -m "Add computeHighestCheckout (season award, ties shared)"
```

---

### Task 2: `HighestCheckoutAward` presentational component

**Files:**
- Create: `src/pages/season/HighestCheckoutAward.tsx`
- Test: `src/pages/season/HighestCheckoutAward.test.tsx`

**Interfaces:**
- Consumes: `HighestCheckoutAward` type from `../../lib/awards` (Task 1).
- Produces: default export `HighestCheckoutAward` React component, taking `{ award: HighestCheckoutAward }`. Consumed by Task 3 (`Season.tsx`, `SeasonDetail.tsx`).

- [ ] **Step 1: Write the failing test — `src/pages/season/HighestCheckoutAward.test.tsx`**

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import HighestCheckoutAward from "./HighestCheckoutAward";

describe("HighestCheckoutAward", () => {
  it("renders the value and player name for a single holder", () => {
    render(<HighestCheckoutAward award={{ value: 121, players: [{ id: 1, displayName: "Alice" }] }} />);

    expect(screen.getByText(/Highest Checkout/)).toBeInTheDocument();
    expect(screen.getByText(/121/)).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it("renders every tied player's name, comma-separated", () => {
    render(
      <HighestCheckoutAward
        award={{
          value: 100,
          players: [
            { id: 1, displayName: "Alice" },
            { id: 3, displayName: "Carol" },
          ],
        }}
      />
    );

    expect(screen.getByText(/Alice, Carol/)).toBeInTheDocument();
  });

  it("renders a placeholder when no award is recorded yet", () => {
    render(<HighestCheckoutAward award={null} />);

    expect(screen.getByText("No checkouts recorded yet")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/pages/season/HighestCheckoutAward.tsx` does not exist.

- [ ] **Step 3: Create `src/pages/season/HighestCheckoutAward.tsx`**

```typescript
import type { HighestCheckoutAward as HighestCheckoutAwardType } from "../../lib/awards";

type HighestCheckoutAwardProps = {
  award: HighestCheckoutAwardType;
};

export default function HighestCheckoutAward({ award }: HighestCheckoutAwardProps) {
  return (
    <p className="mb-6 text-sm">
      {award === null ? (
        "No checkouts recorded yet"
      ) : (
        <>
          Highest Checkout: <strong>{award.value}</strong> —{" "}
          {award.players.map((p) => p.displayName).join(", ")}
        </>
      )}
    </p>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including all new tests in `HighestCheckoutAward.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/season/HighestCheckoutAward.tsx src/pages/season/HighestCheckoutAward.test.tsx
git commit -m "Add HighestCheckoutAward component"
```

---

### Task 3: Wire `HighestCheckoutAward` into `Season.tsx` and `SeasonDetail.tsx`

**Files:**
- Modify: `src/pages/season/Season.tsx`
- Modify: `src/pages/season/Season.test.tsx`
- Modify: `src/pages/season/SeasonDetail.tsx`
- Modify: `src/pages/season/SeasonDetail.test.tsx`

**Interfaces:**
- Consumes: `computeHighestCheckout` from `../../lib/awards` (Task 1), `HighestCheckoutAward` default export from `./HighestCheckoutAward` (Task 2).

- [ ] **Step 1: Add a failing test to `src/pages/season/Season.test.tsx`**

Append inside the existing `describe("SeasonPage", ...)` block, after the `"renders a standings table computed from the season's matches"` test:

```typescript
  it("renders the highest checkout award computed from the season's matches", async () => {
    mockNonParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      ...season,
      matches: [{ ...season.matches[0], status: "played", player1Legs: 3, player2Legs: 1, player1Checkout: 121 }],
    });
    render(
      <MemoryRouter>
        <SeasonPage />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    expect(screen.getByText(/Highest Checkout/)).toBeInTheDocument();
    expect(screen.getByText(/121/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Add a failing test to `src/pages/season/SeasonDetail.test.tsx`**

Append inside the existing `describe("SeasonDetail", ...)` block, after the `"renders a standings table computed from the season's matches"` test:

```typescript
  it("renders the highest checkout award computed from the season's matches", async () => {
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
          player1Checkout: 85,
          player2Checkout: null,
          resultEnteredBy: null,
          resultEnteredAt: null,
        },
      ],
    });

    renderWithRouter("1");

    await waitFor(() => expect(screen.getByText("Winter 2025")).toBeInTheDocument());
    expect(screen.getByText(/Highest Checkout/)).toBeInTheDocument();
    expect(screen.getByText(/85/)).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `npm test`
Expected: FAIL — neither page renders "Highest Checkout" yet.

- [ ] **Step 4: Modify `src/pages/season/Season.tsx`**

Change the import block:
```typescript
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { listSeasons, getSeason, archiveSeason, updateMatch, type Season, type SeasonMatch } from "../../lib/api-client";
import { computeStandings } from "../../lib/standings";
import RoundRobinSchedule, { formatMatchSummary } from "./RoundRobinSchedule";
import Standings from "./Standings";
```
to:
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

Change the render block:
```typescript
      <Standings rows={computeStandings(season.participants, season.matches)} />
      <RoundRobinSchedule
        matches={season.matches}
        participants={season.participants}
```
to:
```typescript
      <HighestCheckoutAward award={computeHighestCheckout(season.participants, season.matches)} />
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
import { computeStandings } from "../../lib/standings";
import RoundRobinSchedule from "./RoundRobinSchedule";
import Standings from "./Standings";
```
to:
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

Change the render block:
```typescript
      <Standings rows={computeStandings(season.participants, season.matches)} />
      <RoundRobinSchedule matches={season.matches} participants={season.participants} />
```
to:
```typescript
      <HighestCheckoutAward award={computeHighestCheckout(season.participants, season.matches)} />
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
git commit -m "Show highest checkout award on the active and archived season pages"
```

---
