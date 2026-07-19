# Member Management — Design

Status: approved design, ready for implementation planning.
Source: brainstorming session following the Auth phase (PR #2, merged). Implements the "Member management" slice of Section 3.9 (Admin Panel) from `docs/superpowers/specs/2026-07-15-darts-league-app-design.md` — add/edit/remove players, create/reset passwords.

## 1. Overview

An admin-only screen for managing member accounts: list existing members, create new ones, and edit an existing member's display name, role, active status, and password. This is the first module of the eventual Admin Panel (competition and match management are later, separate phases) and unblocks those phases by giving the admin a way to onboard real players beyond the single seeded admin account.

Out of scope: self-service registration (still explicitly disallowed per the app's auth model), bulk import, and any competition/match-management UI.

## 2. Data Model

No schema changes. The `User` model added in the Auth phase already has every field this feature needs: `id`, `username` (unique), `passwordHash`, `role` (`"admin" | "player"`), `displayName`, `isActive`, `createdAt`.

**"Remove" is a soft delete.** Deactivating a member sets `isActive: false` rather than deleting the row — this preserves referential integrity for match/season data that will reference players by id in later phases, and matches the existing Auth-phase behavior where `GET /api/auth/me` already treats an inactive user as logged out.

## 3. Backend API

New module `api/src/functions/users/`, following the same structure as the existing `auth/` module. All three endpoints call `requireAuth(request, "admin")`; a non-admin caller gets the existing middleware's `403`.

### `GET /api/users`
Returns every member (no pagination — the whole league is ≤30 people).

```
200 { users: Array<{ id, username, displayName, role, isActive }> }
```
`passwordHash` is never included in any response.

### `POST /api/users`
Creates a member.

Request: `{ username, displayName, role, password }`
- `username`, `displayName`, `password`: required non-empty strings. `username` and `displayName` are trimmed before validation/storage, so whitespace-only or whitespace-padded values are rejected/normalized rather than silently creating a near-duplicate username.
- `role`: must satisfy the existing `isRole` guard (`"admin" | "player"`).
- `password`: minimum 8 characters (new baseline rule — not enforced anywhere else in the codebase today).
- Password is hashed via the existing `hashPassword` from `api/src/lib/password.ts`.

Responses:
- `201 { user: { id, username, displayName, role, isActive } }` on success.
- `400 { error: string }` for missing/invalid fields.
- `409 { error: "Username already exists" }` on a uniqueness conflict (the DB's existing `@unique` constraint on `username`).

### `PATCH /api/users/{id}`
Edits a member. `username` is immutable and not accepted here.

Request: `{ displayName?, role?, isActive?, password? }` — all optional, send only what changed.
- `password`, if present, must meet the same 8-character minimum and is re-hashed.
- `role`, if present, must satisfy `isRole`.

**Self-lockout guard:** if `id` matches the authenticated caller's own `userId` (from `requireAuth`), reject (`400`) any attempt to set `role` to something other than `"admin"` or `isActive` to `false`. This prevents the admin from locking themselves (and therefore everyone) out of account management.

Responses:
- `200 { user: { id, username, displayName, role, isActive } }` on success.
- `400 { error: string }` for missing target, invalid fields, or the self-lockout case above.
- `404 { error: "User not found" }` if `id` doesn't exist.

## 4. Frontend

### API client
`src/lib/api-client.ts` gains three functions, following the existing `login`/`logout`/`fetchCurrentUser` pattern (`credentials: "same-origin"`, throw the server's `error` message on failure):
- `listMembers(): Promise<Member[]>`
- `createMember(data): Promise<Member>`
- `updateMember(id, data): Promise<Member>`

### Route guard
`src/components/AdminRoute.tsx` — same shape as `ProtectedRoute`: renders nothing while `loading`, redirects to `/login` if no user, redirects to `/` if `user.role !== "admin"`, otherwise renders `<Outlet />`.

### Routes & pages
New `src/pages/admin/` directory:

| Route | Component | Purpose |
|---|---|---|
| `/admin/members` | `Members.tsx` | Lists all members (username, displayName, role, active/inactive badge); each row links to its edit page; "+ Add" links to `/admin/members/new`. |
| `/admin/members/new` | `NewMember.tsx` | Thin wrapper around `MemberForm` in create mode. |
| `/admin/members/:id/edit` | `EditMember.tsx` | Thin wrapper around `MemberForm` in edit mode. Pre-fills by calling `listMembers()` and finding the matching `id` client-side — no dedicated single-user GET endpoint, since a second list call is cheap at this data size. |

`MemberForm.tsx` is a shared (non-routed) component handling the differences between the two modes: create requires a password and starts blank; edit shows username as fixed read-only text, makes password optional ("leave blank to keep current password"), and includes role/status controls. When editing the currently-logged-in admin's own account, the role and status controls are disabled client-side, mirroring the server's self-lockout guard (the server-side check is the real enforcement; this is just earlier, friendlier feedback).

`App.tsx` gains the three routes above, nested under `AdminRoute` the same way `/` is nested under `ProtectedRoute` today.

### Navigation entry point
`Home.tsx` renders a "Manage Members" link only when `user.role === "admin"`, pointing at `/admin/members`. No dashboard shell is introduced — later admin modules (competitions, matches) get their own links the same way when those phases arrive.

## 5. Error Handling & Edge Cases

- **Empty state:** the list page renders fine with just the one seeded admin — no special-casing.
- **Duplicate username on create:** the `409` is surfaced inline in the form via a `role="alert"` element, same pattern as `Login.tsx`.
- **Self-lockout:** guarded both client-side (disabled controls) and server-side (`400`) — the client-side guard is a UX nicety, not the actual enforcement.
- **Deactivated-while-logged-in:** already handled by existing Auth-phase code (`GET /api/auth/me` re-checks `isActive` on every load); no new work needed.

## 6. Testing

Same TDD pattern established in the Auth phase:
- Each backend endpoint: a Vitest suite mocking `prisma`/`requireAuth`, covering the 400/403/409/404/200 paths and the self-lockout rejection.
- Each frontend piece (`AdminRoute`, `Members`, `MemberForm`, `NewMember`, `EditMember`): an RTL suite mocking `api-client`/`AuthContext`.
- A manual end-to-end verification task closes out the implementation plan (as it did for Auth): admin logs in, creates a player, edits it, resets its password, deactivates it, and confirms a non-admin is redirected away from `/admin/members`.
