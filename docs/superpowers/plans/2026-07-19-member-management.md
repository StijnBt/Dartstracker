# Member Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin a full CRUD screen for member accounts — list, create, edit (display name, role, active status, password reset) — replacing the seed script as the only way to manage users.

**Architecture:** Backend: three new Azure Functions in `api/src/functions/users/` (`GET /api/users`, `POST /api/users`, `PATCH /api/users/{id}`), each gated by the existing `requireAuth(request, "admin")`, reusing the existing `User` Prisma model, `hashPassword`, and `isRole`. Frontend: an `AdminRoute` guard (same shape as `ProtectedRoute`, plus a role check), three new full-page routes under `/admin/members/*` following the `Login` page's pattern, and a shared `MemberForm` component used by both the create and edit pages.

**Tech Stack:** No new dependencies. Same stack as the Auth phase (Prisma, `@azure/functions` v4 programming model, Vitest, React Testing Library, react-router-dom v7).

## Global Constraints

- "Remove" is a soft delete: set `isActive: false`, never delete the row.
- The admin types the password directly on create/reset — no random-password generation.
- The member form manages both `"admin"` and `"player"` roles via a role picker — not player-only.
- `username` is immutable after creation; the `PATCH` endpoint does not accept it.
- Full-page routes, not modals: `/admin/members`, `/admin/members/new`, `/admin/members/:id/edit`.
- Self-lockout guard: the authenticated admin cannot set their own `role` away from `"admin"` or their own `isActive` to `false`. Enforced server-side (`400`) and mirrored client-side (disabled controls) — the server check is the real enforcement.
- Password minimum length: 8 characters, enforced on both create and update.
- No pagination on the list endpoint — the whole league is ≤30 people.
- `EditMember` pre-fills by calling `listMembers()` and filtering client-side — no dedicated `GET /api/users/{id}` endpoint.
- `Home.tsx` gets a "Manage Members" link, visible only when `user.role === "admin"` — no admin dashboard shell.
- All three backend endpoints call `requireAuth(request, "admin")`.
- No new database migration — the `User` model already has every field needed.

---

### Task 1: `GET /api/users` (list members)

**Files:**
- Create: `api/src/functions/users/list.ts`
- Test: `api/test/functions/users/list.test.ts`

**Interfaces:**
- Consumes: `prisma` (`api/src/lib/prisma.ts`), `requireAuth`/`AuthError` (`api/src/lib/requireAuth.ts`).
- Produces: `listUsers` — named export, registered on route `GET /api/users`. `200` with `{ users: Array<{ id, username, displayName, role, isActive }> }` (never `passwordHash`) for an authenticated admin; `401`/`403` via `AuthError` otherwise. Task 4's `listMembers()` frontend function consumes this exact response shape.

- [ ] **Step 1: Write the failing test — `api/test/functions/users/list.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { listUsers } from "../../../src/functions/users/list";
import { prisma } from "../../../src/lib/prisma";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { user: { findMany: vi.fn() } },
}));

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

const users = [
  {
    id: 1,
    username: "admin",
    passwordHash: "hash1",
    role: "admin",
    displayName: "Administrator",
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 2,
    username: "bsmith",
    passwordHash: "hash2",
    role: "player",
    displayName: "Bob Smith",
    isActive: false,
    createdAt: new Date(),
  },
];

describe("listUsers function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when requireAuth rejects with 401", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(401, "Not authenticated"));
    const result = await listUsers({} as HttpRequest, createContext());
    expect(result.status).toBe(401);
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await listUsers({} as HttpRequest, createContext());
    expect(result.status).toBe(403);
  });

  it("requires the admin role", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    await listUsers({} as HttpRequest, createContext());
    expect(requireAuth).toHaveBeenCalledWith({}, "admin");
  });

  it("returns 200 with all users, excluding passwordHash", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
    vi.mocked(prisma.user.findMany).mockResolvedValue(users);

    const result = await listUsers({} as HttpRequest, createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({
      users: [
        { id: 1, username: "admin", displayName: "Administrator", role: "admin", isActive: true },
        { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: false },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/functions/users/list.ts` does not exist.

- [ ] **Step 3: Create `api/src/functions/users/list.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { requireAuth, AuthError } from "../../lib/requireAuth";

export async function listUsers(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    const users = await prisma.user.findMany({ orderBy: { username: "asc" } });

    return {
      status: 200,
      jsonBody: {
        users: users.map((user) => ({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          isActive: user.isActive,
        })),
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`GET /api/users failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("usersList", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "users",
  handler: listUsers,
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/functions/users/list.ts api/test/functions/users/list.test.ts
git commit -m "Add GET /api/users endpoint to list members"
```

---

### Task 2: `POST /api/users` (create member)

**Files:**
- Create: `api/src/functions/users/create.ts`
- Modify: `api/src/lib/password.ts`
- Test: `api/test/functions/users/create.test.ts`

**Interfaces:**
- Consumes: `prisma`, `hashPassword` + new `MIN_PASSWORD_LENGTH` (`api/src/lib/password.ts`), `requireAuth`/`AuthError`, `isRole` (`api/src/lib/auth-types.ts`).
- Produces: `createUser` — named export, registered on route `POST /api/users`. `201` with `{ user: { id, username, displayName, role, isActive } }` on success; `400` for missing/invalid fields; `401`/`403` via `requireAuth`; `409` `{ error: "Username already exists" }` on a duplicate username. Also produces `MIN_PASSWORD_LENGTH` (number, `8`) from `api/src/lib/password.ts`, which Task 3 also imports.

- [ ] **Step 1: Add `MIN_PASSWORD_LENGTH` to `api/src/lib/password.ts`**

```typescript
import argon2 from "argon2";

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
```

- [ ] **Step 2: Write the failing test — `api/test/functions/users/create.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { createUser } from "../../../src/functions/users/create";
import { prisma } from "../../../src/lib/prisma";
import { hashPassword } from "../../../src/lib/password";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn(), create: vi.fn() } },
}));

