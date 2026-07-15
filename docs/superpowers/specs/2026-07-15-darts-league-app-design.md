# Darts League Management App — Design

Status: approved design, ready for implementation planning.
Source: scoping conversation with product owner (Stijn), captured in `notes.md`, refined through a follow-up brainstorming session that resolved all previously open questions.

## 1. Overview

A small web application to manage a recreational darts league: schedule, results, live scoring, standings, and statistics. Must run smoothly as a mobile web app on Android and iOS browsers. Hosted on the owner's personal Azure tenant, with hosting cost minimized. Expected load: max ~30 users total, no scaling concerns.

## 2. Technology Stack

| Layer | Choice |
|---|---|
| Frontend | React (Vite), Tailwind CSS, built and served as an installable PWA |
| Backend | Azure Functions, **Node.js / TypeScript**, Consumption plan, deployed as the `/api` of an Azure Static Web App |
| Data access | **Prisma ORM** against Azure SQL Database |
| Database | Azure SQL Database, Serverless compute tier, auto-pause after 15 min idle |
| Hosting | Azure Static Web Apps, Free tier (SSL, custom domain, GitHub Actions CI/CD, 1M free Functions executions) |
| Auth | Custom JWT-based auth (see Section 5) — **not** SWA's built-in provider-based identity |

Expected hosting cost: roughly €0–5/month.

**Rationale for React/Vite over Blazor WebAssembly:** smaller initial bundle → faster first load on mobile networks, more mature PWA/mobile UI ecosystem. Trade-off accepted: no shared C# models between frontend and backend — partially recovered by choosing a TypeScript backend, so frontend and backend can share TypeScript types generated from the Prisma schema.

**Rationale for Node/TypeScript over C#/.NET backend:** matches the all-JS/TS tooling already assumed (ESLint, Prettier, no C# extension in the toolchain) and enables the shared-types benefit above.

**Rationale for Prisma over a raw SQL driver or query builder:** type-safe queries and built-in migrations, worth the small cold-start overhead at this scale, and reduces hand-written SQL for the relational joins this domain needs (standings, tie-breaks).

**Rationale for Azure SQL over Cosmos DB:** the domain (players, teams, matches, legs, standings) is inherently relational and needs joins/aggregate queries. SQL keeps this simple with native `JOIN`/`GROUP BY`; Cosmos DB would require denormalization and application-side aggregation for no benefit at this scale. Cost difference (Cosmos free tier vs. SQL serverless ~€1–5/month) was judged not decisive.

## 3. Architecture

Single Azure Static Web App hosting the built React PWA as static content, with an integrated Azure Functions API (`/api` folder convention, Node/TypeScript runtime). Azure SQL Database (Serverless) is the sole data store. No additional services (no separate cache, queue, or notification infrastructure in v1).

Standings and statistics are **computed on read** via SQL aggregation queries — not stored as denormalized tables — since the dataset is tiny (≤30 players, a few hundred matches per season). This keeps the data always correct with no sync/consistency logic.

## 4. Data Model

| Entity | Purpose | Key fields |
|---|---|---|
| `User` | Login + player identity (admin is also a `User`, `role=admin`) | id, username, passwordHash, role, displayName, isActive |
| `Season` | One league season | id, name, roundType (single/double), status (active/archived), startDate |
| `SeasonParticipant` | Join table: which users play in a given season | seasonId, userId |
| `Match` | One scheduled fixture | id, seasonId, homePlayerId, awayPlayerId, scheduledDate, status (scheduled/played/cancelled), resultSource (admin/self-report/live), homeLegsWon, awayLegsWon, highestCheckoutHome, highestCheckoutAway |
| `Leg` | One leg within a match | id, matchId, legNumber, winnerId, startingPlayerId |
| `Throw` | One dart; populated only for live-scored legs | id, legId, playerId, turnNumber, throwNumber (1–3), multiplier, segmentValue, scoreAfter, isBust |
| `AuditLog` | Tracks result overwrites | id, matchId, changedBy, oldValue (json), newValue (json), changedAt, source |

A `Match` is complete as soon as either player's `legsWon` (derived from `Leg` records) reaches 3 — best-of-5 is a fixed rule, not a configurable field.

