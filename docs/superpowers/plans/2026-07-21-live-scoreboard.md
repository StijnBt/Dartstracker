# Live Scoreboard (Throw-by-Throw Match Scoring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin or either match participant run a live, throw-by-throw scoring session for a 501 double-out match on a single shared device, with the server as sole authority on remaining score, bust detection, checkout validation, leg completion, and match completion.

**Architecture:** Backend: a pure domain module (`api/src/lib/liveScoring.ts`) that replays a match's stored throws from scratch to derive bust flags, leg winners, and match completion (no DB access, fully unit-testable); a thin DB orchestration module (`api/src/lib/liveScoringStore.ts`) that loads/persists that derived state inside a Prisma transaction; and four new Azure Functions endpoints under `/api/matches/{id}/live`. Frontend: a new `LiveScoring` page with a multiplier+number tap grid, wired into `Season.tsx` alongside the existing manual result-entry link.

**Tech Stack:** No new dependencies. Same stack as prior phases (Prisma, `@azure/functions` v4, Vitest, React Testing Library, react-router-dom v7).

## Global Constraints

- Game is 501, double-out. A match is won by the first player to win 3 legs (best of 5).
- Single shared-device model: one scorer enters darts for both players; no multi-device real-time sync.
- Every individual dart is persisted as its own `Throw` row (full throw-by-throw history), not just leg/match outcomes.
- The server is the sole authority on remaining score, bust detection, and checkout validation — the client only sends `{multiplier, segment}` and renders whatever state the server returns.
- Bust conditions: a throw that takes the score below 0, to exactly 1, or to exactly 0 without the final dart of the turn being a double (including double bull = 50) voids that whole turn (score reverts to its value at the start of the turn).
- Bull: `segment = 25`; `multiplier: "single"` → value 25, `multiplier: "double"` → value 50. `multiplier: "triple"` with `segment: 25` is never valid.
- Leg starter alternates: leg 1 starts with `player1Id`, leg 2 with `player2Id`, leg 3 with `player1Id`, and so on — regardless of who won the previous leg.
- Undo removes the single most-recently-recorded throw for the match (global order by `Throw.id`), including undoing a leg- or match-winning dart.
- Auth: `POST /live/start`, `POST /live/throws`, and `POST /live/throws/undo` require admin-or-participant (same model as the existing `PATCH /api/matches/{id}/result`); `GET /live` requires any authenticated user (same as `GET /api/seasons/{id}`).
- Writes are blocked (400) when the match's season is archived, mirroring the existing `PATCH /api/matches/{id}` and `PATCH /api/matches/{id}/result` guard.
- `Match.status` gains `"in_progress"` as a valid value (alongside the existing `"scheduled" | "cancelled" | "played"`), set by `/live/start` and cleared back by undo if it un-completes the match.
- On match completion, the live-scoring flow writes the same `Match` fields the manual result endpoint writes (`player1Legs`, `player2Legs`, `player1Checkout`, `player2Checkout`, `status: "played"`, `resultEnteredById`, `resultEnteredAt`) so downstream consumers don't need to know which channel produced the result. The existing manual `PATCH /api/matches/{id}/result` endpoint is untouched and remains available as a last-write-wins override at any time.
- `/season/matches/:id/live` is nested under `ProtectedRoute` (not `AdminRoute`) — any logged-in user can view it; the page itself enforces admin-or-participant for the scoring controls.

---

### Task 1: Prisma schema — `Leg` and `Throw` models

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: migration via `prisma migrate dev`

**Interfaces:**
- Produces: `Leg` and `Throw` Prisma models, plus three new relation fields on `User` (`legsStarted`, `legsWon`, `throwsRecorded`) and one new relation field on `Match` (`legs`). All later backend tasks query these via `prisma.leg` / `prisma.throw` (or the transaction-scoped `tx.leg` / `tx.throw`).

- [ ] **Step 1: Ensure the local dev database is running**

```bash
cd "D:/WEB/Dartstracker" && docker start dartstracker-sqlserver
```
Expected: container reports `dartstracker-sqlserver` (already running is fine).

- [ ] **Step 2: Add the following to `api/prisma/schema.prisma`**

Add three new relation fields to the existing `User` model (insert after `resultEnteredMatches`):

```prisma
  legsStarted          Leg[]               @relation("LegStartingPlayer")
  legsWon              Leg[]               @relation("LegWinner")
  throwsRecorded       Throw[]             @relation("ThrowPlayer")
```

Add one new relation field to the existing `Match` model (insert after `resultEnteredBy`):

```prisma
  legs            Leg[]
```

Append two new models at the end of the file:

```prisma
model Leg {
  id               Int      @id @default(autoincrement())
  matchId          Int
  legNumber        Int
  startingPlayerId Int
  winnerPlayerId   Int?
  checkoutValue    Int?
  createdAt        DateTime @default(now())

  match          Match  @relation(fields: [matchId], references: [id])
  startingPlayer User   @relation("LegStartingPlayer", fields: [startingPlayerId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  winnerPlayer   User?  @relation("LegWinner", fields: [winnerPlayerId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  throws         Throw[]

  @@unique([matchId, legNumber])
}

model Throw {
  id         Int      @id @default(autoincrement())
  legId      Int
  playerId   Int
  turnNumber Int
  dartNumber Int
  multiplier String
  segment    Int
  value      Int
  busted     Boolean  @default(false)
  createdAt  DateTime @default(now())

  leg    Leg  @relation(fields: [legId], references: [id])
  player User @relation("ThrowPlayer", fields: [playerId], references: [id], onDelete: NoAction, onUpdate: NoAction)
}
```

Note: `onDelete: NoAction, onUpdate: NoAction` on `Leg.startingPlayer`, `Leg.winnerPlayer`, and `Throw.player` is required — SQL Server rejects the implicit default (`Cascade`) because multiple FKs reference `User`, creating multiple cascade paths (Prisma error P1012), the same issue already solved for `Match.player1`/`player2` in an earlier phase.

- [ ] **Step 3: Generate and apply the migration**

```bash
cd "D:/WEB/Dartstracker/.claude/worktrees/darts-live-scoreboard/api" && npx prisma migrate dev --name add_live_scoring_models
```
Expected: creates `prisma/migrations/<timestamp>_add_live_scoring_models/migration.sql` with `CREATE TABLE` statements for `Leg` and `Throw`, applies it to the local database, regenerates the Prisma client. No errors.

- [ ] **Step 4: Verify the client builds**

```bash
npm run build
```
Expected: `tsc` succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Add Leg and Throw models for live scoring"
```

---

### Task 2: Pure domain logic — `api/src/lib/liveScoring.ts`

**Files:**
- Create: `api/src/lib/liveScoring.ts`
- Test: `api/test/lib/liveScoring.test.ts`

**Interfaces:**
- Produces: `Multiplier` (`"single" | "double" | "triple"`), `isMultiplier(value): value is Multiplier`, `isValidSegment(value): value is number`, `isValidThrowInput(multiplier, segment): boolean`, `throwValue(multiplier, segment): number`, `StoredThrow` (`{ id, turnNumber, dartNumber, playerId, multiplier, segment, value }`), `StoredLeg` (`{ id, legNumber, startingPlayerId, throws: StoredThrow[] }`), `BustUpdate` (`{ throwId, busted }`), `LegResult` (`{ legId, winnerPlayerId, checkoutValue, bustUpdates }`), `CurrentTurn` (`{ legNumber, turnNumber, dartNumber, playerId, player1Remaining, player2Remaining }`), `MatchOutcome` (`{ complete, winnerPlayerId, player1Legs, player2Legs, player1Checkout, player2Checkout }`), `ReplayOutcome` (`{ legResults, currentTurn, needsNextLeg, nextLegStartingPlayerId, trailingEmptyLegId, match }`), `replayMatch(player1Id, player2Id, legs): ReplayOutcome` — all named exports. Task 3's store module imports all of these.

- [ ] **Step 1: Write the failing test — `api/test/lib/liveScoring.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { isValidThrowInput, throwValue, replayMatch, type StoredLeg, type StoredThrow } from "../../src/lib/liveScoring";

const P1 = 1;
const P2 = 2;

function leg(legNumber: number, startingPlayerId: number, throws: StoredThrow[]): StoredLeg {
  return { id: legNumber, legNumber, startingPlayerId, throws };
}

function t(
  id: number,
  turnNumber: number,
  dartNumber: number,
  playerId: number,
  multiplier: "single" | "double" | "triple",
  segment: number
): StoredThrow {
  return { id, turnNumber, dartNumber, playerId, multiplier, segment, value: throwValue(multiplier, segment) };
}

// Two full 3-dart turns of triple-20 (60 each) bring a fresh 501 leg down to 141
// before start of turn 3 — reused by several tests below as a shared setup.
function setupTurns(playerId: number): StoredThrow[] {
  return [
    t(1, 1, 1, playerId, "triple", 20),
    t(2, 1, 2, playerId, "triple", 20),
    t(3, 1, 3, playerId, "triple", 20),
    t(4, 2, 1, playerId, "triple", 20),
    t(5, 2, 2, playerId, "triple", 20),
    t(6, 2, 3, playerId, "triple", 20),
  ];
}

function wonByP1Leg(legNumber: number, idBase: number): StoredLeg {
  return leg(legNumber, legNumber % 2 === 1 ? P1 : P2, [
    t(idBase + 1, 1, 1, P1, "triple", 20),
    t(idBase + 2, 1, 2, P1, "triple", 20),
    t(idBase + 3, 1, 3, P1, "triple", 20),
    t(idBase + 4, 2, 1, P1, "triple", 20),
    t(idBase + 5, 2, 2, P1, "triple", 20),
    t(idBase + 6, 2, 3, P1, "triple", 20),
    t(idBase + 7, 3, 1, P1, "double", 20),
    t(idBase + 8, 3, 2, P1, "triple", 17),
    t(idBase + 9, 3, 3, P1, "double", 25),
  ]);
}

