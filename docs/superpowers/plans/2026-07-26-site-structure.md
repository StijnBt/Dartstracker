# Site Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every authenticated page a shared nav bar (today only `Home.tsx` has one), and replace the combined active-season page (`Season.tsx`) with two separate pages — `SeasonStandings` and `SeasonMatches`.

**Architecture:** Two new components, `NavBar` (the header extracted from `Home.tsx`, with new Standings/Matches/Season Archive links) and `Layout` (renders `NavBar` above an `<Outlet />`), sit above every authenticated route in `src/App.tsx`. `Season.tsx` is deleted and split into `SeasonStandings.tsx` (read-only: highest checkout, standings, player stats) and `SeasonMatches.tsx` (schedule, all admin match/season controls) — a mechanical logic split with no new behavior beyond the split itself.

**Tech Stack:** No new dependencies. Same stack as prior phases (React, react-router-dom v7, Vitest, React Testing Library).

## Global Constraints

- `NavBar` is extracted from `Home.tsx`'s current header verbatim, with these changes: the single "Season" link becomes two links, **"Standings"** (`/season/standings`) and **"Matches"** (`/season/matches`); a new **"Season Archive"** link (`/seasons`) is added; "Manage Members" stays admin-only, unchanged; the logo + app-name become a single `<Link to="/">`.
- `Layout` renders `<NavBar />` above `<Outlet />` and sits above both `ProtectedRoute` and `AdminRoute` in the route tree. `/login` stays outside `Layout` entirely.
- The old `/season` route becomes `<Navigate to="/season/standings" replace />` — existing bookmarks keep working.
- Two existing `navigate("/season")` call sites become `navigate("/season/matches")`: `MatchResult.tsx` (after a result is submitted) and `LiveScoring.tsx` (the button shown once a match is complete, whose label also changes from "Back to Season" to "Back to Matches" to match its new destination).
- `Season.tsx` and `Season.test.tsx` are deleted. `SeasonStandings.tsx` gets the highest-checkout award, standings table, and player-stats table (no admin UI at all, does not use `useAuth`). `SeasonMatches.tsx` gets the season heading, admin-only Archive-Season button, admin-only add-match form, admin-only select-and-delete-selected flow, and `RoundRobinSchedule` with its existing `renderMatchActions` — it does not call `getSeasonStats`.
- `SeasonDetail.tsx` (`/seasons/:id`, archived seasons) and `SeasonArchive.tsx` (`/seasons`) are untouched by this plan.
- `Home.tsx` shrinks to rendering only `<AnnouncementFeed />` — no header, no `useAuth`, no `branding` import.

---

### Task 1: `NavBar` component

**Files:**
- Create: `src/components/NavBar.tsx`
- Test: `src/components/NavBar.test.tsx`

**Interfaces:**
- Produces: default export `NavBar` (no props — reads `useAuth()` itself). Task 2 (`Layout`) renders `<NavBar />`.

- [ ] **Step 1: Write the failing test — `src/components/NavBar.test.tsx`**

```typescript
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import NavBar from "./NavBar";
import { branding } from "../branding";
import { useAuth } from "../lib/AuthContext";

vi.mock("../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

describe("NavBar", () => {
  it("renders the branded app name using the theme's primary color and heading font", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    const heading = screen.getByRole("heading", { name: branding.appName });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass("text-primary");
    expect(heading).toHaveClass("font-heading");
  });

  it("renders the branded logo", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    const logo = screen.getByRole("img", { name: branding.appName });
    expect(logo).toHaveAttribute("src", branding.logoSrc);
  });

  it("links the logo/app name to the home page", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    const link = screen.getByRole("heading", { name: branding.appName }).closest("a");
    expect(link).toHaveAttribute("href", "/");
  });

  it("shows the logged-in user's display name and a logout button", () => {
    const logoutMock = vi.fn();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: logoutMock,
    });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("shows no nav links when logged out", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: "Standings" })).not.toBeInTheDocument();
  });
});

describe("NavBar navigation", () => {
  it("shows a Manage Members link for an admin", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Manage Members" })).toHaveAttribute("href", "/admin/members");
  });

  it("does not show a Manage Members link for a player", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: "Manage Members" })).not.toBeInTheDocument();
  });

  it("shows Standings, Matches, and Season Archive links for every logged-in user, admin or player", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <NavBar />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: "Standings" })).toHaveAttribute("href", "/season/standings");
    expect(screen.getByRole("link", { name: "Matches" })).toHaveAttribute("href", "/season/matches");
    expect(screen.getByRole("link", { name: "Season Archive" })).toHaveAttribute("href", "/seasons");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- NavBar
```
Expected: FAIL — `src/components/NavBar.tsx` doesn't exist yet.

