# Darts League App — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the empty project skeleton — frontend, backend, database, local dev loop, and CI/CD — so every later feature phase (auth, seasons, matches, live scoring, stats, admin, archive) has a working, deployable app to build on.

**Architecture:** A single Azure Static Web App: a React/Vite/Tailwind PWA at the root, and an integrated Azure Functions (Node.js/TypeScript) API in `/api`, both talking to a local SQL Server container (swapped for Azure SQL in production) via Prisma. No domain models yet — this plan proves the toolchain end-to-end with a single `/api/health` endpoint that round-trips a real database query.

**Tech Stack:** React 19 + Vite + TypeScript, Tailwind CSS v4, vite-plugin-pwa, Vitest + React Testing Library, Azure Functions v4 programming model (Node/TypeScript), Prisma ORM with `@prisma/adapter-mssql`, Azure SQL Database / SQL Server, Azure Static Web Apps CLI, Docker (local SQL Server + Azurite storage emulator).

## Global Constraints

- Mobile-first, responsive PWA; must work smoothly in Android and iOS mobile browsers.
- Hosting cost minimized (target: €0–5/month) — Azure Static Web Apps Free tier, Functions Consumption plan, SQL Serverless with auto-pause.
- No offline-first requirement.
- Backend is Node.js/TypeScript Azure Functions; data access is via Prisma ORM.
- Theming/branding must be config-file based: colors and fonts as CSS custom properties in one file, logo/images in one folder referenced through one constants file — no component code should hardcode a color, font, or asset path.

---

### Task 1: Frontend project scaffold (React + Vite + TypeScript + Vitest)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/vite-env.d.ts`
- Create: `src/test/setup.ts`
- Create: `src/App.tsx`
- Test: `src/App.test.tsx`
- Create: `.gitignore`

**Interfaces:**
- Produces: `App` — default-exported React component from `src/App.tsx`, rendered by `src/main.tsx` into `#root`. Later tasks (2, 3) modify `App.tsx` in place.

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "dartstracker-web",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install react react-dom
npm install -D typescript vite @vitejs/plugin-react @types/react @types/react-dom vitest @vitest/ui jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create `vite.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
```

- [ ] **Step 6: Create `src/test/setup.ts`**

```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 7: Create `src/vite-env.d.ts`**

```typescript
/// <reference types="vite/client" />
```

- [ ] **Step 8: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Darts League</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 9: Create `src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 10: Write the failing test — `src/App.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the app heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Darts League" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 11: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/App.tsx` does not exist, module resolution error.

- [ ] **Step 12: Create minimal `src/App.tsx`**

```tsx
export default function App() {
  return <h1>Darts League</h1>;
}
```

- [ ] **Step 13: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — 1 test passed.

- [ ] **Step 14: Create root `.gitignore`**

```
node_modules/
dist/
*.local
.env
.env.local
.azurite/
api/node_modules/
api/dist/
api/local.settings.json
api/.env
```

- [ ] **Step 15: Commit**

```bash
git add package.json package-lock.json tsconfig.json tsconfig.node.json vite.config.ts index.html src .gitignore
git commit -m "Scaffold React + Vite + TypeScript frontend with Vitest"
```

---

### Task 2: Tailwind CSS v4 theming tokens

**Files:**
- Modify: `vite.config.ts`
- Create: `src/styles/theme.css`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `App` component from Task 1 (`src/App.tsx`).
- Produces: Tailwind utility classes `bg-primary`, `text-primary`, `font-heading` (and any further `--color-*`/`--font-*` tokens added later) available project-wide via `src/styles/theme.css`. This is the **single file** later tasks/phases edit to change the app's colors or fonts.

Tailwind v4 has no `tailwind.config.js` by default — theme tokens are declared directly in CSS via the `@theme` directive, which is what `theme.css` does here. This satisfies the "colors/fonts adjustable from one file" requirement even more directly than a JS config would.

- [ ] **Step 1: Install Tailwind CSS v4 and its Vite plugin**

Run:
```bash
npm install tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Create `src/styles/theme.css`**

```css
@import "tailwindcss";

@theme {
  --color-primary: #1d4ed8;
  --color-primary-content: #ffffff;
  --color-secondary: #0f172a;
  --font-heading: "Inter", sans-serif;
  --font-body: "Inter", sans-serif;
}
```

- [ ] **Step 3: Add the Tailwind plugin to `vite.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
```

- [ ] **Step 4: Import the theme stylesheet in `src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 5: Write the failing test — update `src/App.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the app heading using the theme's primary color and heading font", () => {
    render(<App />);
    const heading = screen.getByRole("heading", { name: "Darts League" });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass("text-primary");
    expect(heading).toHaveClass("font-heading");
  });
});
```