describe("isValidThrowInput", () => {
  it("accepts a valid single/double/triple on 1-20", () => {
    expect(isValidThrowInput("single", 20)).toBe(true);
    expect(isValidThrowInput("double", 20)).toBe(true);
    expect(isValidThrowInput("triple", 20)).toBe(true);
  });

  it("accepts single and double bull but rejects triple bull", () => {
    expect(isValidThrowInput("single", 25)).toBe(true);
    expect(isValidThrowInput("double", 25)).toBe(true);
    expect(isValidThrowInput("triple", 25)).toBe(false);
  });

  it("rejects an out-of-range or non-integer segment", () => {
    expect(isValidThrowInput("single", 21)).toBe(false);
    expect(isValidThrowInput("single", 0)).toBe(false);
    expect(isValidThrowInput("single", 1.5)).toBe(false);
  });

  it("rejects an invalid multiplier", () => {
    expect(isValidThrowInput("quad", 20)).toBe(false);
    expect(isValidThrowInput(undefined, 20)).toBe(false);
  });
});

describe("throwValue", () => {
  it("computes single/double/triple values for a number segment", () => {
    expect(throwValue("single", 20)).toBe(20);
    expect(throwValue("double", 20)).toBe(40);
    expect(throwValue("triple", 20)).toBe(60);
  });

  it("computes single and double bull values", () => {
    expect(throwValue("single", 25)).toBe(25);
    expect(throwValue("double", 25)).toBe(50);
  });
});

