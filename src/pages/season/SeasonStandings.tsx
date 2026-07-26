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