## 5. Authentication

- No self-registration. Administrator creates every account and sets/resets passwords directly; no email-based flow anywhere.
- `User.passwordHash` stored via argon2.
- `POST /api/auth/login` (username + password) validates credentials and issues a signed JWT (claims: `userId`, `role`), stored in an httpOnly cookie. Given the low-stakes, small-user-count nature of this app, a single reasonably-long-lived token is used — no refresh-token machinery.
- Every other Function validates the JWT itself via a shared `requireAuth(role?)` middleware. SWA's built-in `x-ms-client-principal` mechanism is unused entirely, since SWA's identity providers are OAuth/OIDC-based and don't support admin-managed username/password accounts natively.

## 6. Functional Requirements

### 6.1 Actors & Roles
- **Administrator**: full management — members, competitions/seasons, match schedule, results (correction rights), statistics.
- **Player**: views own matches/schedule, enters own match results, uses live scoring, views own statistics and standings. No access without login.

### 6.2 Competition Structure
- Ongoing league format (not knockout). Round-robin schedule generator.
- Single round (everyone plays everyone once) or double round (home/away, everyone plays everyone twice), configurable per season at creation.
- Playing days for the whole season are set up front in bulk, but individual matches can be cancelled/rescheduled, and additional playing days can be added mid-season.
- Past seasons and their standings remain accessible after a new season starts (archive, Section 6.7).

### 6.3 Match Format & Rules
- Game: 501, double-out. First to 3 legs wins the match (best of 5), fixed rule, not configurable per season.

### 6.4 Result Entry
Three input channels, all writing to the same `Match` record, distinguished by `resultSource`:
1. **Admin entry** — always authoritative, always allowed to overwrite.
2. **Self-report** — either participant enters the final result of their own match; immediately final, no confirmation required. If multiple entries conflict, the **last write wins**.
3. **Live scoreboard** (Section 6.5) — throw-by-throw entry; on completion, automatically becomes the definitive result.

All overwrites are recorded in `AuditLog` (old value, new value, who, when, source) so the admin can see what was overwritten.

### 6.5 Live Scoring
- Full throw-by-throw detail: every dart is recorded as it would land on the board.
- Input pattern: no tappable dartboard graphic (too many small hit targets for a phone screen mid-match). Select multiplier (single/double/triple) then number (1–20 or bull) — 3 taps per turn.
- Each tap is sent to the server immediately; the server is the source of truth, so a page reload mid-match resumes from stored state. No offline mode needed (venue Wi-Fi assumed reliable).
- **Full rule enforcement**: the server-side scoring engine detects bust (score would go below 0, to exactly 1, or to 0 without the final dart being a double) and reverts the turn without persisting it as a leg-ending event; requires a double to finish a leg; auto-detects leg completion and increments `Leg`/`Match` state; auto-detects match completion at 3 legs won for either player.
- On the throw that finishes a leg, the visit's total is compared to the player's running highest checkout for the match and stored on `Match.highestCheckoutHome/Away` if it's a new high.
- The frontend includes a client-side mirror of the bust/double-out logic for optimistic UI feedback only — the server-side engine in the `scoring` module remains authoritative.
- For admin/self-report channels (no throw data), `highestCheckoutHome/Away` are optional manually-entered fields instead.

### 6.6 Forfeits / Unplayed Matches
- No special data modeling. A match that isn't played simply stays in `status=scheduled` and is excluded from standings aggregation. If the admin later rules a forfeit, they enter a synthetic result (e.g. 3–0) through the normal admin result-entry path — no new match status or scoring rule needed.

### 6.7 Standings / Ranking
- Standings query: `SUM(legsWon)` per player across a season's `status=played` matches, descending.
- Tie-break: leg differential (`legsWon − legsLost`). No separate win/loss points system.

### 6.8 Statistics & Awards
- Per match, the highest checkout of each player is recorded (auto-computed for live-scored matches, manually entered otherwise).
- Season award "Highest Checkout": the player(s) with the single highest recorded checkout across the season; ties share the award.
- Because full throw history is retained, further statistics (three-dart average, checkout %, count of 180s) can be added later as pure read-queries with no schema change.