describe("replayMatch", () => {
  it("tracks remaining score after a normal (non-bust, non-checkout) throw", () => {
    const legs = [leg(1, P1, [t(1, 1, 1, P1, "triple", 20)])];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.currentTurn).toEqual({
      legNumber: 1,
      turnNumber: 1,
      dartNumber: 2,
      playerId: P1,
      player1Remaining: 441,
      player2Remaining: 501,
    });
  });

  it("reflects a shortened, still-open turn after a dart is removed mid-turn", () => {
    const legs = [leg(1, P1, [t(1, 1, 1, P1, "triple", 20), t(2, 1, 2, P1, "triple", 20)])];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.currentTurn).toEqual({
      legNumber: 1,
      turnNumber: 1,
      dartNumber: 3,
      playerId: P1,
      player1Remaining: 381,
      player2Remaining: 501,
    });
  });

  it("busts a turn that would take the score below 0, reverting to the pre-turn score", () => {
    const legs = [
      leg(1, P1, [
        ...setupTurns(P1),
        t(7, 3, 1, P1, "triple", 20),
        t(8, 3, 2, P1, "triple", 20),
        t(9, 3, 3, P1, "triple", 20),
      ]),
    ];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.legResults[0].bustUpdates.filter((b) => b.busted).map((b) => b.throwId)).toEqual([7, 8, 9]);
    expect(outcome.currentTurn?.player1Remaining).toBe(141);
    expect(outcome.currentTurn?.turnNumber).toBe(4);
    expect(outcome.currentTurn?.playerId).toBe(P2);
  });

  it("busts a turn that lands on exactly 1", () => {
    const legs = [
      leg(1, P1, [
        ...setupTurns(P1),
        t(7, 3, 1, P1, "triple", 20),
        t(8, 3, 2, P1, "triple", 20),
        t(9, 3, 3, P1, "single", 20),
      ]),
    ];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.legResults[0].bustUpdates.filter((b) => b.busted).map((b) => b.throwId)).toEqual([7, 8, 9]);
    expect(outcome.currentTurn?.player1Remaining).toBe(141);
  });

  it("busts a turn that reaches exactly 0 without the final dart being a double", () => {
    const legs = [
      leg(1, P1, [
        ...setupTurns(P1),
        t(7, 3, 1, P1, "triple", 20),
        t(8, 3, 2, P1, "triple", 20),
        t(9, 3, 3, P1, "triple", 7),
      ]),
    ];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.legResults[0].winnerPlayerId).toBeNull();
    expect(outcome.legResults[0].bustUpdates.filter((b) => b.busted).map((b) => b.throwId)).toEqual([7, 8, 9]);
  });

  it("wins the leg on a checkout via a regular double", () => {
    const legs = [
      leg(1, P1, [
        ...setupTurns(P1),
        t(7, 3, 1, P1, "triple", 20),
        t(8, 3, 2, P1, "single", 1),
        t(9, 3, 3, P1, "double", 40),
      ]),
    ];
    const outcome = replayMatch(P1, P2, legs);
    const legResult = outcome.legResults[0];
    expect(legResult.winnerPlayerId).toBe(P1);
    expect(legResult.checkoutValue).toBe(141);
    expect(legResult.bustUpdates.every((b) => !b.busted)).toBe(true);
  });

  it("wins the leg on a checkout via double bull", () => {
    const legs = [
      leg(1, P1, [
        ...setupTurns(P1),
        t(7, 3, 1, P1, "double", 20),
        t(8, 3, 2, P1, "triple", 17),
        t(9, 3, 3, P1, "double", 25),
      ]),
    ];
    const outcome = replayMatch(P1, P2, legs);
    const legResult = outcome.legResults[0];
    expect(legResult.winnerPlayerId).toBe(P1);
    expect(legResult.checkoutValue).toBe(141);
  });

  it("starts a fresh (unplayed) leg's first turn with its designated starting player", () => {
    const legs = [leg(2, P2, [])];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.currentTurn).toEqual({
      legNumber: 2,
      turnNumber: 1,
      dartNumber: 1,
      playerId: P2,
      player1Remaining: 501,
      player2Remaining: 501,
    });
  });

  it("does not flag leg 1 for deletion even though it starts empty", () => {
    const legs = [leg(1, P1, [])];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.trailingEmptyLegId).toBeNull();
  });

  it("flags a trailing empty leg (auto-created after a win) for deletion", () => {
    const legs = [wonByP1Leg(1, 0), leg(2, P2, [])];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.trailingEmptyLegId).toBe(legs[1].id);
  });

  it("signals needsNextLeg with the correct alternated starting player when a leg completes short of match point", () => {
    const legs = [wonByP1Leg(1, 0)];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.match.complete).toBe(false);
    expect(outcome.needsNextLeg).toBe(true);
    expect(outcome.nextLegStartingPlayerId).toBe(P2);
  });

  it("completes the match once a player reaches 3 legs, and stops signalling needsNextLeg", () => {
    const legs = [wonByP1Leg(1, 0), wonByP1Leg(2, 100), wonByP1Leg(3, 200)];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.match).toEqual({
      complete: true,
      winnerPlayerId: P1,
      player1Legs: 3,
      player2Legs: 0,
      player1Checkout: 141,
      player2Checkout: null,
    });
    expect(outcome.currentTurn).toBeNull();
    expect(outcome.needsNextLeg).toBe(false);
    expect(outcome.trailingEmptyLegId).toBeNull();
  });

  it("un-finalizes the match when the winning leg's checkout dart is removed", () => {
    const winner = wonByP1Leg(3, 200);
    const winningLegWithoutFinalDart: StoredLeg = { ...winner, throws: winner.throws.slice(0, -1) };
    const legs = [wonByP1Leg(1, 0), wonByP1Leg(2, 100), winningLegWithoutFinalDart];
    const outcome = replayMatch(P1, P2, legs);
    expect(outcome.match.complete).toBe(false);
    expect(outcome.legResults[2].winnerPlayerId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/lib/liveScoring.ts` does not exist.

- [ ] **Step 3: Create `api/src/lib/liveScoring.ts`**

```typescript
export type Multiplier = "single" | "double" | "triple";

export function isMultiplier(value: unknown): value is Multiplier {
  return value === "single" || value === "double" || value === "triple";
}

export function isValidSegment(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && ((value >= 1 && value <= 20) || value === 25);
}

export function isValidThrowInput(multiplier: unknown, segment: unknown): boolean {
  if (!isMultiplier(multiplier)) {
    return false;
  }
  if (!isValidSegment(segment)) {
    return false;
  }
  if (segment === 25 && multiplier === "triple") {
    return false;
  }
  return true;
}

export function throwValue(multiplier: Multiplier, segment: number): number {
  const factor = multiplier === "single" ? 1 : multiplier === "double" ? 2 : 3;
  return factor * segment;
}

export type StoredThrow = {
  id: number;
  turnNumber: number;
  dartNumber: number;
  playerId: number;
  multiplier: Multiplier;
  segment: number;
  value: number;
};

export type StoredLeg = {
  id: number;
  legNumber: number;
  startingPlayerId: number;
  throws: StoredThrow[];
};

export type BustUpdate = { throwId: number; busted: boolean };

export type LegResult = {
  legId: number;
  winnerPlayerId: number | null;
  checkoutValue: number | null;
  bustUpdates: BustUpdate[];
};

export type CurrentTurn = {
  legNumber: number;
  turnNumber: number;
  dartNumber: number;
  playerId: number;
  player1Remaining: number;
  player2Remaining: number;
};

export type MatchOutcome = {
  complete: boolean;
  winnerPlayerId: number | null;
  player1Legs: number;
  player2Legs: number;
  player1Checkout: number | null;
  player2Checkout: number | null;
};

export type ReplayOutcome = {
  legResults: LegResult[];
  currentTurn: CurrentTurn | null;
  needsNextLeg: boolean;
  nextLegStartingPlayerId: number | null;
  trailingEmptyLegId: number | null;
  match: MatchOutcome;
};

function otherPlayer(playerId: number, player1Id: number, player2Id: number): number {
  return playerId === player1Id ? player2Id : player1Id;
}

/**
 * Replays every stored throw of a match from scratch to derive bust flags,
 * leg winners/checkouts, whose turn is next, and whether the match is
 * complete. Called after every insert or delete of a Throw row so derived
 * state never drifts from the raw throw log.
 */
export function replayMatch(player1Id: number, player2Id: number, legs: StoredLeg[]): ReplayOutcome {
  const legResults: LegResult[] = [];
  let player1Legs = 0;
  let player2Legs = 0;
  let player1Checkout: number | null = null;
  let player2Checkout: number | null = null;
  let currentTurn: CurrentTurn | null = null;
  let trailingEmptyLegId: number | null = null;
  let lastLeg: StoredLeg | null = null;

  for (const leg of legs) {
    lastLeg = leg;

    if (leg.throws.length === 0) {
      if (leg.legNumber !== 1) {
        trailingEmptyLegId = leg.id;
      }
      legResults.push({ legId: leg.id, winnerPlayerId: null, checkoutValue: null, bustUpdates: [] });
      currentTurn = {
        legNumber: leg.legNumber,
        turnNumber: 1,
        dartNumber: 1,
        playerId: leg.startingPlayerId,
        player1Remaining: 501,
        player2Remaining: 501,
      };
      continue;
    }

    const turnNumbers = Array.from(new Set(leg.throws.map((th) => th.turnNumber))).sort((a, b) => a - b);
    let player1Remaining = 501;
    let player2Remaining = 501;
    let winnerPlayerId: number | null = null;
    let checkoutValue: number | null = null;
    const bustUpdates: BustUpdate[] = [];
    let lastCompleteTurnPlayerId = leg.startingPlayerId;
    let lastCompleteTurnNumber = 0;
    let openTurn: { turnNumber: number; playerId: number; throws: StoredThrow[] } | null = null;

    for (const turnNumber of turnNumbers) {
      const turnThrows = leg.throws
        .filter((th) => th.turnNumber === turnNumber)
        .sort((a, b) => a.dartNumber - b.dartNumber);
      const turnPlayerId = turnThrows[0].playerId;
      const startRemaining = turnPlayerId === player1Id ? player1Remaining : player2Remaining;

      let running = startRemaining;
      let busted = false;
      let checkedOut = false;
      let dartsResolved = 0;
      for (const th of turnThrows) {
        running -= th.value;
        dartsResolved++;
        if (running < 0 || running === 1) {
          busted = true;
          break;
        }
        if (running === 0) {
          checkedOut = th.multiplier === "double";
          busted = !checkedOut;
          break;
        }
      }

      const turnResolved = busted || checkedOut || dartsResolved === 3;
      if (!turnResolved) {
        openTurn = { turnNumber, playerId: turnPlayerId, throws: turnThrows };
        break;
      }

      for (const th of turnThrows) {
        bustUpdates.push({ throwId: th.id, busted });
      }
      if (!busted && turnPlayerId === player1Id) {
        player1Remaining = running;
      }
      if (!busted && turnPlayerId === player2Id) {
        player2Remaining = running;
      }

      if (checkedOut) {
        winnerPlayerId = turnPlayerId;
        checkoutValue = startRemaining;
      }

      lastCompleteTurnPlayerId = turnPlayerId;
      lastCompleteTurnNumber = turnNumber;

      if (winnerPlayerId !== null) {
        break;
      }
    }

    legResults.push({ legId: leg.id, winnerPlayerId, checkoutValue, bustUpdates });

    if (winnerPlayerId === player1Id) {
      player1Legs++;
      if (player1Checkout === null || checkoutValue! > player1Checkout) {
        player1Checkout = checkoutValue;
      }
    }
    if (winnerPlayerId === player2Id) {
      player2Legs++;
      if (player2Checkout === null || checkoutValue! > player2Checkout) {
        player2Checkout = checkoutValue;
      }
    }

    if (winnerPlayerId !== null) {
      currentTurn = null;
      continue;
    }

    if (openTurn) {
      currentTurn = {
        legNumber: leg.legNumber,
        turnNumber: openTurn.turnNumber,
        dartNumber: openTurn.throws.length + 1,
        playerId: openTurn.playerId,
        player1Remaining,
        player2Remaining,
      };
    } else {
      currentTurn = {
        legNumber: leg.legNumber,
        turnNumber: lastCompleteTurnNumber + 1,
        dartNumber: 1,
        playerId: otherPlayer(lastCompleteTurnPlayerId, player1Id, player2Id),
        player1Remaining,
        player2Remaining,
      };
    }
  }

  const matchComplete = player1Legs >= 3 || player2Legs >= 3;
  const lastLegResult = legResults.length > 0 ? legResults[legResults.length - 1] : null;
  const needsNextLeg = !matchComplete && lastLegResult !== null && lastLegResult.winnerPlayerId !== null;
  const nextLegStartingPlayerId =
    needsNextLeg && lastLeg ? otherPlayer(lastLeg.startingPlayerId, player1Id, player2Id) : null;

  return {
    legResults,
    currentTurn: matchComplete ? null : currentTurn,
    needsNextLeg,
    nextLegStartingPlayerId,
    trailingEmptyLegId: matchComplete ? null : trailingEmptyLegId,
    match: {
      complete: matchComplete,
      winnerPlayerId: matchComplete ? (player1Legs >= 3 ? player1Id : player2Id) : null,
      player1Legs,
      player2Legs,
      player1Checkout,
      player2Checkout,
    },
  };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole suite passes, including all new tests in `liveScoring.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/liveScoring.ts test/lib/liveScoring.test.ts
git commit -m "Add pure live-scoring replay logic (bust/checkout/leg/match derivation)"
```

---

### Task 3: DB orchestration — `api/src/lib/liveScoringStore.ts`

**Files:**
- Create: `api/src/lib/liveScoringStore.ts`
- Test: `api/test/lib/liveScoringStore.test.ts`

**Interfaces:**
- Consumes: everything from Task 2 (`replayMatch`, `StoredLeg`, `StoredThrow`, `Multiplier`, `ReplayOutcome`).
- Produces: `loadLegsWithThrows(client: Prisma.TransactionClient, matchId: number): Promise<StoredLeg[]>`, `reconcileMatchState(tx: Prisma.TransactionClient, matchId: number, player1Id: number, player2Id: number, actingUserId: number): Promise<{ legs: StoredLeg[]; outcome: ReplayOutcome }>`, `buildLiveStateResponse(match: { id: number; status: string; player1Id: number; player2Id: number }, legs: StoredLeg[], outcome: ReplayOutcome): object` — all named exports from `api/src/lib/liveScoringStore.ts`. Tasks 4, 5, and 6 (the endpoints) import all three.

- [ ] **Step 1: Write the failing test — `api/test/lib/liveScoringStore.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { loadLegsWithThrows, reconcileMatchState, buildLiveStateResponse } from "../../src/lib/liveScoringStore";

const P1 = 1;
const P2 = 2;

function makeThrowRow(id: number, turnNumber: number, dartNumber: number, playerId: number, multiplier: string, segment: number, value: number) {
  return { id, turnNumber, dartNumber, playerId, multiplier, segment, value, busted: false };
}

describe("loadLegsWithThrows", () => {
  it("maps Prisma leg rows (with nested throws) to the replay's StoredLeg shape", async () => {
    const client = {
      leg: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 10,
            legNumber: 1,
            startingPlayerId: P1,
            winnerPlayerId: null,
            checkoutValue: null,
            throws: [makeThrowRow(1, 1, 1, P1, "triple", 20, 60)],
          },
        ]),
      },
    };
    const legs = await loadLegsWithThrows(client as never, 5);
    expect(client.leg.findMany).toHaveBeenCalledWith({
      where: { matchId: 5 },
      orderBy: { legNumber: "asc" },
      include: { throws: { orderBy: [{ turnNumber: "asc" }, { dartNumber: "asc" }] } },
    });
    expect(legs).toEqual([
      {
        id: 10,
        legNumber: 1,
        startingPlayerId: P1,
        throws: [{ id: 1, turnNumber: 1, dartNumber: 1, playerId: P1, multiplier: "triple", segment: 20, value: 60 }],
      },
    ]);
  });
});

function mockTx(findManyResults: unknown[][]) {
  let call = 0;
  const tx = {
    leg: {
      findMany: vi.fn().mockImplementation(async () => findManyResults[Math.min(call++, findManyResults.length - 1)]),
      delete: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    throw: {
      update: vi.fn().mockResolvedValue({}),
    },
    match: {
      update: vi.fn().mockResolvedValue({}),
    },
  };
  return tx;
}

describe("reconcileMatchState", () => {
  it("persists bust flags and leaves the match in_progress mid-leg", async () => {
    const tx = mockTx([
      [
        {
          id: 10,
          legNumber: 1,
          startingPlayerId: P1,
          throws: [makeThrowRow(1, 1, 1, P1, "single", 5, 5)],
        },
      ],
    ]);

    const result = await reconcileMatchState(tx as never, 5, P1, P2, P1);

    expect(tx.leg.delete).not.toHaveBeenCalled();
    expect(tx.leg.create).not.toHaveBeenCalled();
    expect(tx.match.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: {
        status: "in_progress",
        player1Legs: null,
        player2Legs: null,
        player1Checkout: null,
        player2Checkout: null,
        resultEnteredById: null,
        resultEnteredAt: null,
      },
    });
    expect(result.outcome.match.complete).toBe(false);
  });

  it("creates the next leg (alternated starting player) once a leg completes short of match point", async () => {
    const wonLegThrows = [
      makeThrowRow(1, 1, 1, P1, "triple", 20, 60),
      makeThrowRow(2, 1, 2, P1, "triple", 20, 60),
      makeThrowRow(3, 1, 3, P1, "triple", 20, 60),
      makeThrowRow(4, 2, 1, P1, "triple", 20, 60),
      makeThrowRow(5, 2, 2, P1, "triple", 20, 60),
      makeThrowRow(6, 2, 3, P1, "triple", 20, 60),
      makeThrowRow(7, 3, 1, P1, "double", 20, 40),
      makeThrowRow(8, 3, 2, P1, "triple", 17, 51),
      makeThrowRow(9, 3, 3, P1, "double", 25, 50),
    ];
    const wonLeg = { id: 10, legNumber: 1, startingPlayerId: P1, throws: wonLegThrows };
    const tx = mockTx([[wonLeg], [wonLeg, { id: 11, legNumber: 2, startingPlayerId: P2, throws: [] }]]);

    await reconcileMatchState(tx as never, 5, P1, P2, P1);

    expect(tx.leg.create).toHaveBeenCalledWith({ data: { matchId: 5, legNumber: 2, startingPlayerId: P2 } });
    expect(tx.leg.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { winnerPlayerId: P1, checkoutValue: 141 },
    });
  });

  it("deletes a trailing empty leg and reopens the previous leg when undo removes its only throw", async () => {
    const leg1 = { id: 10, legNumber: 1, startingPlayerId: P1, throws: [{ id: 1, turnNumber: 1, dartNumber: 1, playerId: P1, multiplier: "single", segment: 5, value: 5, busted: false }] };
    const leg2Empty = { id: 11, legNumber: 2, startingPlayerId: P2, throws: [] };
    const tx = mockTx([[leg1, leg2Empty], [leg1]]);

    await reconcileMatchState(tx as never, 5, P1, P2, P1);

    expect(tx.leg.delete).toHaveBeenCalledWith({ where: { id: 11 } });
  });

  it("finalizes the match on the third leg win, writing legs/checkouts/resultEntered fields", async () => {
    function winTurnThrows(idBase: number) {
      return [
        makeThrowRow(idBase + 1, 1, 1, P1, "triple", 20, 60),
        makeThrowRow(idBase + 2, 1, 2, P1, "triple", 20, 60),
        makeThrowRow(idBase + 3, 1, 3, P1, "triple", 20, 60),
        makeThrowRow(idBase + 4, 2, 1, P1, "triple", 20, 60),
        makeThrowRow(idBase + 5, 2, 2, P1, "triple", 20, 60),
        makeThrowRow(idBase + 6, 2, 3, P1, "triple", 20, 60),
        makeThrowRow(idBase + 7, 3, 1, P1, "double", 20, 40),
        makeThrowRow(idBase + 8, 3, 2, P1, "triple", 17, 51),
        makeThrowRow(idBase + 9, 3, 3, P1, "double", 25, 50),
      ];
    }
    const leg1 = { id: 10, legNumber: 1, startingPlayerId: P1, throws: winTurnThrows(0) };
    const leg2 = { id: 11, legNumber: 2, startingPlayerId: P2, throws: winTurnThrows(100) };
    const leg3 = { id: 12, legNumber: 3, startingPlayerId: P1, throws: winTurnThrows(200) };
    const tx = mockTx([[leg1, leg2, leg3]]);

    const result = await reconcileMatchState(tx as never, 5, P1, P2, P1);

    expect(tx.match.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: {
        status: "played",
        player1Legs: 3,
        player2Legs: 0,
        player1Checkout: 141,
        player2Checkout: null,
        resultEnteredById: P1,
        resultEnteredAt: expect.any(Date),
      },
    });
    expect(result.outcome.match.complete).toBe(true);
  });
});

describe("buildLiveStateResponse", () => {
  it("shapes the match/legs/currentTurn/matchOutcome response, pulling busted from the outcome not the leg", () => {
    const legs = [
      {
        id: 10,
        legNumber: 1,
        startingPlayerId: P1,
        throws: [{ id: 1, turnNumber: 1, dartNumber: 1, playerId: P1, multiplier: "single" as const, segment: 5, value: 5 }],
      },
    ];
    const outcome = {
      legResults: [{ legId: 10, winnerPlayerId: null, checkoutValue: null, bustUpdates: [{ throwId: 1, busted: true }] }],
      currentTurn: { legNumber: 1, turnNumber: 1, dartNumber: 2, playerId: P1, player1Remaining: 501, player2Remaining: 501 },
      needsNextLeg: false,
      nextLegStartingPlayerId: null,
      trailingEmptyLegId: null,
      match: { complete: false, winnerPlayerId: null, player1Legs: 0, player2Legs: 0, player1Checkout: null, player2Checkout: null },
    };

    const body = buildLiveStateResponse({ id: 5, status: "in_progress", player1Id: P1, player2Id: P2 }, legs, outcome);

    expect(body).toEqual({
      match: { id: 5, status: "in_progress", player1Id: P1, player2Id: P2 },
      legs: [
        {
          id: 10,
          legNumber: 1,
          startingPlayerId: P1,
          winnerPlayerId: null,
          checkoutValue: null,
          throws: [{ id: 1, turnNumber: 1, dartNumber: 1, playerId: P1, multiplier: "single", segment: 5, value: 5, busted: true }],
        },
      ],
      currentTurn: outcome.currentTurn,
      matchOutcome: outcome.match,
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/lib/liveScoringStore.ts` does not exist.

- [ ] **Step 3: Create `api/src/lib/liveScoringStore.ts`**

```typescript
import type { Prisma } from "@prisma/client";
import { replayMatch, type Multiplier, type ReplayOutcome, type StoredLeg } from "./liveScoring";

export async function loadLegsWithThrows(client: Prisma.TransactionClient, matchId: number): Promise<StoredLeg[]> {
  const legs = await client.leg.findMany({
    where: { matchId },
    orderBy: { legNumber: "asc" },
    include: { throws: { orderBy: [{ turnNumber: "asc" }, { dartNumber: "asc" }] } },
  });

  return legs.map((leg) => ({
    id: leg.id,
    legNumber: leg.legNumber,
    startingPlayerId: leg.startingPlayerId,
    throws: leg.throws.map((th) => ({
      id: th.id,
      turnNumber: th.turnNumber,
      dartNumber: th.dartNumber,
      playerId: th.playerId,
      multiplier: th.multiplier as Multiplier,
      segment: th.segment,
      value: th.value,
    })),
  }));
}

async function applyOutcome(tx: Prisma.TransactionClient, outcome: ReplayOutcome): Promise<void> {
  for (const legResult of outcome.legResults) {
    for (const bustUpdate of legResult.bustUpdates) {
      await tx.throw.update({ where: { id: bustUpdate.throwId }, data: { busted: bustUpdate.busted } });
    }
    await tx.leg.update({
      where: { id: legResult.legId },
      data: { winnerPlayerId: legResult.winnerPlayerId, checkoutValue: legResult.checkoutValue },
    });
  }
}

export async function reconcileMatchState(
  tx: Prisma.TransactionClient,
  matchId: number,
  player1Id: number,
  player2Id: number,
  actingUserId: number
): Promise<{ legs: StoredLeg[]; outcome: ReplayOutcome }> {
  let legs = await loadLegsWithThrows(tx, matchId);
  let outcome = replayMatch(player1Id, player2Id, legs);

  if (outcome.trailingEmptyLegId !== null) {
    await tx.leg.delete({ where: { id: outcome.trailingEmptyLegId } });
    legs = await loadLegsWithThrows(tx, matchId);
    outcome = replayMatch(player1Id, player2Id, legs);
  }

  if (outcome.needsNextLeg) {
    const lastLeg = legs[legs.length - 1];
    await tx.leg.create({
      data: { matchId, legNumber: lastLeg.legNumber + 1, startingPlayerId: outcome.nextLegStartingPlayerId! },
    });
    legs = await loadLegsWithThrows(tx, matchId);
    outcome = replayMatch(player1Id, player2Id, legs);
  }

  await applyOutcome(tx, outcome);

  await tx.match.update({
    where: { id: matchId },
    data: outcome.match.complete
      ? {
          status: "played",
          player1Legs: outcome.match.player1Legs,
          player2Legs: outcome.match.player2Legs,
          player1Checkout: outcome.match.player1Checkout,
          player2Checkout: outcome.match.player2Checkout,
          resultEnteredById: actingUserId,
          resultEnteredAt: new Date(),
        }
      : {
          status: "in_progress",
          player1Legs: null,
          player2Legs: null,
          player1Checkout: null,
          player2Checkout: null,
          resultEnteredById: null,
          resultEnteredAt: null,
        },
  });

  return { legs, outcome };
}

export function buildLiveStateResponse(
  match: { id: number; status: string; player1Id: number; player2Id: number },
  legs: StoredLeg[],
  outcome: ReplayOutcome
) {
  return {
    match: { id: match.id, status: match.status, player1Id: match.player1Id, player2Id: match.player2Id },
    legs: legs.map((leg) => {
      const legResult = outcome.legResults.find((r) => r.legId === leg.id);
      return {
        id: leg.id,
        legNumber: leg.legNumber,
        startingPlayerId: leg.startingPlayerId,
        winnerPlayerId: legResult?.winnerPlayerId ?? null,
        checkoutValue: legResult?.checkoutValue ?? null,
        throws: leg.throws.map((th) => ({
          id: th.id,
          turnNumber: th.turnNumber,
          dartNumber: th.dartNumber,
          playerId: th.playerId,
          multiplier: th.multiplier,
          segment: th.segment,
          value: th.value,
          busted: legResult?.bustUpdates.find((b) => b.throwId === th.id)?.busted ?? false,
        })),
      };
    }),
    currentTurn: outcome.currentTurn,
    matchOutcome: outcome.match,
  };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole suite passes, including all new tests in `liveScoringStore.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/liveScoringStore.ts test/lib/liveScoringStore.test.ts
git commit -m "Add live-scoring DB orchestration (reconcile + response builder)"
```

---

### Task 4: `POST /api/matches/{id}/live/start` and `GET /api/matches/{id}/live`

**Files:**
- Create: `api/src/functions/matches/liveStart.ts`
- Create: `api/src/functions/matches/liveGet.ts`
- Test: `api/test/functions/matches/liveStart.test.ts`
- Test: `api/test/functions/matches/liveGet.test.ts`

**Interfaces:**
- Consumes: `requireAuth`/`AuthError` from `../../lib/requireAuth`; `replayMatch` from `../../lib/liveScoring`; `loadLegsWithThrows`, `reconcileMatchState`, `buildLiveStateResponse` from `../../lib/liveScoringStore` (Tasks 2 and 3).
- Produces: `startLiveMatch` and `getLiveMatch` exported handler functions, registered as Azure Functions `matchesLiveStart` (`POST matches/{id}/live/start`) and `matchesLiveGet` (`GET matches/{id}/live`). Tasks 5 and 6 follow the same response shape (from `buildLiveStateResponse`).

- [ ] **Step 1: Write the failing tests**

`api/test/functions/matches/liveStart.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { startLiveMatch } from "../../../src/functions/matches/liveStart";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { match: { findUnique: vi.fn() }, $transaction: vi.fn() },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
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
  roundNumber: 1,
  date: new Date("2026-08-01"),
  player1Id: 1,
  player2Id: 2,
  status: "scheduled",
  season: { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: new Date() },
};

function mockTransaction() {
  const tx = { leg: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}) }, match: { update: vi.fn().mockResolvedValue({}) } };
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(tx)) as unknown as typeof prisma.$transaction);
  return tx;
}

