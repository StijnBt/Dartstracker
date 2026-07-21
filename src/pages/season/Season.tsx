import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { listSeasons, getSeason, archiveSeason, updateMatch, type Season, type SeasonMatch } from "../../lib/api-client";
import RoundRobinSchedule, { formatMatchSummary } from "./RoundRobinSchedule";

export default function SeasonPage() {
  const { user } = useAuth();
  const [season, setSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setSeason(await getSeason(active.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load season");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleArchive() {
    if (!season) return;
    await archiveSeason(season.id);
    void load();
  }

  async function handleReschedule(matchId: number, date: string) {
    await updateMatch(matchId, { date });
    void load();
  }

  async function handleToggleStatus(match: SeasonMatch) {
    await updateMatch(match.id, { status: match.status === "cancelled" ? "scheduled" : "cancelled" });
    void load();
  }

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
        <h1 className="text-primary font-heading mb-4 text-2xl font-bold">Season</h1>
        <p>No active season.</p>
        {user?.role === "admin" && (
          <Link to="/season/new" className="text-primary underline">
            Create Season
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-primary font-heading text-2xl font-bold">{season.name}</h1>
        {user?.role === "admin" && (
          <button onClick={() => void handleArchive()} className="text-primary underline">
            Archive Season
          </button>
        )}
      </div>
      <RoundRobinSchedule
        matches={season.matches}
        participants={season.participants}
        renderMatchActions={(match) => {
          const canRecordResult =
            !!user && (user.role === "admin" || user.id === match.player1.id || user.id === match.player2.id);

          if (!canRecordResult) {
            return formatMatchSummary(match);
          }

          return (
            <>
              {user?.role === "admin" && (
                <>
                  <input
                    type="date"
                    aria-label={`Reschedule ${match.player1.displayName} vs ${match.player2.displayName}`}
                    value={match.date.slice(0, 10)}
                    onChange={(e) => void handleReschedule(match.id, e.target.value)}
                    className="rounded border border-gray-300 p-1"
                  />
                  <button onClick={() => void handleToggleStatus(match)} className="text-primary underline">
                    {match.status === "cancelled" ? "Restore" : "Cancel"}
                  </button>
                </>
              )}
              {(match.status === "scheduled" || match.status === "in_progress") && (
                <Link to={`/season/matches/${match.id}/live`} className="text-primary underline">
                  {match.status === "in_progress" ? "Resume Live" : "Start Live"}
                </Link>
              )}
              <Link to={`/season/matches/${match.id}/result`} className="text-primary underline">
                {match.status === "played" ? "Edit Result" : "Enter Result"}
              </Link>
            </>
          );
        }}
      />
    </div>
  );
}
