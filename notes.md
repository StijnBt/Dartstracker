# Darts League Management App — Technical & Functional Specification

Status: draft, result of a scoping conversation with the product owner (Stijn). Intended as input for further technical analysis and implementation (e.g. by a Claude Code agent). Items under "Open Questions" are explicitly unresolved and need a decision before or during implementation.

## 1. Project Overview

A small web application to manage a recreational darts league. Must run smoothly as a mobile web app on both Android and iOS browsers. Hosted on the owner's personal Azure tenant. Hard constraint: hosting cost must be minimized. Expected load: max ~30 users total.

## 2. Technology Stack

### 2.1 Frontend
- React (Vite build tooling)
- Tailwind CSS for styling
- Built and served as a PWA (installable, app-like experience on mobile). Note: PWA "offline" capability is not required for the live-scoring feature — see Non-Functional Requirements.
- Rationale for choosing React/Vite over Blazor WebAssembly: smaller initial bundle → faster first load on mobile networks, and a more mature PWA/mobile UI ecosystem. Trade-off accepted: no shared C# models between frontend and backend.

### 2.2 Backend / API
- Azure Functions, Consumption (serverless) plan
- Deployed as the integrated API of the Azure Static Web App (`/api` folder convention)

### 2.3 Database
- Azure SQL Database, Serverless compute tier with auto-pause (min. 15 min idle delay)
- Rationale over Cosmos DB: the domain (players, teams, matches, legs, standings) is inherently relational, requires joins and aggregate queries (standings, tie-breaks). SQL keeps this simple (native `JOIN`/`GROUP BY`); Cosmos DB would require denormalization and application-side aggregation for no benefit at this scale. Cost difference (Cosmos free tier vs. SQL serverless ~€1–5/month) was judged not decisive.

### 2.4 Hosting
- Azure Static Web Apps, Free tier (includes SSL, custom domain, CI/CD via GitHub Actions, 1M free Azure Functions executions)
- Expected total hosting cost at this scale: roughly €0–5/month.

### 2.5 Authentication
- Decision: **no self-registration**. The administrator creates every user account and sets/resets passwords manually. There is no email-based "forgot password" flow — all password management goes through the admin.
- **Open technical question (flagged, not yet resolved):** Azure Static Web Apps' built-in authentication is provider-based (Entra ID, GitHub, custom OIDC, etc.) and does not natively support admin-managed username/password accounts. This requirement likely needs a custom auth implementation (e.g. a `Users` table with securely hashed passwords, a custom login API in Azure Functions, and a custom login page), rather than relying on SWA's built-in identity providers. This needs to be decided during technical design.

### 2.6 Local Development
- Frontend: `npm run dev` (Vite dev server), hot reload, no Azure dependency.
- API: Azure Functions Core Tools, run fully offline.
- Combined local environment: Azure Static Web Apps CLI (`swa start`), which proxies the Vite dev server and the Functions runtime together at `http://localhost:4280`, including a local emulator for authentication (fake login/claims screen).
- Database: local SQL Server via Docker (`mcr.microsoft.com/mssql/server` image) or SQL Server LocalDB; same engine/T-SQL as Azure SQL. Connection string is swapped to point to the real Azure SQL instance for staging/production.

### 2.7 IDE & Tooling
- IDE: Visual Studio Code
- Recommended extensions:
  - Azure Tools (bundles Azure Functions + Azure Static Web Apps extensions)
  - SQL Server (mssql)
  - ESLint, Prettier
  - Tailwind CSS IntelliSense
  - ES7+ React/Redux/React-Native snippets (optional)
  - Thunder Client or REST Client (API testing)
  - GitLens, Docker
- Recommended Claude Code tooling for building this project:
  - Azure plugin (official Anthropic marketplace) — bundles the Azure MCP Server with Azure-related agents/skills, for managing/inspecting Azure resources directly from the coding agent.
  - GitHub MCP server (official) — repo, PR, and GitHub Actions workflow management.
  - Playwright MCP (Microsoft) — mobile viewport emulation to verify the mobile UI/UX programmatically.
  - Context7 — up-to-date library documentation (React, Vite, Azure Functions, EF Core) to avoid outdated/hallucinated APIs.
  - Skills: `init` (generate a CLAUDE.md with project conventions), `security-review` (recommended given the custom password-based auth), `review` (PR/diff review).
  - Suggested: a custom subagent aware of this project's domain rules (best-of-5 legs, standings algorithm, double-out validation) to catch subtle domain-logic regressions that a generic coding agent might miss.

## 3. Functional Requirements

### 3.1 Actors & Roles
- **Administrator**: full management — members, competitions/seasons, match schedule, results (correction rights), statistics.
- **Player**: has an account (created by admin, no self-service signup), can view own matches/schedule, enter own match results, use live scoring during a match, and view own statistics and the standings. No public/guest access without login.

