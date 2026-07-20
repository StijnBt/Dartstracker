import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listSeasons, type SeasonSummary } from "../../lib/api-client";

export default function SeasonArchive() {
  const [seasons, setSeasons] = useState<SeasonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSeasons()
      .then((all) => setSeasons(all.filter((s) => s.status === "archived")))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load seasons"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">Season Archive</h1>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading…</p>
      ) : seasons.length === 0 ? (
        <p>No archived seasons yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200">
          {seasons.map((season) => (
            <li key={season.id}>
              <Link to={`/seasons/${season.id}`} className="flex items-center justify-between py-3">
                <span>{season.name}</span>
                <span className="text-sm text-gray-500">{season.roundType}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