- [ ] **Step 3: Write `src/components/NavBar.tsx`**

```typescript
import { Link } from "react-router-dom";
import { branding } from "../branding";
import { useAuth } from "../lib/AuthContext";

export default function NavBar() {
  const { user, logout } = useAuth();

  return (
    <div className="flex items-center gap-3 p-4">
      <Link to="/" className="flex items-center gap-3">
        <img src={branding.logoSrc} alt={branding.appName} width={40} height={40} />
        <h1 className="text-primary font-heading text-3xl font-bold">{branding.appName}</h1>
      </Link>
      {user && (
        <div className="ml-auto flex items-center gap-3">
          <Link to="/season/standings" className="text-primary underline">
            Standings
          </Link>
          <Link to="/season/matches" className="text-primary underline">
            Matches
          </Link>
          <Link to="/seasons" className="text-primary underline">
            Season Archive
          </Link>
          {user.role === "admin" && (
            <Link to="/admin/members" className="text-primary underline">
              Manage Members
            </Link>
          )}
          <span>{user.displayName}</span>
          <button onClick={() => void logout()} className="text-primary underline">
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- NavBar
```
Expected: PASS — all 8 tests pass.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc -b && vite build` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/NavBar.tsx src/components/NavBar.test.tsx
git commit -m "Add NavBar component"
```

---

### Task 2: `Layout` component

**Files:**
- Create: `src/components/Layout.tsx`
- Test: `src/components/Layout.test.tsx`

**Interfaces:**
- Consumes: `NavBar` from Task 1.
- Produces: default export `Layout` (no props — renders `<NavBar />` above `<Outlet />`). Task 6 (`App.tsx`) uses `<Layout />` as a wrapping route element.

- [ ] **Step 1: Write the failing test — `src/components/Layout.test.tsx`**

```typescript
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import Layout from "./Layout";
import { useAuth } from "../lib/AuthContext";

vi.mock("../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

describe("Layout", () => {
  it("renders the NavBar above the routed child content", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    render(
      <MemoryRouter initialEntries={["/child"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/child" element={<p>Child content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- Layout
```
Expected: FAIL — `src/components/Layout.tsx` doesn't exist yet.

- [ ] **Step 3: Write `src/components/Layout.tsx`**

```typescript
import { Outlet } from "react-router-dom";
import NavBar from "./NavBar";

export default function Layout() {
  return (
    <div>
      <NavBar />
      <Outlet />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- Layout
```
Expected: PASS.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc -b && vite build` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/Layout.tsx src/components/Layout.test.tsx
git commit -m "Add Layout component"
```

---

### Task 3: `SeasonStandings` page

**Files:**
- Create: `src/pages/season/SeasonStandings.tsx`
- Test: `src/pages/season/SeasonStandings.test.tsx`

**Interfaces:**
- Consumes: `listSeasons`, `getSeason`, `getSeasonStats` from `src/lib/api-client.ts`; `computeStandings` from `src/lib/standings.ts`; `computeHighestCheckout` from `src/lib/awards.ts`; `Standings`, `HighestCheckoutAward`, `PlayerStats` components (all pre-existing, untouched).
- Produces: default export `SeasonStandings` (no props). Task 6 (`App.tsx`) routes `/season/standings` to it.

- [ ] **Step 1: Write the failing test — `src/pages/season/SeasonStandings.test.tsx`**

