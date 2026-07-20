# Season & Schedule Management — Design

Status: approved design, ready for implementation planning.
Source: brainstorming session following Member Management (PR #4, merged). Implements the "Competition management" and "Match management" slices of Section 3.9 (Admin Panel), plus Sections 3.2 (Competition Structure) and 3.10 (Archive), from `docs/superpowers/specs/2026-07-15-darts-league-app-design.md` — create a season, generate its round-robin schedule, adjust/cancel matches, and browse past seasons.

## 1. Overview

Gives the admin a way to start a season (choosing round type and the participating roster), automatically generates the full round-robin schedule from that roster, and lets the admin reschedule or cancel individual matches afterward. All logged-in users (admin and player) can view the active season's schedule and browse archived seasons.

**Out of scope, deliberately deferred to later phases:** match *result* entry (admin/self-report), live throw-by-throw scoring, standings/tie-break calculation, statistics and awards, and "free match mode" (GitHub issue #6 — ad-hoc matches outside any season, tracked separately). This phase only produces the schedule skeleton those phases will build on. `Match` will gain result-related columns later via an additive migration.

## 2. Data Model

Two new Prisma models; no changes to `User`.

```prisma
model Season {
  id           Int      @id @default(autoincrement())
  name         String
  roundType    String   // "single" | "double"
  status       String   @default("active") // "active" | "archived"
  createdAt    DateTime @default(now())
  matches      Match[]
  participants SeasonParticipant[]
}

model SeasonParticipant {
  id       Int    @id @default(autoincrement())
  seasonId Int
  userId   Int
  season   Season @relation(fields: [seasonId], references: [id])
  user     User   @relation(fields: [userId], references: [id])
  @@unique([seasonId, userId])
}

model Match {
  id          Int      @id @default(autoincrement())
  seasonId    Int
  roundNumber Int
  date        DateTime
  player1Id   Int
  player2Id   Int
  status      String   @default("scheduled") // "scheduled" | "cancelled"
  createdAt   DateTime @default(now())
  season      Season @relation(fields: [seasonId], references: [id])
  player1     User   @relation("Player1Matches", fields: [player1Id], references: [id])
  player2     User   @relation("Player2Matches", fields: [player2Id], references: [id])
}
```

- **No separate `Round` entity.** A round is just a `roundNumber` shared by a group of matches plus each match's own `date`. Rescheduling one match only changes that match's `date`, independent of the round's original date — this is also how "additional playing days can be added during the season" (spec 3.2) is satisfied, without a dedicated "add a playing day" feature: reschedule accepts any arbitrary date.
- **Byes aren't stored.** For an odd-sized roster, the round-robin generator simply produces one fewer match that round. The frontend derives "X has a bye this round" by diffing the round's participants against the players who appear in that round's matches — no `Bye` row needed.
- **Roster is locked at creation.** `SeasonParticipant` rows are written once, during `POST /api/seasons`, and never modified afterward. A late-joining player waits for the next season.
- **Exactly one active season at a time**, enforced by `POST /api/seasons` rejecting creation while another `Season` has `status: "active"`.

## 3. Round-Robin Algorithm

Standard circle method. Given the selected roster:

1. If the roster size is odd, add a placeholder "bye" slot to make it even. Let `N` be this (possibly adjusted) count.
2. Fix one participant in position 0; rotate all others around it, one position per round, for `N - 1` rounds. Each round pairs up all `N` positions; a pairing involving the bye slot produces no `Match` row for the participant paired against it that round.
3. **Single round:** the `N - 1` rounds above, as-is.
4. **Double round:** the same `N - 1` pairings repeated a second time as rounds `N` through `2(N-1)`, with fresh round numbers and dates. There's no home/away distinction (single venue), so the second half is a literal repeat of the first half's pairings.

Round count is a pure function of roster size and round type (`N-1` for single, `2(N-1)` for double, where `N` is the even-adjusted roster size), computable client-side the moment the admin has picked participants and round type — no server round-trip needed just to know how many date inputs to render. The server independently re-derives the same count during creation and validates the submitted date list matches it.

## 4. Backend API

New module `api/src/functions/seasons/` (plus a `matches` handler), following the same structure as `api/src/functions/users/`. Read endpoints call `requireAuth(request)` (any authenticated role); mutating endpoints call `requireAuth(request, "admin")`.

### `POST /api/seasons` *(admin)*
Creates a season and its full schedule in one transaction.

Request: `{ name, roundType, participantIds: number[], roundDates: string[] }`
- `name`: required non-empty string, trimmed.
- `roundType`: must be `"single"` or `"double"`.
- `participantIds`: at least 2 distinct, existing, active user ids.
- `roundDates`: length must equal the server-computed round count for this roster size and round type (Section 3); each must be a valid date.
- Rejects with `409` if a `Season` with `status: "active"` already exists.

On success: creates `Season`, one `SeasonParticipant` per id, and generates all `Match` rows via the circle-method algorithm, assigning each round's matches its corresponding `roundDates` entry.

Responses:
- `201 { season: { id, name, roundType, status, participants, matches } }`.
- `400 { error: string }` for invalid/missing fields, an unknown or inactive participant id, or a `roundDates` length mismatch.
- `409 { error: "A season is already active" }`.

### `GET /api/seasons`
Lists all seasons for the archive view.

```
200 { seasons: Array<{ id, name, roundType, status, createdAt }> }
```

### `GET /api/seasons/{id}`
One season's full detail.

```
200 { season: { id, name, roundType, status, participants: Array<{ id, displayName }>, matches: Array<{ id, roundNumber, date, status, player1: { id, displayName }, player2: { id, displayName } }> } }
```
`404` if `id` doesn't exist.

### `PATCH /api/seasons/{id}` *(admin)*
Archives a season.

Request: `{ status: "archived" }` — the only supported transition (`active` → `archived`); any other value or transitioning an already-archived season is `400`.

Responses: `200 { season: {...} }`, `400 { error }`, `404 { error: "Season not found" }`.

### `PATCH /api/matches/{id}` *(admin)*
Reschedules or cancels/restores a single match.

Request: `{ date?, status? }` — at least one field, both optional.
- `date`, if present, must be a valid date (no restriction to the season's other round dates).
- `status`, if present, must be `"scheduled"` or `"cancelled"`.
- Rejects (`400`) if the match's season is not `active` — archived-season matches are frozen.

Responses: `200 { match: {...} }`, `400 { error }`, `404 { error: "Match not found" }`.

## 5. Frontend

### API client
`src/lib/api-client.ts` gains, following the existing request/response/error pattern:
- `createSeason(data): Promise<Season>`
- `listSeasons(): Promise<SeasonSummary[]>`
- `getSeason(id): Promise<Season>`
- `archiveSeason(id): Promise<Season>`
- `updateMatch(id, data): Promise<Match>`

Plus `Season`, `SeasonSummary`, `Match` types matching the backend shapes above, and a pure `computeRoundCount(participantCount, roundType)` helper (mirrors the server's round-count derivation) used by the season-creation page to render the right number of date inputs.

### Routes & pages

| Route | Component | Access | Purpose |
|---|---|---|---|
| `/season` | `Season.tsx` | any logged-in user | The active season's schedule, matches grouped by round with dates, opponents, and bye indicators. Read-only for players. When `user.role === "admin"`: inline "Reschedule"/"Cancel" per match, plus an "Archive Season" button. If no active season exists: players see an empty-state message, admins see a "Create Season" call-to-action. |
| `/season/new` | `NewSeason.tsx` | admin (`AdminRoute`) | Round-type picker, then a checklist of active members for the roster. Once both are set, the page computes the round count client-side and renders that many date inputs. Submits everything in one `POST /api/seasons` call. |
| `/seasons` | `SeasonArchive.tsx` | any logged-in user | List of archived seasons; each links to its detail. |
| `/seasons/:id` | `SeasonDetail.tsx` | any logged-in user | Read-only rendering of one archived season's final schedule (same layout as `/season`, no admin controls — archived matches are frozen). |

`App.tsx` gains these four routes: `/season` and `/seasons`/`/seasons/:id` nested under `ProtectedRoute` (any logged-in user), `/season/new` nested under `AdminRoute`.

### Navigation entry point
`Home.tsx` gains a "Season" link visible to **every** logged-in user (unlike "Manage Members", which is admin-only), pointing at `/season`.

## 6. Error Handling & Edge Cases

- **No active season:** `/season` renders an empty state rather than erroring; the CTA shown depends on role (admin gets "Create Season", player gets an informational message).
- **Attempting to create a season while one is active:** the `409` is surfaced inline on `/season/new` via a `role="alert"` element, same pattern as existing forms.
- **Odd roster:** handled purely by the round-robin generator producing fewer matches that round; no special-casing needed in the UI beyond the bye-diffing display logic.
- **Rescheduling/cancelling on an archived season:** blocked server-side (`400`); the UI never renders those controls for archived seasons in the first place, since `/seasons/:id` doesn't include them.
- **Participant becomes inactive mid-season:** no special handling — the roster is locked at creation (Section 2), and an inactive member's existing scheduled matches remain as-is; deciding what to do about them is left to the admin (reschedule/cancel manually), consistent with the spec's deferred "forfeit/unplayed match" handling (notes.md 3.6, Open Question 3).

## 7. Testing

Same TDD pattern established in Auth and Member Management:
- Each backend endpoint: a Vitest suite mocking `prisma`/`requireAuth`, covering validation, auth, and the documented status codes — including dedicated cases for the round-robin generator (even roster, odd roster with a bye, single vs. double round produce the expected round/match counts and pairings).
- Each frontend piece (`Season`, `NewSeason`, `SeasonArchive`, `SeasonDetail`, and the `computeRoundCount` helper): an RTL/unit suite mocking `api-client`/`AuthContext`.
- A manual end-to-end verification task closes out the implementation plan: admin creates a season with an odd-sized roster, confirms the schedule and bye display, reschedules and cancels a match, archives the season, confirms `/season` shows the empty state afterward and `/seasons/:id` shows the frozen archived schedule, and confirms a player sees the same schedule read-only with no admin controls.
