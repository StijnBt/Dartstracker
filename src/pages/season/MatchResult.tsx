import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { listSeasons, getSeason, submitMatchResult, type SeasonMatch } from "../../lib/api-client";

export default function MatchResult() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [match, setMatch] = useState<SeasonMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [player1Legs, setPlayer1Legs] = useState("");
  const [player2Legs, setPlayer2Legs] = useState("");
  const [player1Checkout, setPlayer1Checkout] = useState("");
  const [player2Checkout, setPlayer2Checkout] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    const matchId = Number(id);
    listSeasons()
      .then((seasons) => {
        const active = seasons.find((s) => s.status === "active");
        if (!active) {
          setError("Match not found");
          return null;
        }
        return getSeason(active.id);
      })
      .then((season) => {
        if (!season) return;
        const found = season.matches.find((m) => m.id === matchId);
        if (!found) {
          setError("Match not found");
          return;
        }
        setMatch(found);
        setPlayer1Legs(found.player1Legs !== null ? String(found.player1Legs) : "");
        setPlayer2Legs(found.player2Legs !== null ? String(found.player2Legs) : "");
        setPlayer1Checkout(found.player1Checkout !== null ? String(found.player1Checkout) : "");
        setPlayer2Checkout(found.player2Checkout !== null ? String(found.player2Checkout) : "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load match"))
      .finally(() => setLoading(false));
  }, [id]);

  const canEdit =
    !!match && !!user && (user.role === "admin" || user.id === match.player1.id || user.id === match.player2.id);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!match) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await submitMatchResult(match.id, {
        player1Legs: Number(player1Legs),
        player2Legs: Number(player2Legs),
        ...(player1Checkout ? { player1Checkout: Number(player1Checkout) } : {}),
        ...(player2Checkout ? { player2Checkout: Number(player2Checkout) } : {}),
      });
      navigate("/season/matches");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save result");
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

  return (
    <div className="p-4">
      <h1 className="text-primary font-heading mb-4 text-2xl font-bold">
        {match.player1.displayName} vs {match.player2.displayName}
      </h1>
      {canEdit ? (
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
          <div>
            <label htmlFor="player1Legs" className="block text-sm font-medium">
              {match.player1.displayName} legs
            </label>
            <input
              id="player1Legs"
              type="number"
              min={0}
              max={3}
              required
              value={player1Legs}
              onChange={(e) => setPlayer1Legs(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-2"
            />
          </div>
          <div>
            <label htmlFor="player2Legs" className="block text-sm font-medium">
              {match.player2.displayName} legs
            </label>
            <input
              id="player2Legs"
              type="number"
              min={0}
              max={3}
              required
              value={player2Legs}
              onChange={(e) => setPlayer2Legs(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-2"
            />
          </div>
          <div>
            <label htmlFor="player1Checkout" className="block text-sm font-medium">
              {match.player1.displayName} highest checkout (optional)
            </label>
            <input
              id="player1Checkout"
              type="number"
              min={1}
              value={player1Checkout}
              onChange={(e) => setPlayer1Checkout(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-2"
            />
          </div>
          <div>
            <label htmlFor="player2Checkout" className="block text-sm font-medium">
              {match.player2.displayName} highest checkout (optional)
            </label>
            <input
              id="player2Checkout"
              type="number"
              min={1}
              value={player2Checkout}
              onChange={(e) => setPlayer2Checkout(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 p-2"
            />
          </div>
          {submitError && (
            <p role="alert" className="text-sm text-red-600">
              {submitError}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="bg-primary text-primary-content font-heading w-full rounded p-2 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save Result"}
          </button>
        </form>
      ) : match.status === "played" ? (
        <p>
          Result: {match.player1.displayName} {match.player1Legs}–{match.player2Legs} {match.player2.displayName}
        </p>
      ) : (
        <p>No result recorded yet.</p>
      )}
    </div>
  );
}