### 3.2 Competition Structure
- Ongoing league format (not a knockout tournament).
- Round-robin schedule generator.
- Single round ("everyone plays everyone once") or double round ("home/away", everyone plays everyone twice) — configurable per season at season creation.
- Playing days/dates for the whole season are set up front in bulk at season start, but:
  - individual matches can be cancelled or rescheduled to an earlier or later date,
  - additional playing days can be added during the season.
- Past seasons and their standings must remain accessible after a new season starts (archive).

### 3.3 Match Format & Rules
- Game: 501, double-out.
- A match is won by the first player to win 3 legs (best of 5). This is a fixed rule, not configurable per season.

### 3.4 Result Entry
Three input channels, all writing to the same match/result data:
1. **Admin entry**: administrator enters the result directly; always authoritative.
2. **Self-reported by player**: a player enters the final result of a match they played in. This is **immediately final** — no confirmation required from the opponent or the admin. If both players (or a live-scoring session and a manual entry) submit conflicting results for the same match, **the last entry submitted wins**. A change/audit log is recommended so the admin can see what was overwritten and when (recommended by the assistant; not yet explicitly confirmed by the product owner — treat as a should-have, not a hard requirement).
3. **Live scoreboard**: throw-by-throw entry during the match (see 3.5). On completion, this automatically becomes the definitive result.

### 3.5 Live Scoring
- Granularity: full throw-by-throw detail — every individual dart thrown is recorded (as it would land on the board), not just the leg/match outcome.
- Input pattern: **do not** render a tappable dartboard graphic (too many small hit targets — ~62 zones — for reliable use on a phone screen during an actual match). Instead use the pattern common in existing darts-scoring apps: select a multiplier (single/double/triple) then a number (1–20 or bull); 3 taps per turn.
- The full throw history is stored (not just the aggregated result). This enables future statistics (three-dart average, checkout percentage, count of 180s, etc.) without additional data-entry work later.
- Highest checkout per player per match is captured as part of this flow (see 3.8); for non-live entry channels (admin/self-report) it must be entered manually since no throw detail exists there.
- Assumption: the venue always has Wi-Fi available, so **no offline mode is required** for live scoring.

### 3.6 Forfeits / Unplayed Matches
- No automatic scoring rule. A match that isn't played simply stays in an "unplayed" state. What happens to such matches (forfeit score, rescheduling, exclusion from standings, etc.) is explicitly deferred — to be decided later, case by case, by the administrator.

### 3.7 Standings / Ranking
- Primary sort key: total number of legs won across the whole season (descending).
- Tie-break: leg differential (legs won − legs lost).
- No separate win/loss points system is used.

### 3.8 Statistics & Awards
- Per match, the highest checkout of each player is recorded.
- Season award: "Highest Checkout" — the player with the single highest recorded checkout across the whole season. Ties are allowed and result in a shared award (no further tie-break needed).
- Because full throw history is stored (3.5), the data model should support deriving further statistics later (three-dart average, checkout %, number of 180s) without additional entry work.

### 3.9 Admin Panel
A dedicated administration section, accessible only to the administrator:
- **Member management**: add/edit/remove players, create/reset passwords.
- **Competition management**: create a season, set round type (single/double), close/archive a season.
- **Match management**: generate/adjust the schedule, correct results, move/cancel matches.

### 3.10 Archive
- Previous seasons, including their final standings, remain stored and browsable after a new season has started.

## 4. Non-Functional Requirements
- Mobile-first, responsive PWA; must work smoothly in the Android and iOS mobile browsers.
- Maximum ~30 concurrent/total users.
- Hosted on the owner's own Azure tenant; hosting cost must be minimized (target: near-zero, a few euros/month at most).
- Reliable Wi-Fi at the venue is assumed; no offline-first requirement.

## 5. Open Questions / Items for Further Analysis
1. **Authentication mechanism**: how to implement admin-managed username/password accounts given that Azure Static Web Apps' built-in auth is provider/OAuth-based (see 2.5). Needs a concrete technical decision (custom auth vs. workaround).
2. **Change/audit log** for result entries: recommended but not yet explicitly confirmed as a requirement by the product owner.
3. **Forfeit/unplayed match handling**: explicitly deferred by the product owner; needs a decision before standings logic can fully account for uneven match counts across players.
4. **Exact number-of-legs-per-turn UI details** (e.g. bust handling, checkout validation on doubles) are implied by the game rules (501, double-out) but not yet spelled out step by step — needs detailing during UI/interaction design of the live scoreboard.
5. **Notifications** (e.g. reminders for upcoming/overdue matches) were raised as a possible nice-to-have but never confirmed as in-scope.