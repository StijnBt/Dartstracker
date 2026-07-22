import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import {
  listSeasons,
  getSeason,
  getSeasonStats,
  archiveSeason,
  updateMatch,
  addMatch,
  deleteMatch,
  type Season,
  type SeasonMatch,
  type SeasonPlayerStat,
} from "../../lib/api-client";
import { computeStandings } from "../../lib/standings";
import { computeHighestCheckout } from "../../lib/awards";
import RoundRobinSchedule, { formatMatchSummary } from "./RoundRobinSchedule";
import Standings from "./Standings";
import HighestCheckoutAward from "./HighestCheckoutAward";
import PlayerStats from "./PlayerStats";

export default function SeasonPage() {
  const { user } = useAuth();
  const [season, setSeason] = useState<Season | null>(null);
  const [stats, setStats] = useState<SeasonPlayerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addMatchDate, setAddMatchDate] = useState("");
  const [addMatchPlayer1Id, setAddMatchPlayer1Id] = useState<number | "">("");
  const [addMatchPlayer2Id, setAddMatchPlayer2Id] = useState<number | "">("");
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<number>>(new Set());

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

  async function handleAddMatch() {
    if (!season || !addMatchDate || addMatchPlayer1Id === "" || addMatchPlayer2Id === "") return;
    await addMatch(season.id, { date: addMatchDate, player1Id: addMatchPlayer1Id, player2Id: addMatchPlayer2Id });
    setAddMatchDate("");
    setAddMatchPlayer1Id("");
    setAddMatchPlayer2Id("");
    void load();
  }

  function toggleMatchSelection(matchId: number) {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) {
        next.delete(matchId);
      } else {
        next.add(matchId);
      }
      return next;
    });
  }

  async function handleDeleteSelected() {
    if (!season || selectedMatchIds.size === 0) return;
    const selected = season.matches.filter((m) => selectedMatchIds.has(m.id));
    const anyPlayed = selected.some((m) => m.status === "played");
    const message = anyPlayed
      ? `Delete ${selected.length} match(es)? This cannot be undone. At least one selected match has already been played — its recorded result and full throw history will be permanently lost.`
      : `Delete ${selected.length} match(es)? This cannot be undone.`;
    if (!window.confirm(message)) return;
    await Promise.all([...selectedMatchIds].map((id) => deleteMatch(id)));
    setSelectedMatchIds(new Set());
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
      <HighestCheckoutAward award={computeHighestCheckout(season.participants, season.matches)} />
      <Standings rows={computeStandings(season.participants, season.matches)} />
      <PlayerStats stats={stats} />
      {user?.role === "admin" && (
        <div className="mb-4 rounded border border-gray-300 p-3">
          <h2 className="font-heading mb-2 font-semibold">Add Match</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label="New match date"
              value={addMatchDate}
              onChange={(e) => setAddMatchDate(e.target.value)}
              className="rounded border border-gray-300 p-1"
            />
            <select
              aria-label="Player 1"
              value={addMatchPlayer1Id}
              onChange={(e) => setAddMatchPlayer1Id(e.target.value ? Number(e.target.value) : "")}
              className="rounded border border-gray-300 p-1"
            >
              <option value="">Player 1</option>
              {season.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <select
              aria-label="Player 2"
              value={addMatchPlayer2Id}
              onChange={(e) => setAddMatchPlayer2Id(e.target.value ? Number(e.target.value) : "")}
              className="rounded border border-gray-300 p-1"
            >
              <option value="">Player 2</option>
              {season.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
            <button onClick={() => void handleAddMatch()} className="text-primary underline">
              Add Match
            </button>
          </div>
        </div>
      )}
      {user?.role === "admin" && (
        <button
          onClick={() => void handleDeleteSelected()}
          disabled={selectedMatchIds.size === 0}
          className="text-primary mb-4 underline disabled:text-gray-400 disabled:no-underline"
        >
          Delete Selected ({selectedMatchIds.size})
        </button>
      )}
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
                    type="checkbox"
                    aria-label={`Select ${match.player1.displayName} vs ${match.player2.displayName}`}
                    checked={selectedMatchIds.has(match.id)}
                    onChange={() => toggleMatchSelection(match.id)}
                  />
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
