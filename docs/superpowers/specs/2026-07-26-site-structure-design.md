# Site Structure — Design

## Overview

GitHub issue #18: confirms Home is the announcements landing page (already true as of the Announcements phase), asks that the header/nav be visible on every page (today only `Home.tsx` has it — every other page is a bare `<div>` with its own local heading, and there is currently no way to reach `/seasons` (Season Archive) from anywhere in the app except by typing the URL), and asks that the combined active-season page (`Season.tsx`, showing standings, stats, and the full match schedule/admin controls together) be replaced by two separate pages — one for standings, one for matches.

This phase adds two new shared components (`NavBar`, `Layout`) used by every authenticated route, restructures routing accordingly, and splits `Season.tsx` into `SeasonStandings.tsx` and `SeasonMatches.tsx`. It does not touch the archived-season page (`SeasonDetail.tsx`, `/seasons/:id`), which stays one combined read-only page, nor the Login page, which stays outside the shared nav (unauthenticated, out of scope).

## Section 1: Shared Navigation

Two new components:

- **`src/components/NavBar.tsx`** — the header markup currently living in `Home.tsx` (logo, app name, links, user name, logout), extracted, with these changes: the single "Season" link is replaced by two links, **"Standings"** (`/season/standings`) and **"Matches"** (`/season/matches`); a new **"Season Archive"** link (`/seasons`) is added, closing the existing gap where that page has no nav entry point; "Manage Members" stays admin-only, unchanged. The logo/app-name becomes `<Link to="/">` — now that this header renders on every page, clicking it to return to the announcements feed is the standard convention.
- **`src/components/Layout.tsx`** — renders `<NavBar />` above `<Outlet />`. This is the new outermost route element wrapping every authenticated route (nested above both `ProtectedRoute` and `AdminRoute` in `src/App.tsx`), so every page gets the nav without needing its own copy. `Login` stays outside `Layout`.

`Home.tsx` shrinks to just `<AnnouncementFeed />` — the header is now `Layout`'s responsibility, not `Home`'s.

## Section 2: Routing

`src/App.tsx` restructures so `Layout` wraps everything except `/login`:

```tsx
<Routes>
  <Route path="/login" element={<Login />} />
  <Route element={<Layout />}>
    <Route element={<ProtectedRoute />}>
      <Route path="/" element={<Home />} />
      <Route path="/season" element={<Navigate to="/season/standings" replace />} />
      <Route path="/season/standings" element={<SeasonStandings />} />
      <Route path="/season/matches" element={<SeasonMatches />} />
      <Route path="/season/matches/:id/result" element={<MatchResult />} />
      <Route path="/season/matches/:id/live" element={<LiveScoring />} />
      <Route path="/seasons" element={<SeasonArchive />} />
      <Route path="/seasons/:id" element={<SeasonDetail />} />
    </Route>
    <Route element={<AdminRoute />}>
      <Route path="/admin/members" element={<Members />} />
      <Route path="/admin/members/new" element={<NewMember />} />
      <Route path="/admin/members/:id/edit" element={<EditMember />} />
      <Route path="/season/new" element={<NewSeason />} />
    </Route>
  </Route>
</Routes>
```

The old `/season` route (today's combined page) redirects to `/season/standings`, so existing bookmarks/links keep working.

Two existing internal `navigate("/season")` calls are updated to `navigate("/season/matches")` specifically — both represent "I just changed something about a match, take me back to the match list," not the standings view:
- `MatchResult.tsx` (currently line 64) — after submitting a result.
- `LiveScoring.tsx` (currently line 237) — the button shown after a match completes.

`SeasonDetail.tsx`/`SeasonArchive.tsx` routes are untouched.

## Section 3: Splitting `Season.tsx`

Both new files live in `src/pages/season/`, replacing `Season.tsx` (deleted, along with `Season.test.tsx`). Neither touches `RoundRobinSchedule.tsx`, `Standings.tsx`, `HighestCheckoutAward.tsx`, or `PlayerStats.tsx` — those stay as-is and get imported by whichever new page needs them, and none of their own tests change.

**`SeasonStandings.tsx`** — the read-only "how's the season going" view:
- Fetches the active season via `listSeasons` → `getSeason` + `getSeasonStats` (same pattern `Season.tsx` uses today).
- Renders: `<h1>{season.name}</h1>`, `HighestCheckoutAward`, `Standings`, `PlayerStats`.
- Empty state when there's no active season: "No active season." — no Create Season link here.

**`SeasonMatches.tsx`** — the "what's scheduled, manage it" view:
- Fetches the active season via `listSeasons` → `getSeason` only — no `getSeasonStats` call, since `PlayerStats` isn't rendered here (one fewer API call than today's combined page).
- Renders: `<h1>{season.name}</h1>` + admin-only **Archive Season** button (grouped here, alongside the other season-lifecycle/match-management admin actions, rather than on Standings), the admin add-match form, the admin select-and-delete-selected flow, and `RoundRobinSchedule` with the existing `renderMatchActions` (reschedule/cancel/Start-Live/Resume-Live/Enter-Result/Edit-Result links) — all unchanged logic, just relocated from `Season.tsx`.
- Empty state when there's no active season: "No active season." + admin-only "Create Season" link (`/season/new`).

## Section 4: Testing

- `src/components/NavBar.test.tsx` (new) — migrated from `Home.test.tsx`'s "Home navigation" describe block (admin-only "Manage Members" visibility, links present for every logged-in user), plus new cases for the "Standings"/"Matches"/"Season Archive" links and the logo linking to `/`.
- `src/components/Layout.test.tsx` (new) — renders `NavBar` above whatever's routed via `Outlet`, confirming both render together.
- `src/pages/Home.test.tsx` — shrinks to just the announcement-feed-for-a-logged-in-user cases; nav-specific tests move to `NavBar.test.tsx`.
- `src/pages/season/SeasonStandings.test.tsx` and `SeasonMatches.test.tsx` (new, replacing `Season.test.tsx`) — split along the same lines as the component split: standings/stats-rendering tests vs. schedule/admin-action tests, reusing today's existing fixtures.
- `src/App.test.tsx` — add a case for the `/season` → `/season/standings` redirect.

No changes needed to `RoundRobinSchedule.test.tsx`, `Standings.test.tsx`, `HighestCheckoutAward.test.tsx`, or `PlayerStats.test.tsx`.
