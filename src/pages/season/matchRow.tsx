import type { ReactNode } from "react";
import type { SeasonMatch } from "../../lib/api-client";

export function formatMatchSummary(match: SeasonMatch): string {
  if (match.status === "played") {
    return `${match.player1Legs}–${match.player2Legs}`;
  }
  return new Date(match.date).toLocaleDateString();
}

export function renderMatchRow(
  match: SeasonMatch,
  renderMatchActions?: (match: SeasonMatch) => ReactNode
): ReactNode {
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
