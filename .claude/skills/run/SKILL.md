---
name: run-dartstracker
description: Launch and drive Dartstracker's full local dev stack (local SQL Server via Docker, Azurite, the Azure Functions API, and the Vite+SWA CLI frontend) for manual browser testing or Playwright-driven verification. Use whenever asked to run, start, demo, or test this app locally in a browser.
---

# Running Dartstracker Locally

The full stack has four pieces that must all be up: **SQL Server** (Docker), **Azurite** (storage
emulator, required even though nothing uses blob/queue storage yet — `AzureWebJobsStorage` needs
it), the **Azure Functions API** (`func start`, port 7071), and the **frontend + SWA CLI proxy**
(port 4280, proxies Vite on 5173). Bring them up in that order.

**Always redirect background process output to a log file** (your session scratchpad if running
under Claude Code, otherwise any temp dir) — don't let them block the foreground.

## 0. One-time environment files (gitignored, won't exist on a fresh clone/worktree)

Check `api/.env` exists; if not, create it:

```
DATABASE_URL="sqlserver://localhost:1433;database=dartstracker;user=sa;password=DevPassword123!;encrypt=true;trustServerCertificate=true"
JWT_SECRET="dev-only-secret-change-me-32-chars-min"
```

Check `api/local.settings.json` exists; if not, copy `api/local.settings.json.example` to
`api/local.settings.json` verbatim (it has the same DB/JWT values plus `AzureWebJobsStorage` and
`FUNCTIONS_WORKER_RUNTIME`). **Without this file `func start` fails immediately** with
`Can't determine project language... Worker runtime cannot be 'None'.` — it's not a subtler config
issue, just a missing file.

## 1. Docker: SQL Server

Check Docker's actually running first (`docker ps`); if it errors with a pipe/daemon-not-found
message, Docker Desktop isn't started:

```powershell
Start-Process "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
```

