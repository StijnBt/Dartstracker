# Live Scoreboard (Throw-by-Throw Match Scoring) — Design

## Overview

Admin or either match participant can run a live-scoring session during a match: every individual dart (multiplier + segment) is entered as it's thrown, in a single-shared-device model (one phone/tablet at the table, one scorer entering for both players). The server is the sole authority on remaining score, bust detection, checkout validation, leg completion, and match completion — the client only sends raw taps and renders whatever state the server returns. On match completion (first to 3 legs of 501 double-out), this becomes the definitive result via the same `Match` fields the existing manual result-entry endpoint writes, so downstream consumers (standings, later phases) don't need to know which channel produced a result.

This satisfies notes.md §3.5 (full throw-by-throw storage, multiplier-then-number tap pattern, no offline mode needed) and §3.4.3 ("on completion, this automatically becomes the definitive result"), and lays groundwork for future statistics (§3.8: three-dart average, checkout %, 180 count) without further entry work.

Out of scope for this phase: standings/statistics pages themselves (future phases), multi-device real-time sync (single shared device was chosen), offline support (not required per §3.5).

## Section 1: Data Model

Two new tables, plus widening `Match.status`:

```prisma
model Leg {
  id                Int      @id @default(autoincrement())
  matchId           Int
  legNumber         Int
  startingPlayerId  Int
  winnerPlayerId    Int?
  checkoutValue     Int?
  createdAt         DateTime @default(now())

  match          Match  @relation(fields: [matchId], references: [id])
  startingPlayer User   @relation("LegStartingPlayer", fields: [startingPlayerId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  winnerPlayer   User?  @relation("LegWinner", fields: [winnerPlayerId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  throws         Throw[]

  @@unique([matchId, legNumber])
}

model Throw {
  id         Int     @id @default(autoincrement())
  legId      Int
  playerId   Int
  turnNumber Int
  dartNumber Int
  multiplier String  // "single" | "double" | "triple"
  segment    Int     // 1-20 or 25 (bull)
  value      Int     // computed: multiplier * segment (double bull = 50)
  busted     Boolean @default(false)
  createdAt  DateTime @default(now())

  leg    Leg  @relation(fields: [legId], references: [id])
  player User @relation("ThrowPlayer", fields: [playerId], references: [id], onDelete: NoAction, onUpdate: NoAction)
}
```

`Match.status` widens from `"scheduled" | "cancelled" | "played"` to add `"in_progress"`. No new columns on `Match` itself are needed — `player1Legs`/`player2Legs`/`player1Checkout`/`player2Checkout`/`resultEnteredById`/`resultEnteredAt` (already present from the Match Result Entry phase) get written by the live-scoring flow on match completion, exactly as the manual entry endpoint writes them today.

`busted` marks throws whose turn was voided (score reverted) — they stay in the row for future statistics (§3.8) but are excluded from score/leg-completion math. `checkoutValue` on `Leg` is the sum of the winning turn's throw values (used to compute `Match.player1Checkout`/`player2Checkout` as the max across that player's won legs, on match completion).

## Section 2: Backend API & Domain Logic

Four endpoints under `/api/matches/{id}/live`, all requiring admin-or-participant auth (same model as the existing `PATCH /api/matches/{id}/result`) for writes; reads open to any authenticated user (consistent with `GET /api/seasons/{id}`).

