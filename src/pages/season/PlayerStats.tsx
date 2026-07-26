import { useState } from "react";
import type { SeasonPlayerStat } from "../../lib/api-client";
import {
  toggleSort,
  sortRows,
  numericComparator,
  stringComparator,
  type SortState,
  type SortComparator,
} from "../../lib/sortable";

type PlayerStatsProps = {
  stats: SeasonPlayerStat[];
};

type Column = "displayName" | "threeDartAverage" | "oneEightyCount";

const comparators: Record<Column, SortComparator<SeasonPlayerStat>> = {
  displayName: stringComparator<SeasonPlayerStat>((s) => s.displayName),
  threeDartAverage: numericComparator<SeasonPlayerStat>((s) => s.threeDartAverage),
  oneEightyCount: numericComparator<SeasonPlayerStat>((s) => s.oneEightyCount),
};

const columnLabels: Record<Column, string> = {
  displayName: "Player",
  threeDartAverage: "3-Dart Avg",
  oneEightyCount: "180s",
};

export default function PlayerStats({ stats }: PlayerStatsProps) {
  const [sort, setSort] = useState<SortState<Column>>(null);
  const sortedStats = sortRows(stats, sort, comparators);

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
      <caption className="font-heading mb-2 text-left font-semibold">Player Stats</caption>
      <thead>
        <tr className="border-b border-gray-300">
          {renderHeader("displayName", "py-1 pr-2")}
          {renderHeader("threeDartAverage", "py-1 pr-2 text-right")}
          {renderHeader("oneEightyCount", "py-1 text-right")}
        </tr>
      </thead>
      <tbody>
        {sortedStats.map((stat) => (
          <tr key={stat.playerId} className="border-b border-gray-100">
            <td className="py-1 pr-2">{stat.displayName}</td>
            <td className="py-1 pr-2 text-right">{stat.threeDartAverage.toFixed(2)}</td>
            <td className="py-1 text-right">{stat.oneEightyCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
