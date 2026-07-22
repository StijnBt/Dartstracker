import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getSeason, getSeasonStats, type Season, type SeasonPlayerStat } from "../../lib/api-client";
import { computeStandings } from "../../lib/standings";
import { computeHighestCheckout } from "../../lib/awards";
import RoundRobinSchedule from "./RoundRobinSchedule";
import Standings from "./Standings";
import HighestCheckoutAward from "./HighestCheckoutAward";
import PlayerStats from "./PlayerStats";

export default function SeasonDetail() {
  const { id } = useParams<{ id: string }>();
  const [season, setSeason] = useState<Season | null>(null);
  const [stats, setStats] = useState<SeasonPlayerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([getSeason(Number(id)), getSeasonStats(Number(id))])
      .then(([seasonData, statsData]) => {
        setSeason(seasonData);
        setStats(statsData);
      })
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
      <HighestCheckoutAward award={computeHighestCheckout(season.participants, season.matches)} />
      <Standings rows={computeStandings(season.participants, season.matches)} />
      <PlayerStats stats={stats} />
      <RoundRobinSchedule matches={season.matches} participants={season.participants} />
    </div>
  );
}