describe("startLiveMatch function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await startLiveMatch(createRequest("101"), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 404 when the match doesn't exist", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
    const result = await startLiveMatch(createRequest("999"), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 403 when the caller is neither admin nor a participant", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 5, role: "player" });
    vi.mocked(prisma.match.findUnique).mockResolvedValue(scheduledMatch as never);
    const result = await startLiveMatch(createRequest("101"), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the match's season is archived", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      ...scheduledMatch,
      season: { ...scheduledMatch.season, status: "archived" },
    } as never);
    const result = await startLiveMatch(createRequest("101"), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when the match is played or cancelled", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({ ...scheduledMatch, status: "played" } as never);
    const result = await startLiveMatch(createRequest("101"), createContext());
    expect(result.status).toBe(400);
  });

  it("creates leg 1 and sets status to in_progress for a scheduled match", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(scheduledMatch as never);
    const tx = mockTransaction();
    tx.leg.findMany.mockResolvedValue([{ id: 10, legNumber: 1, startingPlayerId: 1, winnerPlayerId: null, checkoutValue: null, throws: [] }]);

    const result = await startLiveMatch(createRequest("101"), createContext());

    expect(tx.leg.create).toHaveBeenCalledWith({ data: { matchId: 101, legNumber: 1, startingPlayerId: 1 } });
    expect(result.status).toBe(200);
    const body = result.jsonBody as { match: { status: string } };
    expect(body.match.status).toBe("in_progress");
  });

  it("is idempotent when the match is already in_progress (does not create a second leg 1)", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({ ...scheduledMatch, status: "in_progress" } as never);
    const tx = mockTransaction();
    tx.leg.findMany.mockResolvedValue([{ id: 10, legNumber: 1, startingPlayerId: 1, winnerPlayerId: null, checkoutValue: null, throws: [] }]);

    const result = await startLiveMatch(createRequest("101"), createContext());

    expect(tx.leg.create).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
  });
});
```

`api/test/functions/matches/liveGet.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { getLiveMatch } from "../../../src/functions/matches/liveGet";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { match: { findUnique: vi.fn() }, leg: { findMany: vi.fn() } },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createRequest(id: string): HttpRequest {
  return { params: { id } } as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

describe("getLiveMatch function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 3, role: "player" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await getLiveMatch(createRequest("101"), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 404 when the match doesn't exist", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
    const result = await getLiveMatch(createRequest("999"), createContext());
    expect(result.status).toBe(404);
  });

  it("returns the live state for any authenticated user, including a non-participant", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      id: 101,
      player1Id: 1,
      player2Id: 2,
      status: "in_progress",
    } as never);
    vi.mocked(prisma.leg.findMany).mockResolvedValue([
      { id: 10, legNumber: 1, startingPlayerId: 1, winnerPlayerId: null, checkoutValue: null, throws: [] },
    ] as never);

    const result = await getLiveMatch(createRequest("101"), createContext());

    expect(result.status).toBe(200);
    const body = result.jsonBody as { match: { status: string }; currentTurn: { playerId: number } };
    expect(body.match.status).toBe("in_progress");
    expect(body.currentTurn.playerId).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd api && npm test`
Expected: FAIL — `src/functions/matches/liveStart.ts` and `src/functions/matches/liveGet.ts` do not exist.

- [ ] **Step 3: Create `api/src/functions/matches/liveStart.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { replayMatch } from "../../lib/liveScoring";
import { loadLegsWithThrows, buildLiveStateResponse } from "../../lib/liveScoringStore";