```typescript
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SeasonStandings from "./SeasonStandings";
import * as apiClient from "../../lib/api-client";

vi.mock("../../lib/api-client");

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
  matches: [
    {
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
    },
  ],
};

describe("SeasonStandings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getSeasonStats).mockResolvedValue([]);
  });

  it("shows an empty state when there is no active season", async () => {
    vi.mocked(apiClient.listSeasons).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <SeasonStandings />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("No active season.")).toBeInTheDocument());
  });

  it("renders a standings table computed from the season's matches", async () => {
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      ...season,
      matches: [{ ...season.matches[0], status: "played", player1Legs: 3, player2Legs: 1 }],
    });
    render(
      <MemoryRouter>
        <SeasonStandings />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    expect(screen.getByText("Legs Won")).toBeInTheDocument();
    const administratorRow = screen.getByText("Administrator").closest("tr")!;
    expect(administratorRow).toHaveTextContent("3");
  });

  it("renders the player stats table computed from the season's throw history", async () => {
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.getSeasonStats).mockResolvedValue([
      { playerId: 1, displayName: "Administrator", threeDartAverage: 65.5, oneEightyCount: 1 },
    ]);
    render(
      <MemoryRouter>
        <SeasonStandings />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    expect(screen.getByText("3-Dart Avg")).toBeInTheDocument();
    const statsTable = screen.getByText("3-Dart Avg").closest("table")!;
    expect(within(statsTable).getByText("Administrator")).toBeInTheDocument();
    expect(within(statsTable).getByText("65.50")).toBeInTheDocument();
  });

  it("renders the highest checkout award computed from the season's matches", async () => {
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      ...season,
      matches: [{ ...season.matches[0], status: "played", player1Legs: 3, player2Legs: 1, player1Checkout: 121 }],
    });
    render(
      <MemoryRouter>
        <SeasonStandings />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    expect(screen.getByText(/Highest Checkout/)).toBeInTheDocument();
    expect(screen.getByText(/121/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- SeasonStandings
```
Expected: FAIL — `src/pages/season/SeasonStandings.tsx` doesn't exist yet.

- [ ] **Step 3: Write `src/pages/season/SeasonStandings.tsx`**

```typescript
import { useEffect, useState } from "react";
import { getSeason, getSeasonStats, listSeasons, type Season, type SeasonPlayerStat } from "../../lib/api-client";
import { computeStandings } from "../../lib/standings";
import { computeHighestCheckout } from "../../lib/awards";
import Standings from "./Standings";
import HighestCheckoutAward from "./HighestCheckoutAward";
import PlayerStats from "./PlayerStats";

export default function SeasonStandings() {
  const [season, setSeason] = useState<Season | null>(null);
  const [stats, setStats] = useState<SeasonPlayerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const seasons = await listSeasons();
        const active = seasons.find((s) => s.status === "active");
        if (!active) {
          setSeason(null);
          return;
        }
        const [seasonData, statsData] = await Promise.all([getSeason(active.id), getSeasonStats(active.id)]);
        setSeason(seasonData);
        setStats(statsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load season");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) {
    return <p className="p-4">Loading…</p>;
  }

  if (error) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        {error}
      </p>
    );
  }

  if (!season) {
    return (
      <div className="p-4">
        <h1 className="text-primary font-heading mb-4 text-2xl font-bold">Standings</h1>
        <p>No active season.</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">{season.name}</h1>
      <HighestCheckoutAward award={computeHighestCheckout(season.participants, season.matches)} />
      <Standings rows={computeStandings(season.participants, season.matches)} />
      <PlayerStats stats={stats} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- SeasonStandings
```
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc -b && vite build` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/season/SeasonStandings.tsx src/pages/season/SeasonStandings.test.tsx
git commit -m "Add SeasonStandings page"
```

---

### Task 4: `SeasonMatches` page

**Files:**
- Create: `src/pages/season/SeasonMatches.tsx`
- Test: `src/pages/season/SeasonMatches.test.tsx`

