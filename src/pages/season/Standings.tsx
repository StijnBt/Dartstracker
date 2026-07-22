import type { StandingsRow } from "../../lib/standings";

type StandingsProps = {
  rows: StandingsRow[];
};

export default function Standings({ rows }: StandingsProps) {
  return (
    <table className="mb-6 w-full text-left text-sm">
      <caption className="font-heading mb-2 text-left font-semibold">Standings</caption>
      <thead>
        <tr className="border-b border-gray-300">
          <th className="py-1 pr-2">Rank</th>
          <th className="py-1 pr-2">Player</th>
          <th className="py-1 pr-2 text-right">MP</th>
          <th className="py-1 pr-2 text-right">Legs Won</th>
          <th className="py-1 pr-2 text-right">Legs Lost</th>
          <th className="py-1 text-right">Diff</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.player.id} className="border-b border-gray-100">
            <td className="py-1 pr-2">{row.rank}</td>
            <td className="py-1 pr-2">{row.player.displayName}</td>
            <td className="py-1 pr-2 text-right">{row.matchesPlayed}</td>
            <td className="py-1 pr-2 text-right">{row.legsWon}</td>
            <td className="py-1 pr-2 text-right">{row.legsLost}</td>
            <td className="py-1 text-right">{row.diff}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
