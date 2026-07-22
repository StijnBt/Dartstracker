# Additional Playing Days — Design

## Overview

Per notes.md §3.2, "additional playing days can be added during the season" — a requirement from the original spec that was never implemented. Currently `POST /api/seasons` generates the entire round-robin schedule once at season creation, and the only match-mutation endpoint (`PATCH /api/matches/{id}`) can only reschedule the date or cancel/restore the status of an *existing* match. There is no way to add a brand-new match to an active season, and no way to remove a match at all (cancelling is non-destructive — it flips a status flag, it doesn't purge recorded results or throw history).

This phase adds two capabilities for the admin, on the active season page only (archived seasons remain frozen, consistent with every other admin action already being unavailable there):

1. **Add a match**: the admin manually picks a date and two players from the season's roster and adds a single match. This is deliberately *not* an auto-generated full round (every player playing again) — it's a flexible, one-pairing-at-a-time addition, e.g. for a makeup game or an extra fixture. Multiple additions for the same date are just multiple individual submissions.
2. **Delete matches**: the admin selects one or more matches via checkboxes (from either the regular schedule or the newly-added ones) and deletes them together behind a single hard confirmation. This is destructive — it permanently removes the match row and, if the match was already played via live scoring, its full leg/throw history too. This works regardless of a match's current status (scheduled, played, in_progress, or cancelled).

Both capabilities are scoped to admin only, matching every other schedule-management action in this app.

## Section 1: Data Model — the "Additional Matches" concept

No schema changes. A manually-added match is a normal `Match` row, but created with `roundNumber: 0` — a reserved sentinel value meaning "not part of a generated round-robin round" (real rounds are numbered 1 and up by `generateRoundRobin`/`computeRoundCount`).

`src/pages/season/RoundRobinSchedule.tsx` currently groups all matches by `roundNumber` and, for each round, computes a "bye" list (every season participant not appearing in that round's matches) — this assumes every round is a full round-robin round where everyone either plays or has a bye. A manually-added single match reusing that grouping would make every other participant wrongly show up as "bye" for that ad-hoc round.

To avoid touching that existing, working logic at all, `RoundRobinSchedule` splits its input: matches with `roundNumber > 0` render exactly as they do today (round headers, bye computation, untouched). Matches with `roundNumber === 0` render in a separate "Additional Matches" section below all the round blocks — a flat list, no round header, no bye computation. This section is omitted entirely if there are no such matches.

## Section 2: Backend

**`POST /api/seasons/{id}/matches`** (new file `api/src/functions/seasons/addMatch.ts`)
- `requireAuth(request, "admin")`.
- Body: `{ date: string; player1Id: number; player2Id: number }`.
- Validates: the season exists (404 if not) and has `status === "active"` (400 "Cannot modify a match in an archived season" — the exact same guard and message `update.ts` already uses, for consistency); `date` parses as a valid date; `player1Id !== player2Id`; both `player1Id` and `player2Id` are current participants of *this* season (queried via `SeasonParticipant`, not just "any active member" — a playing-day match must be between two players actually enrolled in this season).
- No duplicate-pairing check: the same two players can be added again (e.g. a genuine rematch or makeup game) — this mirrors the flexible, manual nature of this action.
- Creates a `Match` with `roundNumber: 0`, `status: "scheduled"`, the given `date`/`player1Id`/`player2Id`, `seasonId` from the route.
- Returns `201` with the created match in the same shape `GET /api/seasons/{id}` already uses for a match entry (`id`, `roundNumber`, `date`, `status`, `player1`, `player2`, `player1Legs`, `player2Legs`, `player1Checkout`, `player2Checkout`, `resultEnteredBy`, `resultEnteredAt` — all null/default for a freshly-created match except `roundNumber: 0`).

**`DELETE /api/matches/{id}`** (new file `api/src/functions/matches/delete.ts`)
- `requireAuth(request, "admin")`.
- Validates: the match exists (404 if not); its season has `status === "active"` (same 400 guard as above).
- Works regardless of the match's current `status` (scheduled, played, in_progress, or cancelled) — a played match's results and full throw history are just as deletable as an unplayed one, since this is the explicit point of the feature.
- Since `Leg`/`Throw` have no cascading delete configured in the schema, deletion runs inside a `prisma.$transaction`, in dependency order: delete every `Throw` row belonging to any `Leg` of this match, then delete those `Leg` rows, then delete the `Match` row itself. (A `scheduled` match with no legs simply has nothing to delete in the first two steps — the transaction is a no-op for those and proceeds straight to deleting the `Match` row.)
- Returns `200` with `{ success: true }`.

## Section 3: Frontend

`src/lib/api-client.ts` gets two additions, following the existing `getSeason`/`updateMatch` conventions:
- `addMatch(seasonId: number, input: { date: string; player1Id: number; player2Id: number }): Promise<SeasonMatch>` — `POST /api/seasons/${seasonId}/matches`.
- `deleteMatch(matchId: number): Promise<void>` — `DELETE /api/matches/${matchId}`.

**`Season.tsx`** (active season page only — `SeasonDetail.tsx`/archived seasons get no new controls, matching every other admin action already being read-only there):

- A new admin-only inline form above the schedule: a date input and two `<select>` elements populated from `season.participants` (labelled "Player 1"/"Player 2"), plus an "Add Match" button. On submit, calls `addMatch(season.id, { date, player1Id, player2Id })`, then `void load()` — the same reload-after-mutation pattern every other action on this page already follows (archive, reschedule, cancel).
- A new admin-only checkbox per match, rendered via the existing `renderMatchActions` render-prop path (passed to `RoundRobinSchedule`, which now also renders it for the "Additional Matches" section) so both regular and manually-added matches get the same selection control.
- New local state: `const [selectedMatchIds, setSelectedMatchIds] = useState<Set<number>>(new Set())`, toggled by each checkbox.
- A "Delete Selected (N)" button, admin-only, disabled when `selectedMatchIds` is empty. Clicking it builds one `confirm()` message covering every selected match: it names how many matches are selected, and if any of them have `status === "played"`, it explicitly warns that their recorded results and full throw history will be permanently lost. On confirm, calls `deleteMatch` once per selected id via `Promise.all`, clears the selection, then `void load()`. If the user cancels the `confirm()`, nothing happens.
- No new pathway for deleting a single match outside this select-then-delete flow — selecting exactly one match and clicking "Delete Selected" is how a single match gets deleted too.

## Section 4: Error Handling & Testing

**Error handling:** both new endpoints reuse the exact response shape `update.ts`/`get.ts` already establish — `401` via `AuthError`, `400` for invalid input or the archived-season guard, `404` for a missing season/match, `500` with a logged error otherwise. On the frontend, if any call inside the `Promise.all` batch of deletes rejects, it surfaces through the same page-level `error` state every other mutation on `Season.tsx` already uses — no partial-failure UI, consistent with this project's existing error-handling bar for admin actions.

**Testing:**
- `api/test/functions/seasons/addMatch.test.ts`: 401 unauthenticated, 403 non-admin, 400 for an invalid date/same-player-twice/a player not in this season's roster, 400 for an archived season, 404 for an unknown season, 201 with `roundNumber: 0` on success.
- `api/test/functions/matches/delete.test.ts`: 401/403, 400 archived-season guard, 404 unknown match, successful deletion of a `scheduled` match with no legs (mocked `throw.deleteMany`/`leg.deleteMany` called but affecting zero rows), successful deletion of a `played` match with legs/throws (verifying the three deletes happen in the correct dependency order inside one transaction), 200 `{ success: true }` response shape.
- `src/pages/season/RoundRobinSchedule.test.tsx`: new cases for `roundNumber === 0` matches rendering under an "Additional Matches" section with no round header and no bye computation, while `roundNumber > 0` matches are entirely unaffected; the section is omitted when there are no `roundNumber === 0` matches.
- `src/pages/season/Season.test.tsx`: new tests for the add-match form (admin-only visibility, correct payload on submit, reload on success), and the select-then-delete-selected flow (checkboxes admin-only, `confirm()` wording differs when a selected match is `"played"` vs not, `deleteMatch` called once per selected id, selection cleared and page reloaded after confirmation, nothing happens if `confirm()` is cancelled).
