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