- [ ] **Step 6: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — heading does not have class `text-primary`.

- [ ] **Step 7: Update `src/App.tsx` to use themed classes**

```tsx
export default function App() {
  return (
    <h1 className="text-primary font-heading text-3xl font-bold">
      Darts League
    </h1>
  );
}
```

- [ ] **Step 8: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — 1 test passed.

- [ ] **Step 9: Commit**

```bash
git add vite.config.ts src/styles/theme.css src/main.tsx src/App.tsx src/App.test.tsx package.json package-lock.json
git commit -m "Add Tailwind CSS v4 with centralized theme tokens"
```

---

### Task 3: Branding constants and assets

**Files:**
- Create: `public/branding/logo.svg`
- Create: `public/branding/favicon.svg`
- Create: `src/branding.ts`
- Test: `src/branding.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Produces: `branding` — named export from `src/branding.ts`, shape `{ appName: string; shortName: string; logoSrc: string; faviconSrc: string; themeColor: string }`. This is the **single file** later tasks (including Task 4's PWA manifest) import for the app's name, logo path, and theme color — no other file should hardcode these values.

`public/` assets are served verbatim by Vite at their root-relative path (unlike `src/assets`, which would require updating an import statement on every swap) — so rebranding the logo is "replace the file at `public/branding/logo.svg`", nothing else.

- [ ] **Step 1: Create `public/branding/logo.svg`** (placeholder mark, swap this file to rebrand)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <circle cx="32" cy="32" r="30" fill="#1d4ed8" />
  <circle cx="32" cy="32" r="6" fill="#ffffff" />
  <text x="32" y="52" font-family="sans-serif" font-size="10" fill="#ffffff" text-anchor="middle">DL</text>
</svg>
```

- [ ] **Step 2: Create `public/branding/favicon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <circle cx="32" cy="32" r="30" fill="#1d4ed8" />
  <circle cx="32" cy="32" r="6" fill="#ffffff" />
</svg>
```

- [ ] **Step 3: Write the failing test — `src/branding.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { branding } from "./branding";

describe("branding", () => {
  it("exposes the app name, short name, logo, favicon, and theme color", () => {
    expect(branding.appName).toBe("Darts League");
    expect(branding.shortName).toBe("DartsLeague");
    expect(branding.logoSrc).toBe("/branding/logo.svg");
    expect(branding.faviconSrc).toBe("/branding/favicon.svg");
    expect(branding.themeColor).toBe("#1d4ed8");
  });
});
```

- [ ] **Step 4: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/branding.ts` does not exist.

- [ ] **Step 5: Create `src/branding.ts`**

```typescript
export const branding = {
  appName: "Darts League",
  shortName: "DartsLeague",
  logoSrc: "/branding/logo.svg",
  faviconSrc: "/branding/favicon.svg",
  themeColor: "#1d4ed8",
} as const;
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Write the failing test — update `src/App.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import App from "./App";
import { branding } from "./branding";

describe("App", () => {
  it("renders the branded app name using the theme's primary color and heading font", () => {
    render(<App />);
    const heading = screen.getByRole("heading", { name: branding.appName });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass("text-primary");
    expect(heading).toHaveClass("font-heading");
  });

  it("renders the branded logo", () => {
    render(<App />);
    const logo = screen.getByRole("img", { name: branding.appName });
    expect(logo).toHaveAttribute("src", branding.logoSrc);
  });
});
```

- [ ] **Step 8: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — no `img` role found.

- [ ] **Step 9: Update `src/App.tsx` to render the logo and branded name**

```tsx
import { branding } from "./branding";

export default function App() {
  return (
    <div className="flex items-center gap-3 p-4">
      <img src={branding.logoSrc} alt={branding.appName} width={40} height={40} />
      <h1 className="text-primary font-heading text-3xl font-bold">
        {branding.appName}
      </h1>
    </div>
  );
}
```

- [ ] **Step 10: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS — 3 tests passed.

- [ ] **Step 11: Commit**

```bash
git add public/branding src/branding.ts src/branding.test.ts src/App.tsx src/App.test.tsx
git commit -m "Add centralized branding constants and placeholder logo/favicon"
```

---

### Task 4: PWA setup

**Files:**
- Modify: `vite.config.ts`
- Modify: `index.html`

**Interfaces:**
- Consumes: `branding` from Task 3 (`src/branding.ts`) — the manifest's `name`, `short_name`, and `theme_color` are sourced from it so rebranding never requires touching `vite.config.ts`.