### 6.9 Admin Panel
Route group gated by `role=admin` in the JWT:
- **Member management**: add/edit/remove players, create/reset passwords.
- **Competition management**: create a season, set round type, close/archive a season.
- **Match management**: generate/adjust the schedule, correct results, move/cancel matches.

### 6.10 Archive
- Seasons are never deleted, just flip to `status=archived`. The same standings/stats queries run against archived seasons; the archive view is the season view scoped to an older `seasonId`, with no "current"-only affordances (e.g. no live scoring entry point).

## 7. Module Boundaries

**Backend (`/api`)** — one folder per domain area:
- `auth/` — login, JWT issuance, `requireAuth` middleware shared by all other modules
- `users/` — admin-only: create/edit/deactivate player, reset password
- `seasons/` — create season, generate round-robin schedule, add/reschedule/cancel playing days, close/archive
- `matches/` — list schedule, admin result correction, player self-report result
- `scoring/` — live scoring session: record throw, undo last throw, the bust/double-out rule engine, leg/match completion
- `stats/` — standings, highest-checkout leaderboard, archived-season browsing (reused by both current and archive views)

**Frontend** — mirrors the backend:
- `pages/auth/Login`
- `pages/player/{Schedule, MyMatches, EnterResult, LiveScoring, Stats, Standings}`
- `pages/admin/{Members, Seasons, Matches}`
- `pages/archive/{SeasonList, SeasonDetail}`
- Shared `lib/api-client` (typed via shared TS types from the Prisma schema) and `lib/scoring-engine` (client-side mirror of live-scoring validation, for optimistic UI only)

## 8. Non-Functional Requirements

- Mobile-first, responsive PWA; must work smoothly in Android and iOS mobile browsers. Verified with Playwright MCP mobile-viewport emulation during development.
- Maximum ~30 concurrent/total users — no caching or scaling concerns.
- Hosted on the owner's Azure tenant; cost minimized (target: near-zero, a few euros/month at most).
- No offline-first requirement; reliable venue Wi-Fi is assumed.
- Notifications (match reminders) are explicitly **out of scope for v1** — may be added later.

## 9. Local Development & Tooling

- Frontend: `npm run dev` (Vite dev server), hot reload, no Azure dependency.
- API: Azure Functions Core Tools, runs fully offline.
- Combined local environment: Azure Static Web Apps CLI (`swa start`), proxying Vite + the Functions runtime together at `http://localhost:4280`, including a local auth emulator.
- Database: local SQL Server via Docker (`mcr.microsoft.com/mssql/server`) or SQL Server LocalDB — same engine/T-SQL as Azure SQL; connection string swaps to the real Azure SQL instance for staging/production.
- IDE: VS Code, with Azure Tools, SQL Server (mssql), ESLint, Prettier, Tailwind CSS IntelliSense, GitLens, Docker.
- Claude Code tooling: Azure plugin (Azure MCP Server), GitHub MCP server, Playwright MCP (mobile viewport emulation), Context7 (up-to-date React/Vite/Azure Functions/Prisma docs). Skills: `init`, `security-review` (given custom password-based auth), `review`.

## 10. Testing Approach

- **Unit tests** for the scoring rule engine (bust detection, double-out validation, leg/match completion) — highest-risk logic for subtle bugs, and the easiest to isolate.
- **Integration tests** for the three result-entry channels writing to the same `Match` record (conflict / last-write-wins behavior) and the audit log.
- **Query tests** for standings/stats against seeded fixture data (known legs won/lost → expected ranking and tie-break order).

## 11. Decisions Log (previously open questions, now resolved)

| Question | Decision |
|---|---|
| Auth mechanism | Custom JWT auth; SWA built-in identity unused |
| Backend runtime | Node.js / TypeScript Azure Functions |
| Data access | Prisma ORM |
| Change/audit log | Included as a v1 requirement |
| Forfeit/unplayed match handling | No new state; excluded from standings, admin can enter a synthetic result later |
| Live-scoring rule enforcement | Full server-side enforcement (bust, double-out, auto leg/match completion) |
| Notifications | Deferred, out of scope for v1 |