Then poll (don't sleep blindly — Docker Desktop can take 30-90s cold):

```bash
i=0; until docker ps >/dev/null 2>&1 || [ $i -ge 40 ]; do sleep 3; i=$((i+1)); done
```

Bring up the container:

```bash
docker compose up -d
```

If this errors with `Conflict. The container name "/dartstracker-sqlserver" is already in use` —
the container already exists from a previous session, just start it instead:

```bash
docker start dartstracker-sqlserver
```

Wait for SQL Server to actually accept connections (container "running" ≠ "accepting queries" —
there's a real startup delay). **In Git Bash, prefix with `MSYS_NO_PATHCONV=1`** or the
`/opt/mssql-tools18/...` path gets mangled into a bogus Windows path and the command fails with a
confusing "no such file or directory":

```bash
i=0; until MSYS_NO_PATHCONV=1 docker exec dartstracker-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P 'DevPassword123!' -C -Q "SELECT 1" >/dev/null 2>&1 || [ $i -ge 30 ]; do
  sleep 2; i=$((i+1))
done
```

## 2. Dependencies, migrations, seed data

```bash
cd api && npm install          # postinstall runs `prisma generate` automatically
cd .. && npm install           # root deps — see gotcha below if this was skipped before
cd api && npx prisma migrate deploy   # safe no-op if already applied
```

Check whether an admin account exists before assuming you need to seed:

```bash
MSYS_NO_PATHCONV=1 docker exec dartstracker-sqlserver /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P 'DevPassword123!' -C -d dartstracker -Q "SELECT username, role FROM [User]"
```

If empty, seed one (from `api/`, needs `.env` in place):

```bash
node prisma/seed.js
```

Login is `admin` / `ChangeMe123!` unless `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD` env vars were
set when seeding.

## 3. Start the API

```bash
cd api && npm run build   # tsc — do this before func start, don't rely on func to transpile
func start > <logfile> 2>&1 &
disown
```

Poll until healthy:

```bash
i=0; until curl -s -o /dev/null http://localhost:7071/api/health || [ $i -ge 30 ]; do
  sleep 2; i=$((i+1))
done
curl -s http://localhost:7071/api/health   # expect {"status":"ok","dbConnected":true}
```

If `func` itself isn't on PATH or its first-run setup is broken, see the separate memory note
`env-swa-func-windows-broken-download.md` (SWA CLI's bundled Core Tools downloader and the global
npm package's own extraction step are both independently broken on this Windows/Git-Bash setup —
manual install + `Expand-Archive` is the fix, not a retry).

If Azurite isn't already running in the background (`npm run azurite` from `api/`), start it
*before* `func start` — `local.settings.json`'s `AzureWebJobsStorage: UseDevelopmentStorage=true`
needs it.

## 4. Start the frontend (SWA CLI proxy + Vite)

**Never let `swa start` manage/download its own Functions Core Tools** — point it at the API you
already started instead:

```bash
npm run dev:swa -- --api-devserver-url http://localhost:7071 > <logfile> 2>&1 &
disown
```

Poll until it answers:

```bash
i=0; until curl -s -o /dev/null http://localhost:4280 || [ $i -ge 30 ]; do sleep 2; i=$((i+1)); done
```

The app is at **http://localhost:4280** (this is the URL to open/navigate to — not 5173, which is
the raw Vite server SWA CLI proxies internally).

## Gotchas hit in practice

- **Stale root `node_modules`.** If a dependency was added to `package.json` by a merge but you
  never ran `npm install` in *this* checkout (e.g. you're back on `main` after only ever installing
  inside per-phase worktrees), Vite's dependency pre-bundling scan fails silently for that package
  and every page that imports it renders blank with a console error
  (`Failed to resolve import "..."`) even though the page returns HTTP 200. Fix: `npm install` at
  the repo root, then clear `node_modules/.vite` and restart the frontend process — Vite does not
  reliably self-heal an already-running dev server after a fresh install.

- **Port already taken → hung interactive prompt.** If a previous `swa start` instance from an
  earlier session/tool-call is still alive and holding port 4280, a new `npm run dev:swa` prints
  `Port 4280 is already taken! Would you like to start the emulator on a different port? (Y/n)` and
  then blocks forever waiting on stdin (non-interactive shells never answer it). Symptoms: the
  `curl` health-check loop above times out with no error in the log beyond that prompt. Diagnose
  with `netstat -ano | grep -E ":4280|:5173|:7071" | grep LISTENING` — if something is *already*
  answering 4280/7071 with 200/OK, you likely have a leftover healthy instance from before; just
  reuse it rather than starting a new one. If instead you have a genuinely stuck second instance,
  find and kill its whole process tree (PowerShell, since Git Bash `kill <bash-job-pid>` doesn't
  reliably map to the real `node.exe` PID Windows assigns through the `npm` → `swa` → `vite` spawn
  chain):
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'swa' } |
    Select-Object ProcessId, CommandLine
  Stop-Process -Id <pid> -Force
  Get-CimInstance Win32_Process -Filter "ParentProcessId=<pid>" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  ```

## Driving it (don't just launch it)

Use the Playwright MCP tools, not a bare `curl`, to actually prove the UI works:
`browser_navigate` to `http://localhost:4280`, `browser_snapshot` to read the accessible tree,
`browser_type`/`browser_click`/`browser_select_option` to fill the login form (or drive any
feature), `browser_handle_dialog` for the app's native `window.confirm()` calls (e.g. the
delete-match flow), `browser_take_screenshot` for a visual to hand back to the user.

If the database is empty (no seasons/members beyond the seeded admin), you'll need to create at
least a couple of player members (`/admin/members/new`) and a season (`/season/new`, pick a round
type + participants + fill in the round-date fields that appear once participants are checked)
before most features (schedule, standings, live scoring, additional matches) have anything to show.

## Shutting down

```bash
# find and kill: the func process, the npm/swa/vite process tree (see gotcha above), azurite
docker stop dartstracker-sqlserver   # keeps the data volume; use `docker compose down -v` to wipe it
```