- [ ] **Step 1: Install `vite-plugin-pwa`**

Run:
```bash
npm install -D vite-plugin-pwa
```

- [ ] **Step 2: Add the PWA plugin to `vite.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { branding } from "./src/branding";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["branding/favicon.svg"],
      devOptions: { enabled: true },
      manifest: {
        name: branding.appName,
        short_name: branding.shortName,
        description: "Recreational darts league management",
        theme_color: branding.themeColor,
        background_color: "#ffffff",
        display: "standalone",
        icons: [
          {
            src: branding.faviconSrc,
            sizes: "any",
            type: "image/svg+xml",
          },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
```

- [ ] **Step 3: Add theme-color meta tag and favicon link to `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/branding/favicon.svg" />
    <meta name="theme-color" content="#1d4ed8" />
    <title>Darts League</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Build and verify the manifest is generated correctly**

Run:
```bash
npm run build
cat dist/manifest.webmanifest
```

Expected: JSON containing `"name":"Darts League"`, `"short_name":"DartsLeague"`, `"theme_color":"#1d4ed8"`.

- [ ] **Step 5: Run the existing test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS — 3 tests passed.

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts index.html package.json package-lock.json
git commit -m "Configure installable PWA manifest sourced from branding constants"
```

---

### Task 5: Azure Functions API scaffold (Node.js/TypeScript)

**Files:**
- Create: `api/package.json`
- Create: `api/tsconfig.json`
- Create: `api/host.json`
- Create: `api/local.settings.json.example`
- Create: `api/.funcignore`
- Create: `api/src/functions/health.ts`
- Test: `api/test/functions/health.test.ts`

**Interfaces:**
- Produces: `health` — named export from `api/src/functions/health.ts`, signature `(request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>`, registered on route `GET /api/health`. Task 6 modifies this function in place to check database connectivity.

- [ ] **Step 1: Create `api/package.json`**

```json
{
  "name": "dartstracker-api",
  "version": "0.0.1",
  "private": true,
  "main": "dist/src/functions/*.js",
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w",
    "start": "npm run build && func start",
    "azurite": "azurite --silent --location .azurite --debug .azurite/debug.log",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Install dependencies (from within `api/`)**

Run:
```bash
cd api
npm install @azure/functions
npm install -D typescript azure-functions-core-tools@4 azurite vitest
cd ..
```

- [ ] **Step 3: Create `api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": ".",
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 4: Create `api/host.json`**

```json
{
  "version": "2.0",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.0.0, 5.0.0)"
  },
  "logging": {
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true,
        "excludedTypes": "Request"
      }
    }
  }
}
```

- [ ] **Step 5: Create `api/local.settings.json.example`**

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node"
  }
}
```

- [ ] **Step 6: Copy it to the real (gitignored) local settings file**

Run:
```bash
cp api/local.settings.json.example api/local.settings.json
```

- [ ] **Step 7: Create `api/.funcignore`**

```
test/
*.ts
tsconfig.json
local.settings.json
.azurite/
```

- [ ] **Step 8: Write the failing test — `api/test/functions/health.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { health } from "../../src/functions/health";
import type { HttpRequest, InvocationContext } from "@azure/functions";

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

