import type { ReactNode } from "react";
import type { SeasonMatch, SeasonParticipantSummary } from "../../lib/api-client";
import { renderMatchRow, formatMatchSummary } from "./matchRow";

export { formatMatchSummary };

type RoundRobinScheduleProps = {
  matches: SeasonMatch[];
  participants: SeasonParticipantSummary[];
  renderMatchActions?: (match: SeasonMatch) => ReactNode;
};

export default function RoundRobinSchedule({ matches, participants, renderMatchActions }: RoundRobinScheduleProps) {
  const regularMatches = matches.filter((m) => m.roundNumber > 0);
  const additionalMatches = matches.filter((m) => m.roundNumber === 0);
  const rounds = Array.from(new Set(regularMatches.map((m) => m.roundNumber))).sort((a, b) => a - b);

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
              {roundMatches.map((m) => renderMatchRow(m, renderMatchActions))}
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
          <ul className="divide-y divide-gray-200">
            {additionalMatches.map((m) => renderMatchRow(m, renderMatchActions))}
          </ul>
        </div>
      )}
    </>
  );
}