export async function startLiveMatch(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const claims = await requireAuth(request);

    const matchId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(matchId)) {
      return { status: 400, jsonBody: { error: "Invalid match id" } };
    }

    const existing = await prisma.match.findUnique({ where: { id: matchId }, include: { season: true } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Match not found" } };
    }

    if (claims.role !== "admin" && claims.userId !== existing.player1Id && claims.userId !== existing.player2Id) {
      return { status: 403, jsonBody: { error: "Insufficient permissions" } };
    }

    if (existing.season.status !== "active") {
      return { status: 400, jsonBody: { error: "Cannot modify a match in an archived season" } };
    }

    if (existing.status !== "scheduled" && existing.status !== "in_progress") {
      return { status: 400, jsonBody: { error: "Match cannot be started" } };
    }

    const result = await prisma.$transaction(async (tx) => {
      if (existing.status === "scheduled") {
        await tx.match.update({ where: { id: matchId }, data: { status: "in_progress" } });
        await tx.leg.create({ data: { matchId, legNumber: 1, startingPlayerId: existing.player1Id } });
      }
      const legs = await loadLegsWithThrows(tx, matchId);
      const outcome = replayMatch(existing.player1Id, existing.player2Id, legs);
      return { legs, outcome };
    });

    return {
      status: 200,
      jsonBody: buildLiveStateResponse(
        { id: existing.id, status: "in_progress", player1Id: existing.player1Id, player2Id: existing.player2Id },
        result.legs,
        result.outcome
      ),
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/matches/{id}/live/start failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("matchesLiveStart", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "matches/{id}/live/start",
  handler: startLiveMatch,
});
```

- [ ] **Step 4: Create `api/src/functions/matches/liveGet.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { replayMatch } from "../../lib/liveScoring";
import { loadLegsWithThrows, buildLiveStateResponse } from "../../lib/liveScoringStore";

export async function getLiveMatch(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await requireAuth(request);

    const matchId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(matchId)) {
      return { status: 400, jsonBody: { error: "Invalid match id" } };
    }

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) {
      return { status: 404, jsonBody: { error: "Match not found" } };
    }

    const legs = await loadLegsWithThrows(prisma, matchId);
    const outcome = replayMatch(match.player1Id, match.player2Id, legs);

    return {
      status: 200,
      jsonBody: buildLiveStateResponse(
        { id: match.id, status: match.status, player1Id: match.player1Id, player2Id: match.player2Id },
        legs,
        outcome
      ),
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`GET /api/matches/{id}/live failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("matchesLiveGet", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "matches/{id}/live",
  handler: getLiveMatch,
});
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `cd api && npm test`
Expected: PASS — the whole suite passes, including all new tests in `liveStart.test.ts` and `liveGet.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/functions/matches/liveStart.ts src/functions/matches/liveGet.ts test/functions/matches/liveStart.test.ts test/functions/matches/liveGet.test.ts
git commit -m "Add POST /matches/{id}/live/start and GET /matches/{id}/live endpoints"
```

---

### Task 5: `POST /api/matches/{id}/live/throws`

**Files:**
- Create: `api/src/functions/matches/liveThrow.ts`
- Test: `api/test/functions/matches/liveThrow.test.ts`

**Interfaces:**
- Consumes: `isValidThrowInput`, `throwValue`, `replayMatch`, `Multiplier` from `../../lib/liveScoring` (Task 2); `loadLegsWithThrows`, `reconcileMatchState`, `buildLiveStateResponse` from `../../lib/liveScoringStore` (Task 3).
- Produces: `recordLiveThrow` exported handler, registered as `matchesLiveThrow` (`POST matches/{id}/live/throws`).

- [ ] **Step 1: Write the failing test — `api/test/functions/matches/liveThrow.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { recordLiveThrow } from "../../../src/functions/matches/liveThrow";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { match: { findUnique: vi.fn() }, $transaction: vi.fn() },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createRequest(id: string, body: unknown): HttpRequest {
  return { params: { id }, json: async () => body } as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

const inProgressMatch = {
  id: 101,
  player1Id: 1,
  player2Id: 2,
  status: "in_progress",
  season: { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: new Date() },
};

const validBody = { multiplier: "triple", segment: 20 };

function mockTransaction(legsBeforeInsert: unknown[]) {
  const tx = {
    leg: { findMany: vi.fn(), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}) },
    throw: { create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
    match: { update: vi.fn().mockResolvedValue({}) },
  };
  tx.leg.findMany.mockResolvedValueOnce(legsBeforeInsert);
  tx.leg.findMany.mockResolvedValue(legsBeforeInsert);
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(tx)) as unknown as typeof prisma.$transaction);
  return tx;
}