describe("health function", () => {
  it("returns 200 with status ok", async () => {
    const result = await health({} as HttpRequest, createContext());
    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 9: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/functions/health.ts` does not exist.

- [ ] **Step 10: Create `api/src/functions/health.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

export async function health(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  return { status: 200, jsonBody: { status: "ok" } };
}

app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "health",
  handler: health,
});
```

- [ ] **Step 11: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — 1 test passed.

- [ ] **Step 12: Manually verify the function runs locally**

Run (in one terminal):
```bash
cd api && npm run azurite
```
Run (in a second terminal):
```bash
cd api && npm run start
```
Then: `curl http://localhost:7071/api/health`
Expected: `{"status":"ok"}`

- [ ] **Step 13: Commit**

```bash
git add api/package.json api/package-lock.json api/tsconfig.json api/host.json api/local.settings.json.example api/.funcignore api/src api/test
git commit -m "Scaffold Azure Functions (Node/TypeScript) API with a health endpoint"
```

---

### Task 6: Prisma + local SQL Server, wired into the health check

**Files:**
- Create: `docker-compose.yml`
- Create: `api/.env.example`
- Create: `api/prisma/schema.prisma`
- Create: `api/prisma.config.ts`
- Create: `api/src/lib/prisma.ts`
- Modify: `api/src/functions/health.ts`
- Modify: `api/test/functions/health.test.ts`

**Interfaces:**
- Consumes: `health` from Task 5 (`api/src/functions/health.ts`).
- Produces: `prisma` — named export from `api/src/lib/prisma.ts`, a configured `PrismaClient` instance. Every future backend module (`users`, `seasons`, `matches`, `scoring`, `stats`) imports `prisma` from this file rather than constructing its own client.

- [ ] **Step 1: Install Prisma and the SQL Server driver adapter (from within `api/`)**

Run:
```bash
cd api
npm install @prisma/client @prisma/adapter-mssql mssql dotenv
npm install -D prisma
cd ..
```

- [ ] **Step 2: Create `docker-compose.yml`** (repo root)

```yaml
services:
  sqlserver:
    image: mcr.microsoft.com/mssql/server:2022-latest
    container_name: dartstracker-sqlserver
    environment:
      ACCEPT_EULA: "Y"
      MSSQL_SA_PASSWORD: "DevPassword123!"
      MSSQL_PID: "Developer"
    ports:
      - "1433:1433"
    volumes:
      - sqlserver-data:/var/opt/mssql

volumes:
  sqlserver-data:
```

- [ ] **Step 3: Start the database and verify it's running**

Run:
```bash
docker compose up -d
docker compose ps
```
Expected: `sqlserver` service listed with state `running` / `healthy`.

- [ ] **Step 4: Create `api/.env.example`**

```
DATABASE_URL="sqlserver://localhost:1433;database=dartstracker;user=sa;password=DevPassword123!;encrypt=true;trustServerCertificate=true"
```

- [ ] **Step 5: Copy it to the real (gitignored) env file**

Run:
```bash
cp api/.env.example api/.env
```

- [ ] **Step 6: Create `api/prisma/schema.prisma`** (no models yet — added starting with the auth phase)

```prisma
datasource db {
  provider = "sqlserver"
}

generator client {
  provider = "prisma-client-js"
}
```

- [ ] **Step 7: Create `api/prisma.config.ts`**

```typescript
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

- [ ] **Step 8: Generate the Prisma Client**

Run:
```bash
cd api && npx prisma generate
```
Expected: `Generated Prisma Client` success message, no errors.

- [ ] **Step 9: Create `api/src/lib/prisma.ts`**

```typescript
import { PrismaMssql } from "@prisma/adapter-mssql";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const adapter = new PrismaMssql(connectionString);

export const prisma = new PrismaClient({ adapter });
```

- [ ] **Step 10: Write the failing test — update `api/test/functions/health.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { health } from "../../src/functions/health";
import { prisma } from "../../src/lib/prisma";
import type { HttpRequest, InvocationContext } from "@azure/functions";

vi.mock("../../src/lib/prisma", () => ({
  prisma: { $queryRaw: vi.fn() },
}));

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

describe("health function", () => {
  it("returns 200 with dbConnected true when the query succeeds", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ ok: 1 }]);
    const result = await health({} as HttpRequest, createContext());
    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({ status: "ok", dbConnected: true });
  });

  it("returns 500 with dbConnected false when the query fails", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("connection failed"));
    const result = await health({} as HttpRequest, createContext());
    expect(result.status).toBe(500);
    expect(result.jsonBody).toEqual({ status: "error", dbConnected: false });
  });
});
```

- [ ] **Step 11: Run the tests and verify they fail**

Run: `cd api && npm test`
Expected: FAIL — `health` does not yet call `prisma.$queryRaw`, so `jsonBody` doesn't include `dbConnected`.

- [ ] **Step 12: Update `api/src/functions/health.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../lib/prisma";

export async function health(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await prisma.$queryRaw`SELECT 1 as ok`;
    return { status: 200, jsonBody: { status: "ok", dbConnected: true } };
  } catch (error) {
    context.error(`Database connectivity check failed: ${error}`);
    return { status: 500, jsonBody: { status: "error", dbConnected: false } };
  }
}

app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "health",
  handler: health,
});
```

- [ ] **Step 13: Run the tests and verify they pass**

Run: `cd api && npm test`
Expected: PASS — 2 tests passed.

- [ ] **Step 14: Manually verify against the real local database**

With `docker compose up -d` and `npm run azurite` (Task 5) running:
```bash
cd api && npm run start
curl http://localhost:7071/api/health
```
Expected: `{"status":"ok","dbConnected":true}`

- [ ] **Step 15: Commit**

```bash
git add docker-compose.yml api/.env.example api/prisma api/prisma.config.ts api/src/lib api/src/functions/health.ts api/test/functions/health.test.ts api/package.json api/package-lock.json
git commit -m "Wire Prisma + local SQL Server into the health check"
```

---

### Task 7: Integrated local dev via Azure Static Web Apps CLI

**Files:**
- Create: `swa-cli.config.json`
- Create: `staticwebapp.config.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: frontend dev server from Task 1 (`npm run dev`, port 5173), API from Tasks 5–6 (`func start`, port 7071).

