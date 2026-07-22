import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSeason, type Season } from "../../lib/api-client";
import { computeStandings } from "../../lib/standings";
import RoundRobinSchedule from "./RoundRobinSchedule";
import Standings from "./Standings";

export default function SeasonDetail() {
  const { id } = useParams<{ id: string }>();
  const [season, setSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getSeason(Number(id))
      .then(setSeason)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load season"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <p className="p-4">Loading…</p>;
  }

  if (error || !season) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        {error ?? "Season not found"}
      </p>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">{season.name}</h1>
      <Standings rows={computeStandings(season.participants, season.matches)} />
      <RoundRobinSchedule matches={season.matches} participants={season.participants} />
    </div>
  );
}
