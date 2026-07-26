import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import {
  listSeasons,
  getSeason,
  startLiveMatch,
  getLiveMatch,
  recordLiveThrow,
  undoLiveThrow,
  type SeasonMatch,
  type LiveMatchState,
  type LiveMultiplier,
} from "../../lib/api-client";

const NUMBERS = Array.from({ length: 20 }, (_, i) => i + 1);

export default function LiveScoring() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [match, setMatch] = useState<SeasonMatch | null>(null);
  const [live, setLive] = useState<LiveMatchState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [multiplier, setMultiplier] = useState<LiveMultiplier>("single");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const matchId = Number(id);
    setLoading(true);
    setError(null);
    try {
      const seasons = await listSeasons();
      const active = seasons.find((s) => s.status === "active");
      if (!active) {
        setError("Match not found");
        return;
      }
      const season = await getSeason(active.id);
      const found = season.matches.find((m) => m.id === matchId);
      if (!found) {
        setError("Match not found");
        return;
      }
      setMatch(found);
      if (found.status === "in_progress" || found.status === "played") {
        setLive(await getLiveMatch(matchId));
      } else {
        setLive(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load match");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const canScore =
    !!match && !!user && (user.role === "admin" || user.id === match.player1.id || user.id === match.player2.id);

  async function handleStart() {
    if (!match) return;
    setActionError(null);
    setSubmitting(true);
    try {
      setLive(await startLiveMatch(match.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to start match");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleThrow(segment: number) {
    if (!match) return;
    setActionError(null);
    setSubmitting(true);
    try {
      setLive(await recordLiveThrow(match.id, { multiplier, segment }));
      setMultiplier("single");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to record throw");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUndo() {
    if (!match) return;
    setActionError(null);
    setSubmitting(true);
    try {
      setLive(await undoLiveThrow(match.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to undo");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="p-4">Loading…</p>;
  }

  if (error || !match) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        {error ?? "Match not found"}
      </p>
    );
  }

  if (!canScore) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        You are not allowed to score this match.
      </p>
    );
  }

  const playerName = (playerId: number) =>
    playerId === match.player1.id ? match.player1.displayName : match.player2.displayName;

  const hasAnyThrows = !!live && live.legs.some((leg) => leg.throws.length > 0);

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">
        {match.player1.displayName} vs {match.player2.displayName}
      </h1>

      {actionError && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {actionError}
        </p>
      )}

      {!live && (
        <button
          onClick={() => void handleStart()}
          disabled={submitting}
          className="bg-primary text-primary-content font-heading rounded p-2 disabled:opacity-50"
        >
          Start Match
        </button>
      )}

      {live && !live.matchOutcome.complete && live.currentTurn && (
        <div className="space-y-4">
          <p className="font-heading text-lg">
            Leg {live.currentTurn.legNumber} — {live.matchOutcome.player1Legs}–{live.matchOutcome.player2Legs}
          </p>
          <p>
            {match.player1.displayName}: {live.currentTurn.player1Remaining}
            {" | "}
            {match.player2.displayName}: {live.currentTurn.player2Remaining}
          </p>
          <p className="font-semibold">Now throwing: {playerName(live.currentTurn.playerId)}</p>
          <p className="text-sm text-gray-500">
            {live.legs
              .find((leg) => leg.legNumber === live.currentTurn!.legNumber)
              ?.throws.filter((th) => th.turnNumber === live.currentTurn!.turnNumber)
              .map((th) => `${th.multiplier[0].toUpperCase()}${th.segment}`)
              .join(", ") || "No darts yet this turn"}
          </p>

          <div role="group" aria-label="Multiplier" className="flex gap-2">
            {(["single", "double", "triple"] as LiveMultiplier[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMultiplier(m)}
                aria-pressed={multiplier === m}
                className={`rounded border p-2 ${multiplier === m ? "bg-primary text-primary-content" : "border-gray-300"}`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-5 gap-2">
            {NUMBERS.map((n) => (
              <button
                key={n}
                type="button"
                disabled={submitting}
                onClick={() => void handleThrow(n)}
                className="rounded border border-gray-300 p-2 disabled:opacity-50"
              >
                {n}
              </button>
            ))}
            {multiplier !== "triple" && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleThrow(25)}
                className="rounded border border-gray-300 p-2 disabled:opacity-50"
              >
                Bull
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={submitting || !hasAnyThrows}
            onClick={() => void handleUndo()}
            className="rounded border border-gray-300 p-2 disabled:opacity-50"
          >
            Undo
          </button>
        </div>
      )}

      {live && live.matchOutcome.complete && (
        <div className="space-y-4">
          <p className="font-heading text-lg">
            Match complete: {playerName(live.matchOutcome.winnerPlayerId!)} wins {live.matchOutcome.player1Legs}–
            {live.matchOutcome.player2Legs}
          </p>
          <p>
            {match.player1.displayName} highest checkout: {live.matchOutcome.player1Checkout ?? "—"}
          </p>
          <p>
            {match.player2.displayName} highest checkout: {live.matchOutcome.player2Checkout ?? "—"}
          </p>
          <button
            type="button"
            onClick={() => navigate("/season/matches")}
            className="bg-primary text-primary-content font-heading rounded p-2"
          >
            Back to Matches
          </button>
        </div>
      )}
    </div>
  );
}