- **`POST /live/start`** — preconditions: season active, match status `"scheduled"`. Sets `Match.status = "in_progress"`, creates `Leg` #1 (`startingPlayerId = player1Id`). Idempotent: calling again while already `"in_progress"` returns current state instead of erroring.
- **`GET /live`** — returns full state: all legs with their throws, plus a computed summary (current leg number, whose turn, each player's remaining score in the current leg, legs won by each player, whether the match is complete).
- **`POST /live/throws`** — body `{ multiplier, segment }` only; the server determines whose turn it is (never trusts the client for that). Validates the multiplier/segment combination, computes the dart's value, inserts one `Throw` row.
- **`POST /live/throws/undo`** — removes the single most-recent throw for the match (globally, by `Throw.id`).

**Core strategy — full replay, not incremental state.** Rather than hand-writing separate cases for "what happens on bust," "what happens on undo mid-leg," "what happens if undo reverses a match-winning checkout," every write (`throws` insert or `undo` delete) is followed by a single `recomputeMatchState(matchId)` step, run in the same transaction, that replays all remaining `Throw` rows leg-by-leg, turn-by-turn from scratch:

- computes each turn's running score, marks a turn's throws `busted` if a dart takes the score below 0, to exactly 1, or to 0 without the final dart being a double (including double bull = 50);
- sets `Leg.winnerPlayerId`/`checkoutValue` when a turn ends a leg (checkout = the leg's starting-of-turn remaining score);
- creates the next `Leg` row (alternating `startingPlayerId` — leg 1 starts player1, leg 2 starts player2, etc.) once a leg completes and neither player has 3 leg wins yet, or deletes a trailing empty `Leg` if undo removed its only throw;
- finalizes `Match` (`status="played"`, `player1Legs`/`player2Legs`, `player1Checkout`/`player2Checkout` as the max checkout among each player's won legs, `resultEnteredById`/`resultEnteredAt`) once a player reaches 3 legs — or reverses that back to `"in_progress"` with those fields cleared if an undo drops a player back below 3.

This makes undo (including undoing the match-winning dart) and bust detection both fall out of one deterministic function instead of separate hand-maintained cases, keeping `busted`/leg-winner/match-completion always consistent with the raw throw log. Replay cost is trivial (at most ~150 throws for a best-of-5 501 match).

**Determining whose turn it is, before a throw is inserted:** a shared pure function `computeLiveState(legs)` (fed the current legs+throws from the DB) derives the current active leg (the leg with `winnerPlayerId` null — always exactly one after `/start`, since legs are only created empty and immediately become "current"), the current turn number and dart number within that leg, and the current player. Turn number is a per-leg counter that increments each time a turn ends (3 darts thrown, or fewer if a bust/checkout ended it early); the player alternates each turn, starting from `Leg.startingPlayerId` on turn 1. `POST /live/throws` calls this function first to resolve `legId`/`playerId`/`turnNumber`/`dartNumber` for the new row (the client never supplies these), then inserts the throw and runs `recomputeMatchState`. `GET /live` calls the same function to build its response, so there is one source of truth for "whose turn is it" shared by both reads and writes.

The existing manual `PATCH /api/matches/{id}/result` endpoint is untouched — it remains available as a last-write-wins override at any time (including over an abandoned `"in_progress"` session), matching the existing cross-channel semantics from the Match Result Entry phase.

Bull handling: multiplier=single + segment=25 → value 25; multiplier=double + segment=25 → value 50; triple+bull is never a valid combination.

## Section 3: Frontend

New page `LiveScoring` at `/season/matches/:id/live`, linked from `Season.tsx`'s per-match actions (same admin-or-participant check already used for "Enter Result"): a `"Start Live"` link when `status === "scheduled"`, `"Resume Live"` when `"in_progress"`. The existing `"Enter/Edit Result"` manual-entry link stays available at all times too — consistent with the established last-write-wins model, this lets the admin abandon a live session and type a final score manually if needed.

On load, the page fetches `GET /live`:
- If the match hasn't been started yet, shows a **"Start Match"** confirmation button (prevents an accidental tap on the schedule list from silently starting a session) → calls `POST /live/start`.
- Otherwise renders the live state: current leg number and leg score (e.g. "2–1"), each player's remaining score for the current leg with the active thrower highlighted, and the current turn's darts so far as chips (e.g. "T20, T20, D20").

Input controls: a multiplier row (Single/Double/Triple — Single selected by default) plus a number grid (1–20 and Bull). Selecting Triple hides/disables the Bull tile (no triple bull). Tapping a number immediately submits `{multiplier, segment}` to `POST /live/throws`, resets the multiplier selector back to Single, and re-renders from the server's returned state (server is authoritative on bust/checkout/completion — the client never computes this itself). An **Undo** button (enabled whenever at least one throw exists) calls `POST /live/throws/undo`.

On leg completion, a brief inline banner ("Leg won by X!") shows before the next leg's state renders. On match completion, the input controls are replaced by a completion summary (final leg score, checkouts) with a "Back to Season" button navigating to `/season` — no auto-redirect, so the scorer sees the result land before leaving.

## Section 4: Error Handling

- `POST /live/start` on a `"played"`/`"cancelled"` match, or an archived season → 400 (same "cannot modify a match in an archived season" check as the existing update/result endpoints). On an already-`"in_progress"` match → idempotent 200 with current state, not an error.
- `POST /live/throws` / `undo` when `status !== "in_progress"` → 400.
- Invalid multiplier/segment (bad enum value, segment outside 1–20/25, triple+bull) → 400, validated server-side regardless of what the UI restricts.
- `undo` with no throws recorded yet → 400 ("nothing to undo").
- Auth: non-admin/non-participant on any write → 403 (read via `GET /live` stays open to any authenticated user, matching the season-read pattern).
- A season archived mid-session blocks further writes the same way an archived season already blocks manual result edits.
- Client-side: a failed `POST /live/throws` (network blip) shows an inline error and leaves the tap controls active for retry — nothing is optimistically applied client-side before the server confirms, so there's no state to roll back.

## Section 5: Testing

Backend: unit tests for `recomputeMatchState` covering normal scoring, bust below 0, bust at exactly 1, bust at 0 with a non-double last dart, checkout on a regular double, checkout on double-bull (50), leg-starter alternation, match completion at 3 legs, undo mid-leg, undo across a leg boundary (undoing a new leg's only throw deletes that leg and reopens the previous one), and undo of the match-winning dart (un-finalizes the match, restoring `"in_progress"`). Endpoint tests for auth (403 non-participant) and preconditions (400 when not `"in_progress"`, archived-season block). Frontend component tests for the tap UI, undo button, and the completion screen's navigation. Manual E2E covers one full best-of-5 match live end-to-end, including at least one deliberate bust and one undo.