vi.mock("../../../src/lib/password", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/password")>("../../../src/lib/password");
  return { ...actual, hashPassword: vi.fn() };
});

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createRequest(body: unknown): HttpRequest {
  return { json: async () => body } as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

const validBody = {
  username: "bsmith",
  displayName: "Bob Smith",
  role: "player",
  password: "secretpw1",
};

const createdUser = {
  id: 2,
  username: "bsmith",
  passwordHash: "hashed",
  role: "player",
  displayName: "Bob Smith",
  isActive: true,
  createdAt: new Date(),
};

describe("createUser function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await createUser(createRequest(validBody), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 400 when username or displayName is missing", async () => {
    const result = await createUser(createRequest({ ...validBody, username: "" }), createContext());
    expect(result.status).toBe(400);
  });

  it("trims username and displayName before storing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(hashPassword).mockResolvedValue("hashed");
    vi.mocked(prisma.user.create).mockResolvedValue(createdUser);

    await createUser(
      createRequest({ ...validBody, username: "  bsmith  ", displayName: "  Bob Smith  " }),
      createContext()
    );

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        username: "bsmith",
        displayName: "Bob Smith",
        role: "player",
        passwordHash: "hashed",
        isActive: true,
      },
    });
  });

  it("returns 400 when role is invalid", async () => {
    const result = await createUser(createRequest({ ...validBody, role: "superadmin" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when password is shorter than 8 characters", async () => {
    const result = await createUser(createRequest({ ...validBody, password: "short" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 409 when the username already exists", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(createdUser);
    const result = await createUser(createRequest(validBody), createContext());
    expect(result.status).toBe(409);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("returns 201 with the created user on success", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(hashPassword).mockResolvedValue("hashed");
    vi.mocked(prisma.user.create).mockResolvedValue(createdUser);

    const result = await createUser(createRequest(validBody), createContext());

    expect(result.status).toBe(201);
    expect(result.jsonBody).toEqual({
      user: { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: true },
    });
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/functions/users/create.ts` does not exist.

- [ ] **Step 4: Create `api/src/functions/users/create.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../../lib/password";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { isRole } from "../../lib/auth-types";

type CreateUserBody = {
  username?: unknown;
  displayName?: unknown;
  role?: unknown;
  password?: unknown;
};

export async function createUser(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await requireAuth(request, "admin");

    let body: CreateUserBody;
    try {
      body = (await request.json()) as CreateUserBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    const username = typeof body.username === "string" ? body.username.trim() : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    const { role, password } = body;

    if (!username || !displayName) {
      return { status: 400, jsonBody: { error: "username and displayName are required" } };
    }
    if (!isRole(role)) {
      return { status: 400, jsonBody: { error: "role must be 'admin' or 'player'" } };
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return {
        status: 400,
        jsonBody: { error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      };
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return { status: 409, jsonBody: { error: "Username already exists" } };
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { username, displayName, role, passwordHash, isActive: true },
    });

    return {
      status: 201,
      jsonBody: {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          isActive: user.isActive,
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`POST /api/users failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("usersCreate", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "users",
  handler: createUser,
});
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — 7 tests passed.

- [ ] **Step 6: Commit**

```bash
git add api/src/functions/users/create.ts api/src/lib/password.ts api/test/functions/users/create.test.ts
git commit -m "Add POST /api/users endpoint to create members"
```

---

### Task 3: `PATCH /api/users/{id}` (edit member)

**Files:**
- Create: `api/src/functions/users/update.ts`
- Test: `api/test/functions/users/update.test.ts`

**Interfaces:**
- Consumes: `prisma`, `hashPassword`/`MIN_PASSWORD_LENGTH` (Task 2), `requireAuth`/`AuthError`, `isRole`.
- Produces: `updateUser` — named export, registered on route `PATCH /api/users/{id}`. Request body `{ displayName?, role?, isActive?, password? }`. `200` with the updated user on success; `400` for invalid fields, an invalid `id`, or the self-lockout case; `404` if `id` doesn't match any user; `401`/`403` via `requireAuth`.

- [ ] **Step 1: Write the failing test — `api/test/functions/users/update.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HttpRequest, InvocationContext } from "@azure/functions";
import { updateUser } from "../../../src/functions/users/update";
import { prisma } from "../../../src/lib/prisma";
import { hashPassword } from "../../../src/lib/password";
import { requireAuth, AuthError } from "../../../src/lib/requireAuth";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("../../../src/lib/password", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/password")>("../../../src/lib/password");
  return { ...actual, hashPassword: vi.fn() };
});

vi.mock("../../../src/lib/requireAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../../../src/lib/requireAuth")>("../../../src/lib/requireAuth");
  return { ...actual, requireAuth: vi.fn() };
});

function createRequest(id: string, body: unknown): HttpRequest {
  return { params: { id }, json: async () => body } as unknown as HttpRequest;
}

function createContext(): InvocationContext {
  return { log: () => {}, error: () => {} } as unknown as InvocationContext;
}

const existingPlayer = {
  id: 2,
  username: "bsmith",
  passwordHash: "hash",
  role: "player",
  displayName: "Bob Smith",
  isActive: true,
  createdAt: new Date(),
};

describe("updateUser function", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ userId: 1, role: "admin" });
  });

  it("returns 403 when the caller is not an admin", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new AuthError(403, "Insufficient permissions"));
    const result = await updateUser(createRequest("2", { displayName: "New Name" }), createContext());
    expect(result.status).toBe(403);
  });

  it("returns 404 when the target user doesn't exist", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const result = await updateUser(createRequest("999", { displayName: "New Name" }), createContext());
    expect(result.status).toBe(404);
  });

  it("returns 400 when displayName is blank", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingPlayer);
    const result = await updateUser(createRequest("2", { displayName: "   " }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when role is invalid", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingPlayer);
    const result = await updateUser(createRequest("2", { role: "superadmin" }), createContext());
    expect(result.status).toBe(400);
  });

  it("returns 400 when password is shorter than 8 characters", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingPlayer);
    const result = await updateUser(createRequest("2", { password: "short" }), createContext());
    expect(result.status).toBe(400);
  });

  it("rejects changing your own role away from admin", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...existingPlayer, id: 1, role: "admin" });
    const result = await updateUser(createRequest("1", { role: "player" }), createContext());
    expect(result.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects deactivating your own account", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...existingPlayer, id: 1, role: "admin" });
    const result = await updateUser(createRequest("1", { isActive: false }), createContext());
    expect(result.status).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("allows deactivating a different user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingPlayer);
    vi.mocked(prisma.user.update).mockResolvedValue({ ...existingPlayer, isActive: false });

    const result = await updateUser(createRequest("2", { isActive: false }), createContext());

    expect(result.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { isActive: false } });
  });

  it("re-hashes the password when a new one is provided", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingPlayer);
    vi.mocked(hashPassword).mockResolvedValue("new-hash");
    vi.mocked(prisma.user.update).mockResolvedValue(existingPlayer);

    await updateUser(createRequest("2", { password: "newpassword1" }), createContext());

    expect(hashPassword).toHaveBeenCalledWith("newpassword1");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { passwordHash: "new-hash" },
    });
  });

  it("returns 200 with the updated user on success", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(existingPlayer);
    vi.mocked(prisma.user.update).mockResolvedValue({ ...existingPlayer, displayName: "Robert Smith" });

    const result = await updateUser(createRequest("2", { displayName: "Robert Smith" }), createContext());

    expect(result.status).toBe(200);
    expect(result.jsonBody).toEqual({
      user: { id: 2, username: "bsmith", displayName: "Robert Smith", role: "player", isActive: true },
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd api && npm test`
Expected: FAIL — `src/functions/users/update.ts` does not exist.

- [ ] **Step 3: Create `api/src/functions/users/update.ts`**

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../../lib/prisma";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../../lib/password";
import { requireAuth, AuthError } from "../../lib/requireAuth";
import { isRole } from "../../lib/auth-types";

type UpdateUserBody = {
  displayName?: unknown;
  role?: unknown;
  isActive?: unknown;
  password?: unknown;
};

type UpdateData = {
  displayName?: string;
  role?: "admin" | "player";
  isActive?: boolean;
  passwordHash?: string;
};

export async function updateUser(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    const { userId: callerId } = await requireAuth(request, "admin");

    const targetId = Number(request.params.id);
    if (!request.params.id || Number.isNaN(targetId)) {
      return { status: 400, jsonBody: { error: "Invalid user id" } };
    }

    let body: UpdateUserBody;
    try {
      body = (await request.json()) as UpdateUserBody;
    } catch {
      return { status: 400, jsonBody: { error: "Invalid request body" } };
    }

    const existing = await prisma.user.findUnique({ where: { id: targetId } });
    if (!existing) {
      return { status: 404, jsonBody: { error: "User not found" } };
    }

    const data: UpdateData = {};

    if (body.displayName !== undefined) {
      if (typeof body.displayName !== "string" || !body.displayName.trim()) {
        return { status: 400, jsonBody: { error: "displayName must be a non-empty string" } };
      }
      data.displayName = body.displayName.trim();
    }

    if (body.role !== undefined) {
      if (!isRole(body.role)) {
        return { status: 400, jsonBody: { error: "role must be 'admin' or 'player'" } };
      }
      if (targetId === callerId && body.role !== "admin") {
        return { status: 400, jsonBody: { error: "You cannot change your own role" } };
      }
      data.role = body.role;
    }

    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") {
        return { status: 400, jsonBody: { error: "isActive must be a boolean" } };
      }
      if (targetId === callerId && body.isActive === false) {
        return { status: 400, jsonBody: { error: "You cannot deactivate your own account" } };
      }
      data.isActive = body.isActive;
    }

    if (body.password !== undefined) {
      if (typeof body.password !== "string" || body.password.length < MIN_PASSWORD_LENGTH) {
        return {
          status: 400,
          jsonBody: { error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        };
      }
      data.passwordHash = await hashPassword(body.password);
    }

    const user = await prisma.user.update({ where: { id: targetId }, data });

    return {
      status: 200,
      jsonBody: {
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          isActive: user.isActive,
        },
      },
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: error.status, jsonBody: { error: error.message } };
    }
    context.error(`PATCH /api/users/{id} failed: ${error}`);
    return { status: 500, jsonBody: { error: "Internal error" } };
  }
}

app.http("usersUpdate", {
  methods: ["PATCH"],
  authLevel: "anonymous",
  route: "users/{id}",
  handler: updateUser,
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd api && npm test`
Expected: PASS — 9 tests passed.

- [ ] **Step 5: Commit**

```bash
git add api/src/functions/users/update.ts api/test/functions/users/update.test.ts
git commit -m "Add PATCH /api/users/{id} endpoint to edit members"
```

---

### Task 4: Frontend API client for member management

**Files:**
- Modify: `src/lib/api-client.ts`
- Test: `src/lib/api-client.test.ts`

**Interfaces:**
- Produces: `Member` type (`{ id: number; username: string; displayName: string; role: "admin" | "player"; isActive: boolean }`), `CreateMemberInput` type (`{ username, displayName, role, password }`, all required strings except `role: "admin" | "player"`), `UpdateMemberInput` type (`{ displayName?, role?, isActive?, password? }`), `listMembers(): Promise<Member[]>`, `createMember(input: CreateMemberInput): Promise<Member>`, `updateMember(id: number, input: UpdateMemberInput): Promise<Member>` — all named exports from `src/lib/api-client.ts`. Tasks 6, 8, and 9 import these.

- [ ] **Step 1: Write the failing tests — append to `src/lib/api-client.test.ts`**

Add these imports to the top of the file (alongside the existing `login, logout, fetchCurrentUser` import):

```typescript
import { login, logout, fetchCurrentUser, listMembers, createMember, updateMember } from "./api-client";
```

Add these `describe` blocks at the end of the file, inside the existing outer `describe("api-client", ...)` block (after the `logout` block, before its closing `});`):

```typescript
  describe("listMembers", () => {
    it("fetches and returns all members", async () => {
      const users = [
        { id: 1, username: "admin", displayName: "Administrator", role: "admin", isActive: true },
        { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: false },
      ];
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ users }), { status: 200 }));

      const result = await listMembers();

      expect(fetch).toHaveBeenCalledWith("/api/users", expect.objectContaining({ credentials: "same-origin" }));
      expect(result).toEqual(users);
    });
  });

  describe("createMember", () => {
    it("posts the new member and returns it", async () => {
      const user = { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: true };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ user }), { status: 201 }));

      const result = await createMember({
        username: "bsmith",
        displayName: "Bob Smith",
        role: "player",
        password: "secretpw1",
      });

      expect(fetch).toHaveBeenCalledWith(
        "/api/users",
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
          body: JSON.stringify({
            username: "bsmith",
            displayName: "Bob Smith",
            role: "player",
            password: "secretpw1",
          }),
        })
      );
      expect(result).toEqual(user);
    });

    it("throws the server's error message on failure", async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: "Username already exists" }), { status: 409 })
      );

      await expect(
        createMember({ username: "admin", displayName: "Dup", role: "player", password: "secretpw1" })
      ).rejects.toThrow("Username already exists");
    });
  });

  describe("updateMember", () => {
    it("patches the member and returns it", async () => {
      const user = { id: 2, username: "bsmith", displayName: "Robert Smith", role: "player", isActive: true };
      vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ user }), { status: 200 }));

      const result = await updateMember(2, { displayName: "Robert Smith" });

      expect(fetch).toHaveBeenCalledWith(
        "/api/users/2",
        expect.objectContaining({
          method: "PATCH",
          credentials: "same-origin",
          body: JSON.stringify({ displayName: "Robert Smith" }),
        })
      );
      expect(result).toEqual(user);
    });
  });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `listMembers`/`createMember`/`updateMember` are not exported from `./api-client`.

- [ ] **Step 3: Add the new types and functions to `src/lib/api-client.ts`**

Append this to the end of the file (after the existing `logout` function):

```typescript
export type Member = {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "player";
  isActive: boolean;
};

export type CreateMemberInput = {
  username: string;
  displayName: string;
  role: "admin" | "player";
  password: string;
};

export type UpdateMemberInput = {
  displayName?: string;
  role?: "admin" | "player";
  isActive?: boolean;
  password?: string;
};

export async function listMembers(): Promise<Member[]> {
  const response = await fetch("/api/users", { credentials: "same-origin" });
  const data = await parseJsonResponse<{ users: Member[] }>(response);
  return data.users;
}

export async function createMember(input: CreateMemberInput): Promise<Member> {
  const response = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ user: Member }>(response);
  return data.user;
}

export async function updateMember(id: number, input: UpdateMemberInput): Promise<Member> {
  const response = await fetch(`/api/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  const data = await parseJsonResponse<{ user: Member }>(response);
  return data.user;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — 9 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api-client.ts src/lib/api-client.test.ts
git commit -m "Add frontend API client functions for member management"
```

---

### Task 5: `AdminRoute` guard

**Files:**
- Create: `src/components/AdminRoute.tsx`
- Test: `src/components/AdminRoute.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (`src/lib/AuthContext.tsx`).
- Produces: `AdminRoute` — named export, a component that renders nothing while `loading`, redirects to `/login` when there's no `user`, redirects to `/` when `user.role !== "admin"`, and renders `<Outlet />` otherwise. Task 10 registers this on the `/admin/members/*` routes.

- [ ] **Step 1: Write the failing test — `src/components/AdminRoute.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { AdminRoute } from "./AdminRoute";
import { useAuth } from "../lib/AuthContext";

vi.mock("../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/" element={<div>Home page</div>} />
        <Route element={<AdminRoute />}>
          <Route path="/admin/members" element={<div>Admin content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("AdminRoute", () => {
  it("renders nothing while auth state is loading", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: true, login: vi.fn(), logout: vi.fn() });
    const { container } = renderWithRouter("/admin/members");
    expect(container).toBeEmptyDOMElement();
  });

  it("redirects to /login when there is no user", () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false, login: vi.fn(), logout: vi.fn() });
    renderWithRouter("/admin/members");
    expect(screen.getByText("Login page")).toBeInTheDocument();
  });

  it("redirects to / when the logged-in user is not an admin", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 2, username: "bsmith", role: "player", displayName: "Bob Smith" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    renderWithRouter("/admin/members");
    expect(screen.getByText("Home page")).toBeInTheDocument();
  });

  it("renders the admin content when the logged-in user is an admin", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    renderWithRouter("/admin/members");
    expect(screen.getByText("Admin content")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/components/AdminRoute.tsx` does not exist.

- [ ] **Step 3: Create `src/components/AdminRoute.tsx`**

```tsx
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

export function AdminRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/AdminRoute.tsx src/components/AdminRoute.test.tsx
git commit -m "Add AdminRoute guard for admin-only routes"
```

---

### Task 6: Members list page

**Files:**
- Create: `src/pages/admin/Members.tsx`
- Test: `src/pages/admin/Members.test.tsx`

**Interfaces:**
- Consumes: `listMembers`, `type Member` (Task 4).
- Produces: `Members` — default-exported component. Fetches and lists all members on mount; each row links to `/admin/members/{id}/edit`; an "+ Add" link points to `/admin/members/new`. Task 10 registers this on the `/admin/members` route.

- [ ] **Step 1: Write the failing test — `src/pages/admin/Members.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import Members from "./Members";
import * as apiClient from "../../lib/api-client";

vi.mock("../../lib/api-client");

describe("Members", () => {
  it("lists all members with their role and active status", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue([
      { id: 1, username: "admin", displayName: "Administrator", role: "admin", isActive: true },
      { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: false },
    ]);

    render(
      <MemoryRouter>
        <Members />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Administrator")).toBeInTheDocument();
    });
    expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("inactive")).toBeInTheDocument();
  });

  it("links each row to its edit page", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue([
      { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: true },
    ]);

    render(
      <MemoryRouter>
        <Members />
      </MemoryRouter>
    );

    await waitFor(() => screen.getByText("Bob Smith"));
    expect(screen.getByRole("link", { name: /Bob Smith/ })).toHaveAttribute("href", "/admin/members/2/edit");
  });

  it("links the Add button to the new-member page", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue([]);
    render(
      <MemoryRouter>
        <Members />
      </MemoryRouter>
    );
    await waitFor(() => expect(apiClient.listMembers).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "+ Add" })).toHaveAttribute("href", "/admin/members/new");
  });

  it("shows an error message when loading fails", async () => {
    vi.mocked(apiClient.listMembers).mockRejectedValue(new Error("Failed to load members"));

    render(
      <MemoryRouter>
        <Members />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Failed to load members");
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/pages/admin/Members.tsx` does not exist.

- [ ] **Step 3: Create `src/pages/admin/Members.tsx`**

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listMembers, type Member } from "../../lib/api-client";

export default function Members() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMembers()
      .then(setMembers)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load members"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-primary font-heading text-2xl font-bold">Members</h1>
        <Link to="/admin/members/new" className="bg-primary text-primary-content rounded px-3 py-2">
          + Add
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {members.map((member) => (
            <li key={member.id}>
              <Link to={`/admin/members/${member.id}/edit`} className="flex items-center justify-between py-3">
                <span>
                  <span className="font-medium">{member.displayName}</span>{" "}
                  <span className="text-sm text-gray-500">({member.role})</span>
                </span>
                <span className="text-sm text-gray-500">{member.isActive ? "active" : "inactive"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/Members.tsx src/pages/admin/Members.test.tsx
git commit -m "Add Members list page"
```

---

### Task 7: `MemberForm` shared component

**Files:**
- Create: `src/pages/admin/MemberForm.tsx`
- Test: `src/pages/admin/MemberForm.test.tsx`

**Interfaces:**
- Produces: `MemberFormValues` type (`{ username: string; displayName: string; role: "admin" | "player"; isActive: boolean; password: string }`) and a default-exported `MemberForm` component with props `{ mode: "create" | "edit"; initialValues?: Omit<MemberFormValues, "password">; disableRoleAndStatus?: boolean; onSubmit: (values: MemberFormValues) => Promise<void> }`, both from `src/pages/admin/MemberForm.tsx`. In `"create"` mode: username is an editable required text field, password is required, no status field. In `"edit"` mode: username is displayed as fixed read-only text, password is optional ("leave blank to keep current"), and a status (active/inactive) field is shown. When `disableRoleAndStatus` is true, the role and status controls are disabled. Client-side validation blocks submission when a non-empty password is shorter than 8 characters (mirroring the backend's `MIN_PASSWORD_LENGTH`), and blocks a create submission with no password at all. On submit, calls `onSubmit` with the current field values; on rejection, displays the thrown error's message in a `role="alert"` element. Tasks 8 and 9 import `MemberForm` and `MemberFormValues`.

- [ ] **Step 1: Write the failing test — `src/pages/admin/MemberForm.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import MemberForm from "./MemberForm";

describe("MemberForm", () => {
  it("shows an editable username field and a required password field in create mode", () => {
    render(<MemberForm mode="create" onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeRequired();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  });

  it("shows a fixed username and an optional password field in edit mode", () => {
    render(
      <MemberForm
        mode="edit"
        initialValues={{ username: "bsmith", displayName: "Bob Smith", role: "player", isActive: true }}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    expect(screen.getByText("bsmith")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).not.toBeRequired();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
  });

  it("disables role and status when disableRoleAndStatus is set", () => {
    render(
      <MemberForm
        mode="edit"
        initialValues={{ username: "admin", displayName: "Administrator", role: "admin", isActive: true }}
        disableRoleAndStatus
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Role")).toBeDisabled();
    expect(screen.getByLabelText("Status")).toBeDisabled();
  });

  it("rejects a create submission with a password shorter than 8 characters", async () => {
    const onSubmit = vi.fn();
    render(<MemberForm mode="create" onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Username"), "bsmith");
    await userEvent.type(screen.getByLabelText("Display name"), "Bob Smith");
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("at least 8 characters");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the entered values in create mode", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MemberForm mode="create" onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Username"), "bsmith");
    await userEvent.type(screen.getByLabelText("Display name"), "Bob Smith");
    await userEvent.type(screen.getByLabelText("Password"), "secretpw1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        username: "bsmith",
        displayName: "Bob Smith",
        role: "player",
        isActive: true,
        password: "secretpw1",
      });
    });
  });

  it("allows submitting in edit mode with a blank password", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <MemberForm
        mode="edit"
        initialValues={{ username: "bsmith", displayName: "Bob Smith", role: "player", isActive: true }}
        onSubmit={onSubmit}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        username: "bsmith",
        displayName: "Bob Smith",
        role: "player",
        isActive: true,
        password: "",
      });
    });
  });

  it("shows an error message when onSubmit rejects", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Username already exists"));
    render(<MemberForm mode="create" onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Username"), "admin");
    await userEvent.type(screen.getByLabelText("Display name"), "Dup");
    await userEvent.type(screen.getByLabelText("Password"), "secretpw1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Username already exists");
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/pages/admin/MemberForm.tsx` does not exist.

- [ ] **Step 3: Create `src/pages/admin/MemberForm.tsx`**

```tsx
import { useState, type FormEvent } from "react";

export type MemberFormValues = {
  username: string;
  displayName: string;
  role: "admin" | "player";
  isActive: boolean;
  password: string;
};

type MemberFormProps = {
  mode: "create" | "edit";
  initialValues?: Omit<MemberFormValues, "password">;
  disableRoleAndStatus?: boolean;
  onSubmit: (values: MemberFormValues) => Promise<void>;
};

const MIN_PASSWORD_LENGTH = 8;

export default function MemberForm({
  mode,
  initialValues,
  disableRoleAndStatus = false,
  onSubmit,
}: MemberFormProps) {
  const [username, setUsername] = useState(initialValues?.username ?? "");
  const [displayName, setDisplayName] = useState(initialValues?.displayName ?? "");
  const [role, setRole] = useState<"admin" | "player">(initialValues?.role ?? "player");
  const [isActive, setIsActive] = useState(initialValues?.isActive ?? true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const passwordProvided = password.length > 0;
    if ((mode === "create" && !passwordProvided) || (passwordProvided && password.length < MIN_PASSWORD_LENGTH)) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({ username, displayName, role, isActive, password });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
      <div>
        {mode === "create" ? (
          <>
            <label htmlFor="username" className="block text-sm font-medium">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-2"
            />
          </>
        ) : (
          <>
            <span className="block text-sm font-medium">Username</span>
            <p className="mt-1 w-full rounded border border-gray-200 bg-gray-50 p-2 text-gray-600">{username}</p>
          </>
        )}
      </div>
      <div>
        <label htmlFor="displayName" className="block text-sm font-medium">
          Display name
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 p-2"
        />
      </div>
      <div>
        <label htmlFor="role" className="block text-sm font-medium">
          Role
        </label>
        <select
          id="role"
          name="role"
          value={role}
          disabled={disableRoleAndStatus}
          onChange={(e) => setRole(e.target.value as "admin" | "player")}
          className="mt-1 w-full rounded border border-gray-300 p-2 disabled:opacity-50"
        >
          <option value="player">Player</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      {mode === "edit" && (
        <div>
          <label htmlFor="isActive" className="block text-sm font-medium">
            Status
          </label>
          <select
            id="isActive"
            name="isActive"
            value={isActive ? "active" : "inactive"}
            disabled={disableRoleAndStatus}
            onChange={(e) => setIsActive(e.target.value === "active")}
            className="mt-1 w-full rounded border border-gray-300 p-2 disabled:opacity-50"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      )}
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          {mode === "create" ? "Password" : "New password"}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required={mode === "create"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 p-2"
        />
        {mode === "edit" && (
          <p className="mt-1 text-sm text-gray-500">Leave blank to keep the current password.</p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="bg-primary text-primary-content font-heading w-full rounded p-2 disabled:opacity-50"
      >
        {submitting ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/MemberForm.tsx src/pages/admin/MemberForm.test.tsx
git commit -m "Add shared MemberForm component for create/edit"
```

---

### Task 8: New member page

**Files:**
- Create: `src/pages/admin/NewMember.tsx`
- Test: `src/pages/admin/NewMember.test.tsx`

**Interfaces:**
- Consumes: `MemberForm`, `type MemberFormValues` (Task 7), `createMember` (Task 4), `useNavigate` (`react-router-dom`).
- Produces: `NewMember` — default-exported component. Renders `MemberForm` in `"create"` mode; on submit, calls `createMember` and navigates to `/admin/members`. Task 10 registers this on the `/admin/members/new` route.

- [ ] **Step 1: Write the failing test — `src/pages/admin/NewMember.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import NewMember from "./NewMember";
import * as apiClient from "../../lib/api-client";

vi.mock("../../lib/api-client");

function renderWithRouter() {
  return render(
    <MemoryRouter initialEntries={["/admin/members/new"]}>
      <Routes>
        <Route path="/admin/members/new" element={<NewMember />} />
        <Route path="/admin/members" element={<div>Members list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("NewMember", () => {
  it("creates the member and navigates to the members list on success", async () => {
    vi.mocked(apiClient.createMember).mockResolvedValue({
      id: 2,
      username: "bsmith",
      displayName: "Bob Smith",
      role: "player",
      isActive: true,
    });

    renderWithRouter();

    await userEvent.type(screen.getByLabelText("Username"), "bsmith");
    await userEvent.type(screen.getByLabelText("Display name"), "Bob Smith");
    await userEvent.type(screen.getByLabelText("Password"), "secretpw1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiClient.createMember).toHaveBeenCalledWith({
        username: "bsmith",
        displayName: "Bob Smith",
        role: "player",
        password: "secretpw1",
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Members list")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/pages/admin/NewMember.tsx` does not exist.

- [ ] **Step 3: Create `src/pages/admin/NewMember.tsx`**

```tsx
import { useNavigate } from "react-router-dom";
import MemberForm, { type MemberFormValues } from "./MemberForm";
import { createMember } from "../../lib/api-client";

export default function NewMember() {
  const navigate = useNavigate();

  async function handleSubmit(values: MemberFormValues) {
    await createMember({
      username: values.username,
      displayName: values.displayName,
      role: values.role,
      password: values.password,
    });
    navigate("/admin/members");
  }

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">Add Member</h1>
      <MemberForm mode="create" onSubmit={handleSubmit} />
    </div>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — 1 test passed.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/NewMember.tsx src/pages/admin/NewMember.test.tsx
git commit -m "Add NewMember page"
```

---

### Task 9: Edit member page

**Files:**
- Create: `src/pages/admin/EditMember.tsx`
- Test: `src/pages/admin/EditMember.test.tsx`

**Interfaces:**
- Consumes: `MemberForm`, `type MemberFormValues` (Task 7), `listMembers`, `updateMember`, `type Member`, `type UpdateMemberInput` (Task 4), `useAuth` (`src/lib/AuthContext.tsx`), `useParams`/`useNavigate` (`react-router-dom`).
- Produces: `EditMember` — default-exported component. Reads `id` from the route, calls `listMembers()` on mount and finds the matching member client-side; shows a `role="alert"` error if no member matches. Renders `MemberForm` in `"edit"` mode, pre-filled with the found member, with `disableRoleAndStatus` set when the found member's `id` equals the logged-in user's own `id`. On submit, calls `updateMember(id, {...})` (including `password` only when non-empty) and navigates to `/admin/members`. Task 10 registers this on the `/admin/members/:id/edit` route.

- [ ] **Step 1: Write the failing test — `src/pages/admin/EditMember.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import EditMember from "./EditMember";
import * as apiClient from "../../lib/api-client";
import { useAuth } from "../../lib/AuthContext";

vi.mock("../../lib/api-client");
vi.mock("../../lib/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const members: apiClient.Member[] = [
  { id: 1, username: "admin", displayName: "Administrator", role: "admin", isActive: true },
  { id: 2, username: "bsmith", displayName: "Bob Smith", role: "player", isActive: true },
];

function renderWithRouter(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/admin/members/${id}/edit`]}>
      <Routes>
        <Route path="/admin/members/:id/edit" element={<EditMember />} />
        <Route path="/admin/members" element={<div>Members list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("EditMember", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
  });

  it("pre-fills the form with the matching member's data", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter("2");

    await waitFor(() => {
      expect(screen.getByDisplayValue("Bob Smith")).toBeInTheDocument();
    });
    expect(screen.getByText("bsmith")).toBeInTheDocument();
  });

  it("shows an error when no member matches the id", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter("999");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Member not found");
    });
  });

  it("disables role and status when editing your own account", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter("1");

    await waitFor(() => {
      expect(screen.getByLabelText("Role")).toBeDisabled();
    });
    expect(screen.getByLabelText("Status")).toBeDisabled();
  });

  it("does not disable role and status when editing a different account", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    renderWithRouter("2");

    await waitFor(() => {
      expect(screen.getByLabelText("Role")).not.toBeDisabled();
    });
  });

  it("updates the member and navigates to the members list on success", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    vi.mocked(apiClient.updateMember).mockResolvedValue({ ...members[1], displayName: "Robert Smith" });

    renderWithRouter("2");

    await waitFor(() => screen.getByDisplayValue("Bob Smith"));
    await userEvent.clear(screen.getByLabelText("Display name"));
    await userEvent.type(screen.getByLabelText("Display name"), "Robert Smith");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiClient.updateMember).toHaveBeenCalledWith(2, {
        displayName: "Robert Smith",
        role: "player",
        isActive: true,
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Members list")).toBeInTheDocument();
    });
  });

  it("includes the new password only when one was entered", async () => {
    vi.mocked(apiClient.listMembers).mockResolvedValue(members);
    vi.mocked(apiClient.updateMember).mockResolvedValue(members[1]);

    renderWithRouter("2");

    await waitFor(() => screen.getByDisplayValue("Bob Smith"));
    await userEvent.type(screen.getByLabelText("New password"), "newsecretpw1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiClient.updateMember).toHaveBeenCalledWith(2, {
        displayName: "Bob Smith",
        role: "player",
        isActive: true,
        password: "newsecretpw1",
      });
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `src/pages/admin/EditMember.tsx` does not exist.

- [ ] **Step 3: Create `src/pages/admin/EditMember.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import MemberForm, { type MemberFormValues } from "./MemberForm";
import { listMembers, updateMember, type Member, type UpdateMemberInput } from "../../lib/api-client";
import { useAuth } from "../../lib/AuthContext";

export default function EditMember() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMembers()
      .then((members) => {
        const found = members.find((m) => String(m.id) === id);
        if (!found) {
          setError("Member not found");
        } else {
          setMember(found);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load member"))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubmit(values: MemberFormValues) {
    const update: UpdateMemberInput = {
      displayName: values.displayName,
      role: values.role,
      isActive: values.isActive,
    };
    if (values.password) {
      update.password = values.password;
    }
    await updateMember(Number(id), update);
    navigate("/admin/members");
  }

  if (loading) {
    return <p className="p-4">Loading…</p>;
  }

  if (error || !member) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        {error ?? "Member not found"}
      </p>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">Edit Member</h1>
      <MemberForm
        mode="edit"
        initialValues={member}
        disableRoleAndStatus={currentUser?.id === member.id}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/EditMember.tsx src/pages/admin/EditMember.test.tsx
git commit -m "Add EditMember page"
```

---

### Task 10: Wire `App.tsx` routing and the `Home.tsx` navigation link

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/pages/Home.tsx`
- Modify: `src/pages/Home.test.tsx`

**Interfaces:**
- Consumes: `AdminRoute` (Task 5), `Members` (Task 6), `NewMember` (Task 8), `EditMember` (Task 9).
- Produces: `App` now registers `/admin/members`, `/admin/members/new`, and `/admin/members/:id/edit` behind `AdminRoute`. `Home` renders a "Manage Members" link (pointing to `/admin/members`) only when the logged-in user's `role` is `"admin"`.

- [ ] **Step 1: Write the failing test — add to `src/pages/Home.test.tsx`**

Add this `describe` block after the existing `describe("Home", ...)` block's closing `});`:

```tsx
describe("Home navigation", () => {
  it("shows a Manage Members link for an admin", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 1, username: "admin", role: "admin", displayName: "Administrator" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
    });
    render(
      <MemoryRouter>
        <Home />
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
        <Home />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: "Manage Members" })).not.toBeInTheDocument();
  });
});
```

Add `MemoryRouter` to the existing `@testing-library/react`/`react-router-dom` imports at the top of the file — the full import block becomes:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import Home from "./Home";
import { branding } from "../branding";
import { useAuth } from "../lib/AuthContext";
```

Also wrap the three existing `render(<Home />)` calls (in the pre-existing `describe("Home", ...)` tests) in `<MemoryRouter>`, e.g.:

```tsx
render(
  <MemoryRouter>
    <Home />
  </MemoryRouter>
);
```

(`Home` will use `Link` from `react-router-dom` after Step 3, which requires a router context to render at all — every test that renders `<Home />` needs this wrapper, not just the new ones.)

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — either a "Manage Members" link is not found, or (before wrapping the old tests in `MemoryRouter`) a `useNavigate()/Link` outside-router error.

- [ ] **Step 3: Update `src/pages/Home.tsx`**

```tsx
import { Link } from "react-router-dom";
import { branding } from "../branding";
import { useAuth } from "../lib/AuthContext";

export default function Home() {
  const { user, logout } = useAuth();

  return (
    <div className="flex items-center gap-3 p-4">
      <img src={branding.logoSrc} alt={branding.appName} width={40} height={40} />
      <h1 className="text-primary font-heading text-3xl font-bold">{branding.appName}</h1>
      {user && (
        <div className="ml-auto flex items-center gap-3">
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

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — `Home.test.tsx` fully green (5 tests: 3 existing + 2 new).

- [ ] **Step 5: Write the failing test — add to `src/App.test.tsx`**

Replace the file's import block and add a new test. Full updated `src/App.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "./App";
import * as apiClient from "./lib/api-client";

vi.mock("./lib/api-client");

describe("App", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("redirects to the login page when there is no active session", async () => {
    vi.mocked(apiClient.fetchCurrentUser).mockResolvedValue(null);
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument();
    });
  });

  it("renders the home page when a session is active", async () => {
    vi.mocked(apiClient.fetchCurrentUser).mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "Administrator",
    });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Administrator")).toBeInTheDocument();
    });
  });

  it("navigates to the members list when an admin clicks Manage Members", async () => {
    vi.mocked(apiClient.fetchCurrentUser).mockResolvedValue({
      id: 1,
      username: "admin",
      role: "admin",
      displayName: "Administrator",
    });
    vi.mocked(apiClient.listMembers).mockResolvedValue([]);

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Administrator")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("link", { name: "Manage Members" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 6: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `App` doesn't yet register the `/admin/members` route, so the "Manage Members" link click has nowhere to navigate to (the heading assertion times out).

- [ ] **Step 7: Update `src/App.tsx`**

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminRoute } from "./components/AdminRoute";
import Login from "./pages/auth/Login";
import Home from "./pages/Home";
import Members from "./pages/admin/Members";
import NewMember from "./pages/admin/NewMember";
import EditMember from "./pages/admin/EditMember";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Home />} />
          </Route>
          <Route element={<AdminRoute />}>
            <Route path="/admin/members" element={<Members />} />
            <Route path="/admin/members/new" element={<NewMember />} />
            <Route path="/admin/members/:id/edit" element={<EditMember />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
```

- [ ] **Step 8: Run the tests and verify they pass**

Run: `npm test`
Expected: PASS — all frontend tests passing.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/pages/Home.tsx src/pages/Home.test.tsx
git commit -m "Wire admin member routes into App and link from Home"
```

---

### Task 11: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Start the full local stack**

From the repo root:
```bash
docker compose up -d
```

From `api/`:
```bash
npm run build
npm run azurite
```
(in a separate terminal, leave running)

Then, still from `api/` (separate terminal, leave running):
```bash
func start
```
Wait for it to log all four functions, including `usersList`, `usersCreate`, `usersUpdate`, `authLogin`, `authMe`, `authLogout`, and `health`.

Then, from the repo root (separate terminal):
```bash
npm run dev:swa -- --api-devserver-url http://localhost:7071
```

If `func start` fails with a Functions Core Tools download error, see the local-dev workaround from the Auth phase (install `azure-functions-core-tools@4` globally and manually extract its zip if the postinstall step doesn't) before proceeding.

- [ ] **Step 2: Ensure the admin account exists**

From `api/`:
```bash
npm run db:seed
```
Expected: creates (or confirms) the `admin` / `ChangeMe123!` account.

- [ ] **Step 3: Verify the new endpoints via curl**

```bash
curl -i -c /tmp/cookies.txt -X POST http://localhost:4280/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"ChangeMe123!"}'
```
Expected: `200` with a `Set-Cookie: authToken=...`.

```bash
curl -i -b /tmp/cookies.txt http://localhost:4280/api/users
```
Expected: `200` with `{"users":[{"username":"admin", ...}]}`.

```bash
curl -i -b /tmp/cookies.txt -X POST http://localhost:4280/api/users \
  -H "Content-Type: application/json" \
  -d '{"username":"testplayer","displayName":"Test Player","role":"player","password":"testpassword1"}'
```
Expected: `201` with the created user. Note the returned `id`.

```bash
curl -i -b /tmp/cookies.txt -X POST http://localhost:4280/api/users \
  -H "Content-Type: application/json" \
  -d '{"username":"testplayer","displayName":"Dup","role":"player","password":"testpassword1"}'
```
Expected: `409` (duplicate username).

```bash
curl -i -b /tmp/cookies.txt -X PATCH http://localhost:4280/api/users/1 \
  -H "Content-Type: application/json" \
  -d '{"isActive":false}'
```
(Replace `1` with the admin's own id from Step 3's `GET /api/users` response if different.)
Expected: `400` — the self-lockout guard rejects deactivating your own account.

```bash
curl -i -X POST http://localhost:4280/api/auth/logout -b /tmp/cookies.txt
```

- [ ] **Step 4: Verify the browser flow with Playwright MCP**

Log in as `admin` / `ChangeMe123!`. Confirm a "Manage Members" link appears on the home page; click it — expect the members list showing `admin` and `testplayer` (from Step 3).

Click "+ Add", create a new player (e.g. username `player2`, display name `Player Two`, password `playertwopw1`). Confirm it appears in the list as active.

Click into `player2`'s edit page: confirm the username is shown as fixed text (not an editable field), change the display name, leave the password blank, save — confirm the change is reflected in the list.

Click into the admin's own row (the currently logged-in account): confirm the Role and Status dropdowns are disabled.

Click into `player2`'s edit page again, set Status to "Inactive", save. Log out. Attempt to log in as `player2` / `playertwopw1` — expect it to fail (generic invalid-credentials message), confirming a deactivated account can no longer authenticate.

Log back in as `admin`, edit `testplayer`, reset its password to a new value; log out and confirm the new password logs `testplayer` in successfully while the old one no longer works.

Finally, while logged in as `testplayer` (an active player, not admin): confirm no "Manage Members" link appears on the home page, and confirm navigating the browser directly to `/admin/members` redirects to `/` rather than showing the members list.

- [ ] **Step 5: Confirm both test suites still pass**

```bash
cd api && npm test
```
Expected: all backend tests passing.

```bash
npm test
```
(from the repo root)
Expected: all frontend tests passing.

---

## Plan Self-Review Notes

- **Spec coverage:** implements every section of `docs/superpowers/specs/2026-07-19-member-management-design.md` — Section 2 (soft delete via `isActive`, no schema change) in Task 1's `list.ts` and Task 3's `update.ts`; Section 3's three endpoints and their exact status codes/response shapes in Tasks 1–3; Section 4's `api-client` additions, `AdminRoute`, the three routes, `MemberForm`, and the `Home` nav link in Tasks 4–10; Section 5's error handling (empty state, `409` duplicate, self-lockout, deactivated-while-logged-in — the last of which needed no new code, per the design) is exercised across Tasks 1–10's tests and Task 11's manual pass; Section 6's testing approach (Vitest for each endpoint, RTL for each frontend piece, manual E2E to close) is Tasks 1–11 themselves.
- **Placeholder scan:** no TBD/TODO markers. Every step has runnable code or an exact command with an expected result.
- **Type consistency:** `Member`/`CreateMemberInput`/`UpdateMemberInput` (Task 4) are the single source of truth for the API shapes, consumed identically by Tasks 6, 8, and 9. `MemberFormValues` (Task 7) is the single source of truth for the form's internal shape, consumed identically by Tasks 8 and 9. `MIN_PASSWORD_LENGTH` (Task 2, in `password.ts`) is imported by Task 3's `update.ts` rather than redefined. The backend response shape `{ id, username, displayName, role, isActive }` (never `passwordHash`) is identical across Tasks 1, 2, and 3.