describe("recordLiveThrow function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await recordLiveThrow(createRequest("101", validBody), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 400 for an invalid multiplier/segment combination", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(inProgressMatch as never);
    const result = await recordLiveThrow(createRequest("101", { multiplier: "triple", segment: 25 }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 404 when the match doesn't exist", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
    const result = await recordLiveThrow(createRequest("999", validBody), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 403 when the caller is neither admin nor a participant", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 5, role: "player" });
    vi.mocked(prisma.match.findUnique).mockResolvedValue(inProgressMatch as never);
    const result = await recordLiveThrow(createRequest("101", validBody), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the match's season is archived", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      ...inProgressMatch,
      season: { ...inProgressMatch.season, status: "archived" },
    } as never);
    const result = await recordLiveThrow(createRequest("101", validBody), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when the match is not live", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({ ...inProgressMatch, status: "scheduled" } as never);
    const result = await recordLiveThrow(createRequest("101", validBody), createContext());
    expect(result.status).toBe(400);
  });

  it("inserts the throw at the correct leg/turn/dart/player position and returns the updated state", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(inProgressMatch as never);
    const tx = mockTransaction([{ id: 10, legNumber: 1, startingPlayerId: 1, winnerPlayerId: null, checkoutValue: null, throws: [] }]);

    const result = await recordLiveThrow(createRequest("101", validBody), createContext());

    expect(tx.throw.create).toHaveBeenCalledWith({
      data: { legId: 10, playerId: 1, turnNumber: 1, dartNumber: 1, multiplier: "triple", segment: 20, value: 60 },
    });
    expect(result.status).toBe(200);
  });

  it("returns 400 when the match is already complete (no current turn)", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(inProgressMatch as never);
    const wonLegThrows = (idBase: number) => [
      { id: idBase + 1, turnNumber: 1, dartNumber: 1, playerId: 1, multiplier: "triple", segment: 20, value: 60, busted: false },
      { id: idBase + 2, turnNumber: 1, dartNumber: 2, playerId: 1, multiplier: "triple", segment: 20, value: 60, busted: false },
      { id: idBase + 3, turnNumber: 1, dartNumber: 3, playerId: 1, multiplier: "triple", segment: 20, value: 60, busted: false },
      { id: idBase + 4, turnNumber: 2, dartNumber: 1, playerId: 1, multiplier: "triple", segment: 20, value: 60, busted: false },
      { id: idBase + 5, turnNumber: 2, dartNumber: 2, playerId: 1, multiplier: "triple", segment: 20, value: 60, busted: false },
      { id: idBase + 6, turnNumber: 2, dartNumber: 3, playerId: 1, multiplier: "triple", segment: 20, value: 60, busted: false },
      { id: idBase + 7, turnNumber: 3, dartNumber: 1, playerId: 1, multiplier: "double", segment: 20, value: 40, busted: false },
      { id: idBase + 8, turnNumber: 3, dartNumber: 2, playerId: 1, multiplier: "triple", segment: 17, value: 51, busted: false },
      { id: idBase + 9, turnNumber: 3, dartNumber: 3, playerId: 1, multiplier: "double", segment: 25, value: 50, busted: false },
    ];
    const legs = [
      { id: 10, legNumber: 1, startingPlayerId: 1, winnerPlayerId: 1, checkoutValue: 141, throws: wonLegThrows(0) },
      { id: 11, legNumber: 2, startingPlayerId: 2, winnerPlayerId: 1, checkoutValue: 141, throws: wonLegThrows(100) },
      { id: 12, legNumber: 3, startingPlayerId: 1, winnerPlayerId: 1, checkoutValue: 141, throws: wonLegThrows(200) },
    ];
    mockTransaction(legs);

    const result = await recordLiveThrow(createRequest("101", validBody), createContext());
    expect(result.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/functions/matches/liveThrow.ts` does not exist.

- [ ] **Step 3: Create `api/src/functions/matches/liveThrow.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { isValidThrowInput, throwValue, replayMatch, type Multiplier } from "../../lib/liveScoring";
import { loadLegsWithThrows, reconcileMatchState, buildLiveStateResponse } from "../../lib/liveScoringStore";

type RecordThrowBody = {
  multiplier?: unknown;
  segment?: unknown;
};

export async function recordLiveThrow(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const claims = await requireAuth(request);

    const matchId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(matchId)) {
      return { status: 400, jsonBody: { error: "Invalid match id" } };
    }

    let body: RecordThrowBody;
    try {
      body = (await request.json()) as RecordThrowBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    if (!isValidThrowInput(body.multiplier, body.segment)) {
      return { status: 400, jsonBody: { error: "multiplier/segment is not a valid throw" } };
    }
    const multiplier = body.multiplier as Multiplier;
    const segment = body.segment as number;

    const existing = await prisma.match.findUnique({ where: { id: matchId }, include: { season: true } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Match not found" } };
    }

    if (claims.role !== "admin" && claims.userId !== existing.player1Id && claims.userId !== existing.player2Id) {
      return { status: 403, jsonBody: { error: "Insufficient permissions" } };
    }

    if (existing.season.status !== "active") {
      return { status: 400, jsonBody: { error: "Cannot modify a match in an archived season" } };
    }

    if (existing.status !== "in_progress") {
      return { status: 400, jsonBody: { error: "Match is not live" } };
    }

    const result = await prisma.$transaction(async (tx) => {
      const legsBefore = await loadLegsWithThrows(tx, matchId);
      const outcomeBefore = replayMatch(existing.player1Id, existing.player2Id, legsBefore);
      if (!outcomeBefore.currentTurn) {
        return null;
      }
      const currentTurn = outcomeBefore.currentTurn;
      const currentLeg = legsBefore.find((leg) => leg.legNumber === currentTurn.legNumber)!;

      await tx.throw.create({
        data: {
          legId: currentLeg.id,
          playerId: currentTurn.playerId,
          turnNumber: currentTurn.turnNumber,
          dartNumber: currentTurn.dartNumber,
          multiplier,
          segment,
          value: throwValue(multiplier, segment),
        },
      });

      return reconcileMatchState(tx, matchId, existing.player1Id, existing.player2Id, claims.userId);
    });

    if (!result) {
      return { status: 400, jsonBody: { error: "Match is already complete" } };
    }

    return {
      status: 200,
      jsonBody: buildLiveStateResponse(
        {
          id: existing.id,
          status: result.outcome.match.complete ? "played" : "in_progress",
          player1Id: existing.player1Id,
          player2Id: existing.player2Id,
        },
        result.legs,
        result.outcome
      ),
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/matches/{id}/live/throws failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("matchesLiveThrow", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "matches/{id}/live/throws",
  handler: recordLiveThrow,
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole suite passes, including all new tests in `liveThrow.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/functions/matches/liveThrow.ts test/functions/matches/liveThrow.test.ts
git commit -m "Add POST /matches/{id}/live/throws endpoint"
```

---

### Task 6: `POST /api/matches/{id}/live/throws/undo`

**Files:**
- Create: `api/src/functions/matches/liveUndo.ts`
- Test: `api/test/functions/matches/liveUndo.test.ts`

**Interfaces:**
- Consumes: `reconcileMatchState`, `buildLiveStateResponse` from `../../lib/liveScoringStore` (Task 3).
- Produces: `undoLiveThrow` exported handler, registered as `matchesLiveUndo` (`POST matches/{id}/live/throws/undo`).

- [ ] **Step 1: Write the failing test — `api/test/functions/matches/liveUndo.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { undoLiveThrow } from "../../../src/functions/matches/liveUndo";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { match: { findUnique: vi.fn() }, throw: { findFirst: vi.fn() }, $transaction: vi.fn() },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createRequest(id: string): HttpRequest {
  return { params: { id } } as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

const liveMatch = {
  id: 101,
  player1Id: 1,
  player2Id: 2,
  status: "in_progress",
  season: { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: new Date() },
};

function mockTransaction() {
  const tx = {
    leg: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}), delete: vi.fn().mockResolvedValue({}) },
    throw: { delete: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
    match: { update: vi.fn().mockResolvedValue({}) },
  };
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(tx)) as unknown as typeof prisma.$transaction);
  return tx;
}

describe("undoLiveThrow function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 401 when the caller is not authenticated", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await undoLiveThrow(createRequest("101"), createContext());
    expect(result.status).toBe(401);
  });

  it("returns 404 when the match doesn't exist", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(null);
    const result = await undoLiveThrow(createRequest("999"), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 403 when the caller is neither admin nor a participant", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 5, role: "player" });
    vi.mocked(prisma.match.findUnique).mockResolvedValue(liveMatch as never);
    const result = await undoLiveThrow(createRequest("101"), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when the match's season is archived", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({
      ...liveMatch,
      season: { ...liveMatch.season, status: "archived" },
    } as never);
    const result = await undoLiveThrow(createRequest("101"), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when there is nothing to undo", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(liveMatch as never);
    vi.mocked(prisma.throw.findFirst).mockResolvedValue(null);
    const result = await undoLiveThrow(createRequest("101"), createContext());
    expect(result.status).toBe(400);
  });

  it("deletes the most recent throw and returns the reconciled state", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue(liveMatch as never);
    vi.mocked(prisma.throw.findFirst).mockResolvedValue({ id: 42 } as never);
    const tx = mockTransaction();
    tx.leg.findMany.mockResolvedValue([{ id: 10, legNumber: 1, startingPlayerId: 1, winnerPlayerId: null, checkoutValue: null, throws: [] }]);

    const result = await undoLiveThrow(createRequest("101"), createContext());

    expect(prisma.throw.findFirst).toHaveBeenCalledWith({ where: { leg: { matchId: 101 } }, orderBy: { id: "desc" } });
    expect(tx.throw.delete).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(result.status).toBe(200);
  });

  it("undoes a match-completing dart, restoring in_progress status", async () => {
    vi.mocked(prisma.match.findUnique).mockResolvedValue({ ...liveMatch, status: "played" } as never);
    vi.mocked(prisma.throw.findFirst).mockResolvedValue({ id: 209 } as never);
    const tx = mockTransaction();
    tx.leg.findMany.mockResolvedValue([{ id: 12, legNumber: 3, startingPlayerId: 1, winnerPlayerId: null, checkoutValue: null, throws: [] }]);

    const result = await undoLiveThrow(createRequest("101"), createContext());

    expect(result.status).toBe(200);
    const body = result.jsonBody as { match: { status: string } };
    expect(body.match.status).toBe("in_progress");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/functions/matches/liveUndo.ts` does not exist.

- [ ] **Step 3: Create `api/src/functions/matches/liveUndo.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { reconcileMatchState, buildLiveStateResponse } from "../../lib/liveScoringStore";

export async function undoLiveThrow(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const claims = await requireAuth(request);

    const matchId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(matchId)) {
      return { status: 400, jsonBody: { error: "Invalid match id" } };
    }

    const existing = await prisma.match.findUnique({ where: { id: matchId }, include: { season: true } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "Match not found" } };
    }

    if (claims.role !== "admin" && claims.userId !== existing.player1Id && claims.userId !== existing.player2Id) {
      return { status: 403, jsonBody: { error: "Insufficient permissions" } };
    }

    if (existing.season.status !== "active") {
      return { status: 400, jsonBody: { error: "Cannot modify a match in an archived season" } };
    }

    const lastThrow = await prisma.throw.findFirst({ where: { leg: { matchId } }, orderBy: { id: "desc" } });
    if (!lastThrow) {
      return { status: 400, jsonBody: { error: "Nothing to undo" } };
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.throw.delete({ where: { id: lastThrow.id } });
      return reconcileMatchState(tx, matchId, existing.player1Id, existing.player2Id, claims.userId);
    });

    return {
      status: 200,
      jsonBody: buildLiveStateResponse(
        {
          id: existing.id,
          status: result.outcome.match.complete ? "played" : "in_progress",
          player1Id: existing.player1Id,
          player2Id: existing.player2Id,
        },
        result.legs,
        result.outcome
      ),
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/matches/{id}/live/throws/undo failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("matchesLiveUndo", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "matches/{id}/live/throws/undo",
  handler: undoLiveThrow,
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — the whole suite passes, including all new tests in `liveUndo.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/functions/matches/liveUndo.ts test/functions/matches/liveUndo.test.ts
git commit -m "Add POST /matches/{id}/live/throws/undo endpoint"
```

---

### Task 7: Frontend API client — live scoring types and functions

**Files:**
- Modify: `src/lib/api-client.ts`

**Interfaces:**
- Produces: `LiveMultiplier`, `LiveThrow`, `LiveLeg`, `LiveCurrentTurn`, `LiveMatchOutcome`, `LiveMatchState` types; `startLiveMatch(id): Promise<LiveMatchState>`, `getLiveMatch(id): Promise<LiveMatchState>`, `recordLiveThrow(id, input): Promise<LiveMatchState>`, `undoLiveThrow(id): Promise<LiveMatchState>`. Also widens `SeasonMatch.status` and `MatchUpdateResult.status` to include `"in_progress"` (both fields can now genuinely hold that value once a match is live). Task 8 (`LiveScoring.tsx`) and Task 9 (`Season.tsx`) import all of these.

- [ ] **Step 1: Widen the two existing status types in `src/lib/api-client.ts`**

Change (in `SeasonMatch`):
```typescript
  status: "scheduled" | "cancelled" | "played";
```
to:
```typescript
  status: "scheduled" | "cancelled" | "played" | "in_progress";
```

Change (in `MatchUpdateResult`):
```typescript
  status: "scheduled" | "cancelled" | "played";
```
to:
```typescript
  status: "scheduled" | "cancelled" | "played" | "in_progress";
```

- [ ] **Step 2: Append the live-scoring types and functions to the end of `src/lib/api-client.ts`**

```typescript
export type LiveMultiplier = "single" | "double" | "triple";

export type LiveThrow = {
  id: number;
  turnNumber: number;
  dartNumber: number;
  playerId: number;
  multiplier: LiveMultiplier;
  segment: number;
  value: number;
  busted: boolean;
};

export type LiveLeg = {
  id: number;
  legNumber: number;
  startingPlayerId: number;
  winnerPlayerId: number | null;
  checkoutValue: number | null;
  throws: LiveThrow[];
};

export type LiveCurrentTurn = {
  legNumber: number;
  turnNumber: number;
  dartNumber: number;
  playerId: number;
  player1Remaining: number;
  player2Remaining: number;
};

export type LiveMatchOutcome = {
  complete: boolean;
  winnerPlayerId: number | null;
  player1Legs: number;
  player2Legs: number;
  player1Checkout: number | null;
  player2Checkout: number | null;
};

export type LiveMatchState = {
  match: { id: number; status: string; player1Id: number; player2Id: number };
  legs: LiveLeg[];
  currentTurn: LiveCurrentTurn | null;
  matchOutcome: LiveMatchOutcome;
};

export async function startLiveMatch(id: number): Promise<LiveMatchState> {
  const response = await fetch(`/api/matches/${id}/live/start`, {
    method: "POST",
    credentials: "same-origin",
  });
  return parseJsonResponse<LiveMatchState>(response);
}

export async function getLiveMatch(id: number): Promise<LiveMatchState> {
  const response = await fetch(`/api/matches/${id}/live`, { credentials: "same-origin" });
  return parseJsonResponse<LiveMatchState>(response);
}

export async function recordLiveThrow(
  id: number,
  input: { multiplier: LiveMultiplier; segment: number }
): Promise<LiveMatchState> {
  const response = await fetch(`/api/matches/${id}/live/throws`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  return parseJsonResponse<LiveMatchState>(response);
}

export async function undoLiveThrow(id: number): Promise<LiveMatchState> {
  const response = await fetch(`/api/matches/${id}/live/throws/undo`, {
    method: "POST",
    credentials: "same-origin",
  });
  return parseJsonResponse<LiveMatchState>(response);
}
```

- [ ] **Step 3: Verify the project builds**

Run: `npm run build`
Expected: `tsc` succeeds with no errors (confirms the widened status types don't break any existing usage).

- [ ] **Step 4: Commit**

```bash
git add src/lib/api-client.ts
git commit -m "Add live scoring API client types and functions"
```

---

### Task 8: `LiveScoring` page

**Files:**
- Create: `src/pages/season/LiveScoring.tsx`
- Test: `src/pages/season/LiveScoring.test.tsx`

**Interfaces:**
- Consumes: `listSeasons`, `getSeason`, `startLiveMatch`, `getLiveMatch`, `recordLiveThrow`, `undoLiveThrow`, `SeasonMatch`, `LiveMatchState`, `LiveMultiplier` from `../../lib/api-client` (Task 7); `useAuth` from `../../lib/AuthContext`.
- Produces: default export `LiveScoring` React component, consumed by Task 10's route wiring.

- [ ] **Step 1: Write the failing test — `src/pages/season/LiveScoring.test.tsx`**

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import LiveScoring from "./LiveScoring";
import * as apiClient from "../../lib/api-client";
import { useAuth } from "../../lib/AuthContext";

vi.mock("../../lib/api-client");
vi.mock("../../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const scheduledMatch: apiClient.SeasonMatch = {
  id: 101,
  roundNumber: 1,
  date: "2026-08-01",
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

const inProgressMatch: apiClient.SeasonMatch = { ...scheduledMatch, id: 102, status: "in_progress" };

const season: apiClient.Season = {
  id: 1,
  name: "Spring 2026",
  roundType: "single",
  status: "active",
  participants: [
    { id: 1, displayName: "Administrator" },
    { id: 2, displayName: "Bob Smith" },
    { id: 3, displayName: "Carol Jones" },
  ],
  matches: [scheduledMatch, inProgressMatch],
};

function mockAuth(id: number, role: "admin" | "player") {
  vi.mocked(useAuth).mockReturnValue({
    user: { id, username: "x", role, displayName: "X" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function mockSeasonLoad() {
  vi.mocked(apiClient.listSeasons).mockResolvedValue([
    { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
  ]);
  vi.mocked(apiClient.getSeason).mockResolvedValue(season);
}

function renderWithRouter(matchId: number) {
  return render(
    <MemoryRouter initialEntries={[`/season/matches/${matchId}/live`]}>
      <Routes>
        <Route path="/season/matches/:id/live" element={<LiveScoring />} />
        <Route path="/season" element={<div>Season page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const freshLiveState: apiClient.LiveMatchState = {
  match: { id: 101, status: "in_progress", player1Id: 1, player2Id: 2 },
  legs: [{ id: 10, legNumber: 1, startingPlayerId: 1, winnerPlayerId: null, checkoutValue: null, throws: [] }],
  currentTurn: { legNumber: 1, turnNumber: 1, dartNumber: 1, playerId: 1, player1Remaining: 501, player2Remaining: 501 },
  matchOutcome: { complete: false, winnerPlayerId: null, player1Legs: 0, player2Legs: 0, player1Checkout: null, player2Checkout: null },
};

describe("LiveScoring", () => {
  it("shows a Start Match button for a scheduled match that hasn't been started", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();

    renderWithRouter(101);

    await waitFor(() => expect(screen.getByRole("button", { name: "Start Match" })).toBeInTheDocument());
  });

  it("starts the match and shows the tap grid on Start Match click", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.startLiveMatch).mockResolvedValue(freshLiveState);

    renderWithRouter(101);
    await waitFor(() => screen.getByRole("button", { name: "Start Match" }));
    await userEvent.click(screen.getByRole("button", { name: "Start Match" }));

    await waitFor(() => {
      expect(apiClient.startLiveMatch).toHaveBeenCalledWith(101);
      expect(screen.getByRole("button", { name: "20" })).toBeInTheDocument();
    });
  });

  it("loads the live state directly for an already in_progress match", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.getLiveMatch).mockResolvedValue(freshLiveState);

    renderWithRouter(102);

    await waitFor(() => {
      expect(apiClient.getLiveMatch).toHaveBeenCalledWith(102);
      expect(screen.getByRole("button", { name: "20" })).toBeInTheDocument();
    });
  });

  it("records a throw when a number is tapped, using the selected multiplier", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.getLiveMatch).mockResolvedValue(freshLiveState);
    vi.mocked(apiClient.recordLiveThrow).mockResolvedValue(freshLiveState);

    renderWithRouter(102);
    await waitFor(() => screen.getByRole("button", { name: "20" }));

    await userEvent.click(screen.getByRole("button", { name: "triple" }));
    await userEvent.click(screen.getByRole("button", { name: "20" }));

    await waitFor(() => {
      expect(apiClient.recordLiveThrow).toHaveBeenCalledWith(102, { multiplier: "triple", segment: 20 });
    });
  });

  it("hides the Bull option when triple is selected", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.getLiveMatch).mockResolvedValue(freshLiveState);

    renderWithRouter(102);
    await waitFor(() => screen.getByRole("button", { name: "20" }));

    expect(screen.getByRole("button", { name: "Bull" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "triple" }));
    expect(screen.queryByRole("button", { name: "Bull" })).not.toBeInTheDocument();
  });

  it("undoes the last throw when Undo is clicked", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    const stateWithOneThrow: apiClient.LiveMatchState = {
      ...freshLiveState,
      legs: [{ ...freshLiveState.legs[0], throws: [{ id: 1, turnNumber: 1, dartNumber: 1, playerId: 1, multiplier: "triple", segment: 20, value: 60, busted: false }] }],
    };
    vi.mocked(apiClient.getLiveMatch).mockResolvedValue(stateWithOneThrow);
    vi.mocked(apiClient.undoLiveThrow).mockResolvedValue(freshLiveState);

    renderWithRouter(102);
    await waitFor(() => screen.getByRole("button", { name: "Undo" }));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => {
      expect(apiClient.undoLiveThrow).toHaveBeenCalledWith(102);
    });
  });

  it("shows a completion summary with a Back to Season button when the match is complete", async () => {
    mockAuth(1, "admin");
    mockSeasonLoad();
    vi.mocked(apiClient.getLiveMatch).mockResolvedValue({
      ...freshLiveState,
      currentTurn: null,
      matchOutcome: { complete: true, winnerPlayerId: 1, player1Legs: 3, player2Legs: 1, player1Checkout: 82, player2Checkout: null },
    });

    renderWithRouter(102);

    await waitFor(() => {
      expect(screen.getByText("Match complete: Administrator wins 3–1")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "20" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back to Season" }));
    await waitFor(() => expect(screen.getByText("Season page")).toBeInTheDocument());
  });

  it("shows a read-only message with no scoring controls for a non-participant player", async () => {
    mockAuth(3, "player");
    mockSeasonLoad();

    renderWithRouter(102);

    await waitFor(() => {
      expect(screen.getByText("You are not allowed to score this match.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Start Match" })).not.toBeInTheDocument();
  });

  it("shows an error when no match with that id exists in the active season", async () => {
    mockAuth(1, "admin");
    vi.mocked(apiClient.listSeasons).mockResolvedValue([]);

    renderWithRouter(999);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Match not found");
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/pages/season/LiveScoring.tsx` does not exist.

- [ ] **Step 3: Create `src/pages/season/LiveScoring.tsx`**

```typescript
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import {
  listSeasons,
  getSeason,
  startLiveMatch,
  getLiveMatch,
  recordLiveThrow,
  undoLiveThrow,
  type SeasonMatch,
  type LiveMatchState,
  type LiveMultiplier,
} from "../../lib/api-client";

const NUMBERS = Array.from({ length: 20 }, (_, i) => i + 1);

export default function LiveScoring() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [match, setMatch] = useState<SeasonMatch | null>(null);
  const [live, setLive] = useState<LiveMatchState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [multiplier, setMultiplier] = useState<LiveMultiplier>("single");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const matchId = Number(id);
    setLoading(true);
    setError(null);
    try {
      const seasons = await listSeasons();
      const active = seasons.find((s) => s.status === "active");
      if (!active) {
        setError("Match not found");
        return;
      }
      const season = await getSeason(active.id);
      const found = season.matches.find((m) => m.id === matchId);
      if (!found) {
        setError("Match not found");
        return;
      }
      setMatch(found);
      if (found.status === "in_progress" || found.status === "played") {
        setLive(await getLiveMatch(matchId));
      } else {
        setLive(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load match");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const canScore =
    !!match && !!user && (user.role === "admin" || user.id === match.player1.id || user.id === match.player2.id);

  async function handleStart() {
    if (!match) return;
    setActionError(null);
    setSubmitting(true);
    try {
      setLive(await startLiveMatch(match.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to start match");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleThrow(segment: number) {
    if (!match) return;
    setActionError(null);
    setSubmitting(true);
    try {
      setLive(await recordLiveThrow(match.id, { multiplier, segment }));
      setMultiplier("single");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to record throw");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUndo() {
    if (!match) return;
    setActionError(null);
    setSubmitting(true);
    try {
      setLive(await undoLiveThrow(match.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to undo");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="p-4">Loading…</p>;
  }

  if (error || !match) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        {error ?? "Match not found"}
      </p>
    );
  }

  if (!canScore) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        You are not allowed to score this match.
      </p>
    );
  }

  const playerName = (playerId: number) =>
    playerId === match.player1.id ? match.player1.displayName : match.player2.displayName;

  const hasAnyThrows = !!live && live.legs.some((leg) => leg.throws.length > 0);

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">
        {match.player1.displayName} vs {match.player2.displayName}
      </h1>

      {actionError && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {actionError}
        </p>
      )}

      {!live && (
        <button
          onClick={() => void handleStart()}
          disabled={submitting}
          className="bg-primary text-primary-content font-heading rounded p-2 disabled:opacity-50"
        >
          Start Match
        </button>
      )}

      {live && !live.matchOutcome.complete && live.currentTurn && (
        <div className="space-y-4">
          <p className="font-heading text-lg">
            Leg {live.currentTurn.legNumber} — {live.matchOutcome.player1Legs}–{live.matchOutcome.player2Legs}
          </p>
          <p>
            {match.player1.displayName}: {live.currentTurn.player1Remaining}
            {" | "}
            {match.player2.displayName}: {live.currentTurn.player2Remaining}
          </p>
          <p className="font-semibold">Now throwing: {playerName(live.currentTurn.playerId)}</p>
          <p className="text-sm text-gray-500">
            {live.legs
              .find((leg) => leg.legNumber === live.currentTurn!.legNumber)
              ?.throws.filter((th) => th.turnNumber === live.currentTurn!.turnNumber)
              .map((th) => `${th.multiplier[0].toUpperCase()}${th.segment}`)
              .join(", ") || "No darts yet this turn"}
          </p>

          <div role="group" aria-label="Multiplier" className="flex gap-2">
            {(["single", "double", "triple"] as LiveMultiplier[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMultiplier(m)}
                aria-pressed={multiplier === m}
                className={`rounded border p-2 ${multiplier === m ? "bg-primary text-primary-content" : "border-gray-300"}`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-5 gap-2">
            {NUMBERS.map((n) => (
              <button
                key={n}
                type="button"
                disabled={submitting}
                onClick={() => void handleThrow(n)}
                className="rounded border border-gray-300 p-2 disabled:opacity-50"
              >
                {n}
              </button>
            ))}
            {multiplier !== "triple" && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleThrow(25)}
                className="rounded border border-gray-300 p-2 disabled:opacity-50"
              >
                Bull
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={submitting || !hasAnyThrows}
            onClick={() => void handleUndo()}
            className="rounded border border-gray-300 p-2 disabled:opacity-50"
          >
            Undo
          </button>
        </div>
      )}

      {live && live.matchOutcome.complete && (
        <div className="space-y-4">
          <p className="font-heading text-lg">
            Match complete: {playerName(live.matchOutcome.winnerPlayerId!)} wins {live.matchOutcome.player1Legs}–
            {live.matchOutcome.player2Legs}
          </p>
          <p>
            {match.player1.displayName} highest checkout: {live.matchOutcome.player1Checkout ?? "—"}
          </p>
          <p>
            {match.player2.displayName} highest checkout: {live.matchOutcome.player2Checkout ?? "—"}
          </p>
          <button
            type="button"
            onClick={() => navigate("/season")}
            className="bg-primary text-primary-content font-heading rounded p-2"
          >
            Back to Season
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — the whole suite passes, including all new tests in `LiveScoring.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/season/LiveScoring.tsx src/pages/season/LiveScoring.test.tsx
git commit -m "Add LiveScoring page (tap grid, undo, leg/match completion)"
```

---

### Task 9: Wire "Start Live"/"Resume Live" into `Season.tsx`

**Files:**
- Modify: `src/pages/season/Season.tsx`
- Modify: `src/pages/season/Season.test.tsx`

**Interfaces:**
- Consumes: nothing new (uses the already-widened `SeasonMatch.status` from Task 7).

- [ ] **Step 1: Add failing tests to `src/pages/season/Season.test.tsx`**

Append inside the existing `describe("SeasonPage", ...)` block, after the `"shows only an Enter Result link..."` test:

```typescript
  it("shows a Start Live link for a scheduled match, alongside Enter Result", async () => {
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
    expect(screen.getByRole("link", { name: "Start Live" })).toHaveAttribute("href", "/season/matches/101/live");
  });

  it("shows a Resume Live link for an in_progress match", async () => {
    mockParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      ...season,
      matches: [{ ...season.matches[0], status: "in_progress" }],
    });
    render(
      <MemoryRouter>
        <SeasonPage />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.getByRole("link", { name: "Resume Live" })).toHaveAttribute("href", "/season/matches/101/live");
  });

  it("shows no live-scoring link once a match is played", async () => {
    mockAdmin();
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
    expect(screen.queryByRole("link", { name: "Start Live" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Resume Live" })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test`
Expected: FAIL — no "Start Live"/"Resume Live" links exist yet.

- [ ] **Step 3: Modify `src/pages/season/Season.tsx`**

In the `renderMatchActions` callback, insert a new conditional link immediately before the existing `<Link to={`/season/matches/${match.id}/result`}>` line:

```typescript
              {(match.status === "scheduled" || match.status === "in_progress") && (
                <Link to={`/season/matches/${match.id}/live`} className="text-primary underline">
                  {match.status === "in_progress" ? "Resume Live" : "Start Live"}
                </Link>
              )}
              <Link to={`/season/matches/${match.id}/result`} className="text-primary underline">
                {match.status === "played" ? "Edit Result" : "Enter Result"}
              </Link>
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS — the whole suite passes, including the three new tests and all pre-existing `Season.test.tsx` tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/pages/season/Season.tsx src/pages/season/Season.test.tsx
git commit -m "Add Start Live/Resume Live link to the Season page"
```

---

### Task 10: Wire `/season/matches/:id/live` route into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `LiveScoring` default export from `./pages/season/LiveScoring` (Task 8).

- [ ] **Step 1: Add the import and route**

Add the import (after the existing `MatchResult` import):
```typescript
import LiveScoring from "./pages/season/LiveScoring";
```

Add the route (inside the `<Route element={<ProtectedRoute />}>` block, after the existing `/season/matches/:id/result` route):
```typescript
            <Route path="/season/matches/:id/live" element={<LiveScoring />} />
```

- [ ] **Step 2: Verify the project builds and tests still pass**

Run: `npm run build && npm test`
Expected: `tsc` succeeds with no errors; full test suite passes.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "Wire /season/matches/:id/live route into App"
```

---

### Task 11: Manual end-to-end verification

**Files:** None (manual verification only).

- [ ] **Step 1: Start the local dev stack**

Follow the workaround documented in memory (`env_swa_func_windows_broken_download`) to start the SWA CLI + Azure Functions Core Tools + Vite dev servers locally, with the local SQL Server container running.

- [ ] **Step 2: Verify all 12+4=16 functions register, including the four new live-scoring endpoints**

Confirm `matchesLiveStart`, `matchesLiveGet`, `matchesLiveThrow`, `matchesLiveUndo` appear in the Functions host startup log alongside the existing 12.

- [ ] **Step 3: Play one full best-of-5 match live via the browser (Playwright)**

As an admin (or a participant), navigate to an active season's scheduled match, click "Start Live", and score a full match to completion:
- Enter a normal scoring turn (e.g. three single darts) and confirm the remaining score updates correctly for the throwing player only.
- Deliberately bust a turn (throw darts that would take the score below 0) and confirm the remaining score reverts to its pre-turn value and the turn passes to the other player.
- Use Undo at least once (mid-turn) and confirm the reverted state matches expectations (dart removed, score restored, turn not advanced).
- Complete a leg via a valid double checkout and confirm the leg score updates and a fresh leg begins with the alternated starting player.
- Complete the match (first to 3 legs) and confirm the completion summary shows the correct winner, leg score, and highest checkouts, and that "Back to Season" returns to `/season` showing the match as played with an "Edit Result" link.

- [ ] **Step 4: Verify authorization boundaries**

Log in as a third player not part of the match and confirm: `GET /live` still succeeds (read is open to any authenticated user) but attempting `POST /live/throws` directly against the API returns a genuine 403 regardless of UI (the UI itself should never show scoring controls to a non-participant).

- [ ] **Step 5: Verify the manual result-entry override still works over a live-scored match**

As admin, open the "Edit Result" link for the just-completed live-scored match and confirm the manual result form is pre-filled with the live-scored legs/checkouts and can still overwrite them (last-write-wins, unchanged from the prior phase).

- [ ] **Step 6: Run both full test suites one final time**

```bash
cd api && npm test && npm run build
cd .. && npm test && npm run build
```
Expected: both suites pass in full, both builds are clean (no tsc errors).

- [ ] **Step 7: Stop the local dev stack**

Stop the SWA CLI/Functions/Vite dev server processes started in Step 1.

---