- [ ] **Step 1: Install the Static Web Apps CLI (root devDependency)**

Run:
```bash
npm install -D @azure/static-web-apps-cli
```

- [ ] **Step 2: Create `swa-cli.config.json`**

```json
{
  "$schema": "https://aka.ms/azure/static-web-apps-cli/schema",
  "configurations": {
    "dartstracker": {
      "appLocation": ".",
      "apiLocation": "api",
      "outputLocation": "dist",
      "appBuildCommand": "npm run build",
      "apiBuildCommand": "npm run build --prefix api",
      "run": "npm run dev",
      "appDevserverUrl": "http://localhost:5173"
    }
  }
}
```

- [ ] **Step 3: Create `staticwebapp.config.json`**

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/branding/*", "/api/*", "*.{svg,png,ico,webmanifest,js,css}"]
  }
}
```

- [ ] **Step 4: Add a `dev:swa` script to `package.json`**

```json
{
  "scripts": {
    "dev": "vite",
    "dev:swa": "swa start",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 5: Manually verify the combined local environment**

With `docker compose up -d` and `cd api && npm run azurite` (in a separate terminal) running:
```bash
npm run dev:swa
```
Then open `http://localhost:4280` in a browser.
Expected: the "Darts League" page renders with logo and heading.
Then open `http://localhost:4280/api/health`.
Expected: `{"status":"ok","dbConnected":true}`.

- [ ] **Step 6: Commit**

```bash
git add swa-cli.config.json staticwebapp.config.json package.json package-lock.json
git commit -m "Add Azure Static Web Apps CLI for integrated local dev"
```

---

### Task 8: CI/CD skeleton

**Files:**
- Create: `.github/workflows/azure-static-web-apps.yml`

- [ ] **Step 1: Create `.github/workflows/azure-static-web-apps.yml`**

```yaml
name: Azure Static Web Apps CI/CD

on:
  push:
    branches:
      - main
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches:
      - main

jobs:
  build_and_deploy_job:
    if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.action != 'closed')
    runs-on: ubuntu-latest
    name: Build and Deploy Job
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: true
      - name: Build and Deploy
        id: builddeploy
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/"
          api_location: "api"
          output_location: "dist"

  close_pull_request_job:
    if: github.event_name == 'pull_request' && github.event.action == 'closed'
    runs-on: ubuntu-latest
    name: Close Pull Request Job
    steps:
      - name: Close Pull Request
        id: closepullrequest
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          action: "close"
```

- [ ] **Step 2: Validate the YAML syntax**

Run:
```bash
npx -y js-yaml .github/workflows/azure-static-web-apps.yml
```
Expected: prints the parsed structure with no errors.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/azure-static-web-apps.yml
git commit -m "Add Azure Static Web Apps CI/CD workflow"
```

- [ ] **Step 4: Note the manual follow-up (not part of this plan)**

This workflow will fail until two things exist outside this repo: an actual Azure Static Web App resource, and an `AZURE_STATIC_WEB_APPS_API_TOKEN` secret on the GitHub repository pointing to it. Creating that Azure resource is a real-world provisioning action with a cost/ownership footprint, so it's deliberately left for the user to trigger explicitly (e.g. via the Azure MCP tools or the Azure Portal) rather than being automated here.

---

## Plan Self-Review Notes

- **Spec coverage:** this plan implements spec Sections 2 (Technology Stack), 8 (Non-Functional — mobile PWA shell, cost-minimizing service tiers, theming/branding), and 9 (Local Development & Tooling). It deliberately does not touch Section 6 (Functional Requirements) — those land in the Auth, Seasons, Match Results, Standings, Live Scoring, and Archive plans that follow.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable code or an exact command with an expected result.
- **Type consistency:** `health`'s signature `(HttpRequest, InvocationContext) => Promise<HttpResponseInit>` is identical across Tasks 5 and 6; `prisma` is imported with the same name and path (`../lib/prisma` from `src/functions`, `../../src/lib/prisma` from `test/functions`) everywhere it's referenced; `branding` is imported with the same shape in `App.tsx` (Task 3) and `vite.config.ts` (Task 4).
