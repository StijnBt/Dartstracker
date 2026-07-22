import type { SeasonPlayerStat } from "../../lib/api-client";

type PlayerStatsProps = {
  stats: SeasonPlayerStat[];
};

export default function PlayerStats({ stats }: PlayerStatsProps) {
  return (
    <table className="mb-6 w-full text-left text-sm">
      <caption className="font-heading mb-2 text-left font-semibold">Player Stats</caption>
      <thead>
        <tr className="border-b border-gray-300">
          <th className="py-1 pr-2">Player</th>
          <th className="py-1 pr-2 text-right">3-Dart Avg</th>
          <th className="py-1 text-right">180s</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((stat) => (
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
