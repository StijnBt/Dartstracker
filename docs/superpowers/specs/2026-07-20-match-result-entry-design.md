# Match Result Entry — Design

Status: approved design, ready for implementation planning.
Source: brainstorming session following Season & Schedule Management (PR #10, merged). Implements Section 3.4 (Result Entry) and part of Section 3.8 (per-match highest checkout) from `docs/superpowers/specs/2026-07-15-darts-league-app-design.md` — admin and self-report result entry channels, writing final leg scores to a match.

## 1. Overview

Lets the admin or either match participant record a match's final result — legs won by each player, plus an optional highest-checkout per player — via a dedicated page. Per the spec's "last entry wins" rule, submission is uniform across channels: any authorized submitter (admin or either participant) can overwrite the existing result at any time, with no locking and no confirmation step. A minimal audit trail (who submitted the current result, and when) is stored, since the spec flags this as recommended.

**Out of scope, deliberately deferred to later phases:** the live throw-by-throw scoreboard (Section 3.5) and standings/tie-break calculation (Section 3.7) — this phase only writes the final score a match settles on; those phases consume it. Forfeit/unplayed-match handling (Section 3.6, explicitly deferred by the product owner) is untouched — an unplayed match simply has no result and stays `"scheduled"`.

## 2. Data Model

Extends the existing `Match` model; no new tables.

```prisma
model Match {
  // ...existing fields unchanged...
  player1Legs       Int?
  player2Legs       Int?
  player1Checkout   Int?
  player2Checkout   Int?
  resultEnteredById Int?
  resultEnteredAt   DateTime?

  resultEnteredBy User? @relation("MatchResultEnteredBy", fields: [resultEnteredById], references: [id], onDelete: NoAction, onUpdate: NoAction)
}
```

- **`status` gains a third value:** `"scheduled" | "cancelled" | "played"`. Submitting a result automatically sets `status: "played"`.
- **A cancelled match can't receive a result** until an admin restores it to `"scheduled"` first (existing `PATCH /api/matches/{id}` endpoint from the Season phase already supports this transition).
- **Legs are validated against the fixed best-of-5 rule** (notes.md 3.3, not configurable): exactly one player's legs must equal `3`; the other's must be `0`, `1`, or `2`.
- **Checkouts are always optional** (confirmed: never required, even when a player won legs) and, if present, must be positive integers. No upper-bound/darts-legality validation in this phase — that level of rule enforcement belongs to the future live-scoring phase, which will derive checkouts from real throw data instead of manual entry.
- **`resultEnteredById` needs `onDelete: NoAction, onUpdate: NoAction`**, per the same SQL Server multi-cascade-path restriction discovered in the Season phase (`Match` already has two other FKs to `User` — `player1Id`/`player2Id` — and this is a third).
- **No result-locking by channel.** The spec's "admin entry is always authoritative" describes admin submissions as inherently trusted (no confirmation needed), not a priority mechanism — the tie-break rule for conflicting submissions is uniformly last-write-wins, confirmed with the product owner.

## 3. Backend API

New module `api/src/functions/matches/result.ts`, following the same structure as the existing `matches/update.ts` and `seasons/*.ts` modules.

### `PATCH /api/matches/{id}/result`

- Calls `requireAuth(request)` (any authenticated role — this is not admin-only), then an explicit authorization check: the caller must be `role === "admin"` OR their `userId` equals the match's `player1Id` or `player2Id`. Otherwise `403`.

Request: `{ player1Legs: number, player2Legs: number, player1Checkout?: number, player2Checkout?: number }`. Both legs values are required on every submission — re-submitting a result means sending the full result again, not a partial patch (unlike the schedule-management `PATCH /api/matches/{id}`, which does support partial updates).

- Validates: match exists (`404`); the match's season is `status: "active"` (`400` — same frozen-archived-season rule as the existing reschedule/cancel endpoint); the match's `status !== "cancelled"` (`400`); legs satisfy the best-of-5 rule (`400`); checkouts, if present, are positive integers (`400`).
- On success: sets `player1Legs`, `player2Legs`, `player1Checkout`, `player2Checkout` (nulled out if omitted from the request), `status: "played"`, `resultEnteredById: callerId`, `resultEnteredAt: new Date()`.

Responses:
- `200 { match: { id, roundNumber, date, status, player1Legs, player2Legs, player1Checkout, player2Checkout, resultEnteredBy: {id, displayName} | null, resultEnteredAt, player1Id, player2Id } }`.
- `400 { error: string }` for the validation cases above.
- `403 { error: "Insufficient permissions" }` for a non-admin, non-participant caller.
- `404 { error: "Match not found" }`.

### `GET /api/seasons/{id}` (existing endpoint, extended)

Its `matches` array gains the same result fields on every match: `player1Legs`, `player2Legs`, `player1Checkout`, `player2Checkout`, `resultEnteredBy: {id, displayName} | null`, `resultEnteredAt`. No new read endpoint — the result-entry page fetches a single match by calling `listSeasons()` → finding the active season → `getSeason(id)` → filtering by match id client-side, the same pattern already established for `EditMember` (Member Management phase) and `Season`/`SeasonDetail` (Season phase).

## 4. Frontend

### API client
`src/lib/api-client.ts`:
- `SeasonMatch` gains the new optional fields: `player1Legs?: number`, `player2Legs?: number`, `player1Checkout?: number`, `player2Checkout?: number`, `resultEnteredBy?: {id: number; displayName: string}`, `resultEnteredAt?: string`. `status` widens to `"scheduled" | "cancelled" | "played"`.
- `submitMatchResult(matchId: number, input: SubmitMatchResultInput): Promise<SeasonMatch>` — new function, following the existing `updateMatch`/`archiveSeason` fetch pattern (`credentials: "same-origin"`, throw the server's `error` message on failure).
- `SubmitMatchResultInput` type: `{ player1Legs: number; player2Legs: number; player1Checkout?: number; player2Checkout?: number }`.

### Route & page
| Route | Component | Access | Purpose |
|---|---|---|---|
| `/season/matches/:id/result` | `MatchResult.tsx` | any logged-in user (`ProtectedRoute`) | Finds the match via the active season, then branches: admin or either participant sees an editable form (leg-count inputs for both players, optional checkout inputs, pre-filled with any existing result); anyone else sees the same data read-only, no form controls. Submitting calls `submitMatchResult` and navigates back to `/season`. |

### Integration with existing pages
- **`Season.tsx`**: the `renderMatchActions` render-prop passed to `RoundRobinSchedule` is broadened from "admin-only for the whole page" to a per-match check inside the callback itself: `user.role === "admin" || match.player1.id === user.id || match.player2.id === user.id`. When true, renders an "Enter Result"/"Edit Result" link (label depends on whether `status === "played"` already) alongside admin's existing reschedule/cancel controls, or in place of them for a non-admin participant. No change to `RoundRobinSchedule.tsx`'s own interface — this logic lives entirely in `Season.tsx`'s existing render-prop.
- **`RoundRobinSchedule.tsx`**: when a match's `status === "played"`, its default (no-`renderMatchActions`) display shows the final score (e.g. `"3–1"`) instead of the raw date. This makes recorded results visible on both the live `Season.tsx` view and the read-only `SeasonDetail.tsx` archive view, without either page needing its own score-formatting logic.

## 5. Error Handling & Edge Cases

- **Cancelled match:** `PATCH .../result` returns `400`; surfaced inline via the same `role="alert"` pattern used throughout the app.
- **Archived season:** frozen via the same check already enforced for reschedule/cancel — reused verbatim, not reimplemented.
- **Unauthorized submitter:** `403` surfaced inline for a stale-tab or direct-API-call edge case; the read-only view for third parties never renders a submit control in the first place, so this is defense in depth, not the primary UX guard.
- **Re-editing a played match:** submitting again simply overwrites the stored result and `resultEnteredBy`/`resultEnteredAt` — no confirmation, no history retained beyond the single "who/when last touched it" pair (a fuller audit log, if ever needed, is out of scope here).
- **Best-of-5 violation:** both `0`/`0` and `3`/`3` (and everything else that isn't "one side has exactly 3, the other has 0–2") are rejected with a clear `400` message client- and server-side.

## 6. Testing

Same TDD pattern established in prior phases:
- Backend endpoint: a Vitest suite mocking `prisma`/`requireAuth`, covering the admin-or-participant authorization branch (admin succeeds on any match, a participant succeeds only on their own match, a third player gets `403`), the best-of-5 validation (both the winning and losing legs boundaries), the cancelled-match and archived-season rejections, and the success path including the resolved `resultEnteredBy`.
- Frontend: an RTL suite for `MatchResult.tsx` covering the three viewer types (admin, participant, third party) and the submit/pre-fill behavior; updates to `RoundRobinSchedule.test.tsx` for the new played-match score display; updates to `Season.test.tsx` for the per-match "Enter Result" link's conditional visibility.
- A manual end-to-end verification task closes out the plan: admin enters a result on a match; a participant edits it and confirms last-write-wins; a third player attempts the same match's result page and confirms read-only rendering plus a server-side `403` on a direct API attempt; cancelled-match and archived-season rejection paths; confirms the final score renders correctly on both the active `/season` view and the read-only `/seasons/:id` archive view.
