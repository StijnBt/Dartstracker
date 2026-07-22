import type { ReactNode } from "react";
import type { SeasonMatch, SeasonParticipantSummary } from "../../lib/api-client";

export function formatMatchSummary(match: SeasonMatch): string {
  if (match.status === "played") {
    return `${match.player1Legs}–${match.player2Legs}`;
  }
  return new Date(match.date).toLocaleDateString();
}

type RoundRobinScheduleProps = {
  matches: SeasonMatch[];
  participants: SeasonParticipantSummary[];
  renderMatchActions?: (match: SeasonMatch) => ReactNode;
};

export default function RoundRobinSchedule({ matches, participants, renderMatchActions }: RoundRobinScheduleProps) {
  const regularMatches = matches.filter((m) => m.roundNumber > 0);
  const additionalMatches = matches.filter((m) => m.roundNumber === 0);
  const rounds = Array.from(new Set(regularMatches.map((m) => m.roundNumber))).sort((a, b) => a - b);

  function renderMatchRow(match: SeasonMatch) {
    return (
      <li key={match.id} className="flex items-center justify-between py-2">
        <span>
          {match.player1.displayName} vs {match.player2.displayName}
        </span>
        <span className="flex items-center gap-2 text-sm text-gray-500">
          {renderMatchActions ? renderMatchActions(match) : formatMatchSummary(match)}
          {match.status === "cancelled" && <span className="text-red-600">cancelled</span>}
        </span>
      </li>
    );
  }

  return (
    <>
      {rounds.map((roundNumber) => {
        const roundMatches = regularMatches.filter((m) => m.roundNumber === roundNumber);
        const byePlayers = participants.filter(
          (p) => !roundMatches.some((m) => m.player1.id === p.id || m.player2.id === p.id)
        );

        return (
          <div key={roundNumber} className="mb-4">
            <h2 className="font-heading mb-2 font-semibold">Round {roundNumber}</h2>
            <ul className="divide-y divide-gray-200">
              {roundMatches.map(renderMatchRow)}
              {byePlayers.map((player) => (
                <li key={`bye-${player.id}`} className="py-2 text-sm text-gray-500">
                  {player.displayName}: bye
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {additionalMatches.length > 0 && (
        <div className="mb-4">
          <h2 className="font-heading mb-2 font-semibold">Additional Matches</h2>
          <ul className="divide-y divide-gray-200">{additionalMatches.map(renderMatchRow)}</ul>
        </div>
      )}
    </>
  );
}
