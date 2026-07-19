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
