import { useState } from "react";
import type { StandingsRow } from "../../lib/standings";
import {
  toggleSort,
  sortRows,
  numericComparator,
  stringComparator,
  type SortState,
  type SortComparator,
} from "../../lib/sortable";

type StandingsProps = {
  rows: StandingsRow[];
};

type Column = "rank" | "player" | "matchesPlayed" | "legsWon" | "legsLost" | "diff" | "highestCheckout";

const comparators: Record<Column, SortComparator<StandingsRow>> = {
  rank: numericComparator<StandingsRow>((r) => r.rank),
  player: stringComparator<StandingsRow>((r) => r.player.displayName),
  matchesPlayed: numericComparator<StandingsRow>((r) => r.matchesPlayed),
  legsWon: numericComparator<StandingsRow>((r) => r.legsWon),
  legsLost: numericComparator<StandingsRow>((r) => r.legsLost),
  diff: numericComparator<StandingsRow>((r) => r.diff),
  highestCheckout: numericComparator<StandingsRow>((r) => r.highestCheckout, { nullsLast: true }),
};

const columnLabels: Record<Column, string> = {
  rank: "Rank",
  player: "Player",
  matchesPlayed: "MP",
  legsWon: "Legs Won",
  legsLost: "Legs Lost",
  diff: "Diff",
  highestCheckout: "Highest Checkout",
};

export default function Standings({ rows }: StandingsProps) {
  const [sort, setSort] = useState<SortState<Column>>(null);
  const sortedRows = sortRows(rows, sort, comparators);

  function renderHeader(column: Column, className: string) {
    let direction: "asc" | "desc" | null = null;
    if (sort && sort.column === column) {
      direction = sort.direction;
    }
    const ariaSort = direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none";

    return (
      <th className={className} aria-sort={ariaSort}>
        <button type="button" onClick={() => setSort(toggleSort(sort, column))} className="underline">
          {columnLabels[column]}
          {direction === "asc" && " ▲"}
          {direction === "desc" && " ▼"}
        </button>
      </th>
    );
  }

  return (
    <table className="mb-6 w-full text-left text-sm">
      <caption className="font-heading mb-2 text-left font-semibold">Standings</caption>
      <thead>
        <tr className="border-b border-gray-300">
          {renderHeader("rank", "py-1 pr-2")}
          {renderHeader("player", "py-1 pr-2")}
          {renderHeader("matchesPlayed", "py-1 pr-2 text-right")}
          {renderHeader("legsWon", "py-1 pr-2 text-right")}
          {renderHeader("legsLost", "py-1 pr-2 text-right")}
          {renderHeader("diff", "py-1 pr-2 text-right")}
          {renderHeader("highestCheckout", "py-1 text-right")}
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => (
          <tr key={row.player.id} className="border-b border-gray-100">
            <td className="py-1 pr-2">{row.rank}</td>
            <td className="py-1 pr-2">{row.player.displayName}</td>
            <td className="py-1 pr-2 text-right">{row.matchesPlayed}</td>
            <td className="py-1 pr-2 text-right">{row.legsWon}</td>
            <td className="py-1 pr-2 text-right">{row.legsLost}</td>
            <td className="py-1 pr-2 text-right">{row.diff}</td>
            <td className="py-1 text-right">{row.highestCheckout ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