**Interfaces:**
- Consumes: `listSeasons`, `getSeason`, `archiveSeason`, `updateMatch`, `addMatch`, `deleteMatch` from `src/lib/api-client.ts`; `RoundRobinSchedule`, `formatMatchSummary` from `src/pages/season/RoundRobinSchedule.tsx` (pre-existing, untouched); `useAuth` from `src/lib/AuthContext.tsx`.
- Produces: default export `SeasonMatches` (no props). Task 6 (`App.tsx`) routes `/season/matches` to it.

- [ ] **Step 1: Write the failing test — `src/pages/season/SeasonMatches.test.tsx`**

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SeasonMatches from "./SeasonMatches";
import * as apiClient from "../../lib/api-client";
import { useAuth } from "../../lib/AuthContext";

vi.mock("../../lib/api-client");
vi.mock("../../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

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
  matches: [
    {
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
    },
  ],
};

function mockNonParticipant() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 3, username: "cjones", role: "player", displayName: "Carol Jones" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function mockParticipant() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

function mockAdmin() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
  });
}

describe("SeasonMatches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an empty state with no Create Season link for a player when there is no active season", async () => {
    mockNonParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("No active season.")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Create Season" })).not.toBeInTheDocument();
  });

  it("shows a Create Season link for an admin when there is no active season", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Create Season" })).toHaveAttribute("href", "/season/new");
    });
  });

  it("renders the active season's schedule", async () => {
    mockNonParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Spring 2026")).toBeInTheDocument());
    expect(screen.getByText("Administrator vs Bob Smith")).toBeInTheDocument();
  });

  it("shows no controls, not even Enter Result, for a non-participant player", async () => {
    mockNonParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive Season" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Enter Result" })).not.toBeInTheDocument();
  });

  it("shows only an Enter Result link, no reschedule/cancel, for a non-admin participant", async () => {
    mockParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enter Result" })).toHaveAttribute(
      "href",
      "/season/matches/101/result"
    );
  });

  it("shows a Start Live link for a scheduled match, alongside Enter Result", async () => {
    mockParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonMatches />
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
        <SeasonMatches />
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
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.queryByRole("link", { name: "Start Live" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Resume Live" })).not.toBeInTheDocument();
  });

  it("shows Edit Result instead of Enter Result once a match is played", async () => {
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
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.getByRole("link", { name: "Edit Result" })).toBeInTheDocument();
  });

  it("cancels a match when the admin clicks Cancel", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.updateMatch).mockResolvedValue({
      id: 101,
      roundNumber: 1,
      date: "2026-08-01",
      status: "cancelled",
      player1Id: 1,
      player2Id: 2,
    });
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(apiClient.updateMatch).toHaveBeenCalledWith(101, { status: "cancelled" });
    });
  });

  it("archives the season when the admin clicks Archive Season", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.archiveSeason).mockResolvedValue({ ...season, status: "archived" });
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByRole("button", { name: "Archive Season" }));

    await waitFor(() => {
      expect(apiClient.archiveSeason).toHaveBeenCalledWith(1);
    });
  });

  it("shows an Add Match form for an admin, hidden for a non-admin", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.getByRole("heading", { name: "Add Match" })).toBeInTheDocument();
  });

  it("hides the Add Match form for a non-admin participant", async () => {
    mockParticipant();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));
    expect(screen.queryByRole("heading", { name: "Add Match" })).not.toBeInTheDocument();
  });

  it("adds a match with the form and reloads", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.addMatch).mockResolvedValue({ ...season.matches[0], id: 999, roundNumber: 0 });
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.type(screen.getByLabelText("New match date"), "2026-09-01");
    await userEvent.selectOptions(screen.getByLabelText("Player 1"), "1");
    await userEvent.selectOptions(screen.getByLabelText("Player 2"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Add Match" }));

    await waitFor(() => {
      expect(apiClient.addMatch).toHaveBeenCalledWith(1, { date: "2026-09-01", player1Id: 1, player2Id: 2 });
    });
    expect(apiClient.getSeason).toHaveBeenCalledTimes(2);
  });

  it("shows a selection checkbox per match for an admin, and a disabled Delete Selected button with none selected", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    expect(screen.getByRole("button", { name: "Delete Selected (0)" })).toBeDisabled();
    expect(screen.getByLabelText("Select Administrator vs Bob Smith")).toBeInTheDocument();
  });

  it("deletes the selected matches after confirmation and reloads", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue(season);
    vi.mocked(apiClient.deleteMatch).mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByLabelText("Select Administrator vs Bob Smith"));
    await userEvent.click(screen.getByRole("button", { name: "Delete Selected (1)" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("1 match"));
    await waitFor(() => {
      expect(apiClient.deleteMatch).toHaveBeenCalledWith(101);
    });
    expect(apiClient.getSeason).toHaveBeenCalledTimes(2);
  });

  it("warns about lost results/throw history when a selected match has already been played", async () => {
    mockAdmin();
    vi.mocked(apiClient.listSeasons).mockResolvedValue([
      { id: 1, name: "Spring 2026", roundType: "single", status: "active", createdAt: "2026-07-01" },
    ]);
    vi.mocked(apiClient.getSeason).mockResolvedValue({
      ...season,
      matches: [{ ...season.matches[0], status: "played", player1Legs: 3, player2Legs: 1 }],
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <MemoryRouter>
        <SeasonMatches />
      </MemoryRouter>
    );
    await waitFor(() => screen.getByText("Spring 2026"));

    await userEvent.click(screen.getByLabelText("Select Administrator vs Bob Smith"));
    await userEvent.click(screen.getByRole("button", { name: "Delete Selected (1)" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("permanently lost"));
    expect(apiClient.deleteMatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- SeasonMatches
```
Expected: FAIL — `src/pages/season/SeasonMatches.tsx` doesn't exist yet.

- [ ] **Step 3: Write `src/pages/season/SeasonMatches.tsx`**

```typescript
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import {
  listSeasons,
  getSeason,
  archiveSeason,
  updateMatch,
  addMatch,
  deleteMatch,
  type Season,
  type SeasonMatch,
} from "../../lib/api-client";
import RoundRobinSchedule, { formatMatchSummary } from "./RoundRobinSchedule";

export default function SeasonMatches() {
  const { user } = useAuth();
  const [season, setSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addMatchDate, setAddMatchDate] = useState("");
  const [addMatchPlayer1Id, setAddMatchPlayer1Id] = useState<number | "">("");
  const [addMatchPlayer2Id, setAddMatchPlayer2Id] = useState<number | "">("");
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<number>>(new Set());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const seasons = await listSeasons();
      const active = seasons.find((s) => s.status === "active");
      if (!active) {
        setSeason(null);
        return;
      }
      setSeason(await getSeason(active.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load season");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleArchive() {
    if (!season) return;
    await archiveSeason(season.id);
    void load();
  }

  async function handleReschedule(matchId: number, date: string) {
    await updateMatch(matchId, { date });
    void load();
  }

  async function handleToggleStatus(match: SeasonMatch) {
    await updateMatch(match.id, { status: match.status === "cancelled" ? "scheduled" : "cancelled" });
    void load();
  }

  async function handleAddMatch() {
    if (!season || !addMatchDate || addMatchPlayer1Id === "" || addMatchPlayer2Id === "") return;
    await addMatch(season.id, { date: addMatchDate, player1Id: addMatchPlayer1Id, player2Id: addMatchPlayer2Id });
    setAddMatchDate("");
    setAddMatchPlayer1Id("");
    setAddMatchPlayer2Id("");
    void load();
  }

  function toggleMatchSelection(matchId: number) {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) {
        next.delete(matchId);
      } else {
        next.add(matchId);
      }
      return next;
    });
  }

  async function handleDeleteSelected() {
    if (!season || selectedMatchIds.size === 0) return;
    const selected = season.matches.filter((m) => selectedMatchIds.has(m.id));
    const anyPlayed = selected.some((m) => m.status === "played");
    const message = anyPlayed
      ? `Delete ${selected.length} match(es)? This cannot be undone. At least one selected match has already been played — its recorded result and full throw history will be permanently lost.`
      : `Delete ${selected.length} match(es)? This cannot be undone.`;
    if (!window.confirm(message)) return;
    await Promise.all([...selectedMatchIds].map((id) => deleteMatch(id)));
    setSelectedMatchIds(new Set());
    void load();
  }

  if (loading) {
    return <p className="p-4">Loading…</p>;
  }

  if (error) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        {error}
      </p>
    );
  }

  if (!season) {
    return (
      <div className="p-4">
        <h1 className="text-primary font-heading mb-4 text-2xl font-bold">Matches</h1>
        <p>No active season.</p>
        {user?.role === "admin" && (
          <Link to="/season/new" className="text-primary underline">
            Create Season
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-primary font-heading text-2xl font-bold">{season.name}</h1>
        {user?.role === "admin" && (
          <button onClick={() => void handleArchive()} className="text-primary underline">
            Archive Season
          </button>
        )}
      </div>
      {user?.role === "admin" && (
        <div className="mb-4 rounded border border-gray-300 p-3">
          <h2 className="font-heading mb-2 font-semibold">Add Match</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label="New match date"
              value={addMatchDate}
              onChange={(e) => setAddMatchDate(e.target.value)}
              className="rounded border border-gray-300 p-1"
            />
            <select
              aria-label="Player 1"
              value={addMatchPlayer1Id}
              onChange={(e) => setAddMatchPlayer1Id(e.target.value ? Number(e.target.value) : "")}
              className="rounded border border-gray-300 p-1"
            >
              <option value="">Player 1</option>
              {season.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <select
              aria-label="Player 2"
              value={addMatchPlayer2Id}
              onChange={(e) => setAddMatchPlayer2Id(e.target.value ? Number(e.target.value) : "")}
              className="rounded border border-gray-300 p-1"
            >
              <option value="">Player 2</option>
              {season.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <button onClick={() => void handleAddMatch()} className="text-primary underline">
              Add Match
            </button>
          </div>
        </div>
      )}
      {user?.role === "admin" && (
        <button
          onClick={() => void handleDeleteSelected()}
          disabled={selectedMatchIds.size === 0}
          className="text-primary mb-4 underline disabled:text-gray-400 disabled:no-underline"
        >
          Delete Selected ({selectedMatchIds.size})
        </button>
      )}
      <RoundRobinSchedule
        matches={season.matches}
        participants={season.participants}
        renderMatchActions={(match) => {
          const canRecordResult =
            !!user && (user.role === "admin" || user.id === match.player1.id || user.id === match.player2.id);

          if (!canRecordResult) {
            return formatMatchSummary(match);
          }

          return (
            <>
              {user?.role === "admin" && (
                <>
                  <input
                    type="checkbox"
                    aria-label={`Select ${match.player1.displayName} vs ${match.player2.displayName}`}
                    checked={selectedMatchIds.has(match.id)}
                    onChange={() => toggleMatchSelection(match.id)}
                  />
                  <input
                    type="date"
                    aria-label={`Reschedule ${match.player1.displayName} vs ${match.player2.displayName}`}
                    value={match.date.slice(0, 10)}
                    onChange={(e) => void handleReschedule(match.id, e.target.value)}
                    className="rounded border border-gray-300 p-1"
                  />
                  <button onClick={() => void handleToggleStatus(match)} className="text-primary underline">
                    {match.status === "cancelled" ? "Restore" : "Cancel"}
                  </button>
                </>
              )}
              {(match.status === "scheduled" || match.status === "in_progress") && (
                <Link to={`/season/matches/${match.id}/live`} className="text-primary underline">
                  {match.status === "in_progress" ? "Resume Live" : "Start Live"}
                </Link>
              )}
              <Link to={`/season/matches/${match.id}/result`} className="text-primary underline">
                {match.status === "played" ? "Edit Result" : "Enter Result"}
              </Link>
            </>
          );
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- SeasonMatches
```
Expected: PASS — all 16 tests pass.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc -b && vite build` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/season/SeasonMatches.tsx src/pages/season/SeasonMatches.test.tsx
git commit -m "Add SeasonMatches page"
```

---

### Task 5: Update `MatchResult`/`LiveScoring` post-action navigation

**Files:**
- Modify: `src/pages/season/MatchResult.tsx`
- Modify: `src/pages/season/MatchResult.test.tsx`
- Modify: `src/pages/season/LiveScoring.tsx`
- Modify: `src/pages/season/LiveScoring.test.tsx`

**Interfaces:**
- No new exports or signature changes — both components' `navigate()` target strings change from `"/season"` to `"/season/matches"`, and `LiveScoring`'s post-match button label changes from "Back to Season" to "Back to Matches".

- [ ] **Step 1: Update the failing tests**

In `src/pages/season/MatchResult.test.tsx`, inside `renderWithRouter`, change:

```typescript
        <Route path="/season" element={<div>Season page</div>} />
```

to:

```typescript
        <Route path="/season/matches" element={<div>Matches page</div>} />
```

Further down in the same file, change:

```typescript
    await waitFor(() => expect(screen.getByText("Season page")).toBeInTheDocument());
```

to:

```typescript
    await waitFor(() => expect(screen.getByText("Matches page")).toBeInTheDocument());
```

In `src/pages/season/LiveScoring.test.tsx`, inside `renderWithRouter`, change:

```typescript
        <Route path="/season" element={<div>Season page</div>} />
```

to:

```typescript
        <Route path="/season/matches" element={<div>Matches page</div>} />
```

Further down, change the test name and its two assertions:

```typescript
  it("shows a completion summary with a Back to Season button when the match is complete", async () => {
```

to:

```typescript
  it("shows a completion summary with a Back to Matches button when the match is complete", async () => {
```

and:

```typescript
    await userEvent.click(screen.getByRole("button", { name: "Back to Season" }));
    await waitFor(() => expect(screen.getByText("Season page")).toBeInTheDocument());
```

to:

```typescript
    await userEvent.click(screen.getByRole("button", { name: "Back to Matches" }));
    await waitFor(() => expect(screen.getByText("Matches page")).toBeInTheDocument());
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- MatchResult LiveScoring
```
Expected: FAIL — both components still `navigate("/season")` and the button still reads "Back to Season", so the test route stubs (now at `/season/matches`) never match and the renamed button doesn't exist.

- [ ] **Step 3: Update the source files**

In `src/pages/season/MatchResult.tsx`, change:

```typescript
      navigate("/season");
```

to:

```typescript
      navigate("/season/matches");
```

In `src/pages/season/LiveScoring.tsx`, change:

```typescript
          <button
            type="button"
            onClick={() => navigate("/season")}
            className="bg-primary text-primary-content font-heading rounded p-2"
          >
            Back to Season
          </button>
```

to:

```typescript
          <button
            type="button"
            onClick={() => navigate("/season/matches")}
            className="bg-primary text-primary-content font-heading rounded p-2"
          >
            Back to Matches
          </button>
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- MatchResult LiveScoring
```
Expected: PASS — full suites for both files pass.

- [ ] **Step 5: Verify the project builds**

```bash
npm run build
```
Expected: `tsc -b && vite build` succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/season/MatchResult.tsx src/pages/season/MatchResult.test.tsx src/pages/season/LiveScoring.tsx src/pages/season/LiveScoring.test.tsx
git commit -m "Send post-match navigation to /season/matches"
```

---

### Task 6: Wire `Layout` into routing, split `Season.tsx` out, simplify `Home.tsx`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/pages/Home.tsx`
- Modify: `src/pages/Home.test.tsx`
- Delete: `src/pages/season/Season.tsx`
- Delete: `src/pages/season/Season.test.tsx`

**Interfaces:**
- Consumes: `Layout` (Task 2), `SeasonStandings` (Task 3), `SeasonMatches` (Task 4) — all already merged into this branch by this point.
- Produces: the final routing table described in the plan's Global Constraints; `Home` renders only `<AnnouncementFeed />`.

- [ ] **Step 1: Update `src/App.test.tsx`**

Add this test at the end of the `describe("App", ...)` block, immediately before its closing `});`:

```typescript
  it("redirects /season to /season/standings", async () => {
    vi.mocked(apiClient.fetchCurrentUser).mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "Administrator",
    });
    vi.mocked(apiClient.listSeasons).mockResolvedValue([]);
    window.history.pushState({}, "", "/season");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("No active season.")).toBeInTheDocument();
    });
    expect(window.location.pathname).toBe("/season/standings");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- App.test
```
Expected: FAIL — `/season` doesn't redirect yet (it isn't even a valid route until this task rewrites `App.tsx`), so the "No active season." text never appears at the redirected path.

- [ ] **Step 3: Replace `src/App.tsx`**

```typescript
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminRoute } from "./components/AdminRoute";
import Layout from "./components/Layout";
import Login from "./pages/auth/Login";
import Home from "./pages/Home";
import Members from "./pages/admin/Members";
import NewMember from "./pages/admin/NewMember";
import EditMember from "./pages/admin/EditMember";
import SeasonStandings from "./pages/season/SeasonStandings";
import SeasonMatches from "./pages/season/SeasonMatches";
import NewSeason from "./pages/season/NewSeason";
import SeasonArchive from "./pages/season/SeasonArchive";
import SeasonDetail from "./pages/season/SeasonDetail";
import MatchResult from "./pages/season/MatchResult";
import LiveScoring from "./pages/season/LiveScoring";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
      </AuthProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 4: Replace `src/pages/Home.tsx`**

```typescript
import AnnouncementFeed from "./home/AnnouncementFeed";

export default function Home() {
  return <AnnouncementFeed />;
}
```

- [ ] **Step 5: Replace `src/pages/Home.test.tsx`**

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Home from "./Home";
import * as apiClient from "../lib/api-client";
import { useAuth } from "../lib/AuthContext";

vi.mock("../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));
vi.mock("../lib/api-client");

describe("Home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    vi.mocked(apiClient.getAnnouncements).mockResolvedValue([]);
  });

  it("renders the announcement feed", async () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("No announcements yet")).toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Delete `src/pages/season/Season.tsx` and `src/pages/season/Season.test.tsx`**

```bash
git rm src/pages/season/Season.tsx src/pages/season/Season.test.tsx
```

- [ ] **Step 7: Run the full frontend suite and verify it passes**

```bash
npm test
```
Expected: PASS — full suite passes, including the new `App.test.tsx` redirect case, the trimmed `Home.test.tsx`, and every other file untouched by this task.

- [ ] **Step 8: Verify the project builds**

```bash
npm run build
```
Expected: `tsc -b && vite build` succeeds with no errors.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/pages/Home.tsx src/pages/Home.test.tsx
git commit -m "Wire Layout into routing, split Season.tsx into SeasonStandings/SeasonMatches"
```

---

## Manual E2E Verification (after all tasks)

Once every task above is committed, do a manual pass in the browser (per the project's `run` skill) covering the golden path and edge cases:
1. Log in, confirm the nav bar (logo/Standings/Matches/Season Archive/Manage Members/user name/logout) appears on every page you visit — not just Home.
2. Click the logo, confirm it returns to the announcements feed.
3. Click "Standings", confirm the standings/highest-checkout/player-stats view loads with no schedule or admin controls.
4. Click "Matches", confirm the schedule and (as admin) the Archive Season button, add-match form, and select-and-delete flow all still work exactly as before.
5. Click "Season Archive", confirm it loads (previously unreachable via nav).
6. As admin, enter a match result or run a live-scoring session to completion; confirm you land back on the Matches page (not Standings), and the button reads "Back to Matches".
7. Manually navigate to `/season` in the address bar; confirm it redirects to `/season/standings`.
8. Confirm the Login page still renders without the nav bar.
