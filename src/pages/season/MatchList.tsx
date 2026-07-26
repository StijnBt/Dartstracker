import type { ReactNode } from "react";
import type { SeasonMatch } from "../../lib/api-client";
import { renderMatchRow } from "./matchRow";

type MatchListProps = {
  matches: SeasonMatch[];
  renderMatchActions?: (match: SeasonMatch) => ReactNode;
};

export default function MatchList({ matches, renderMatchActions }: MatchListProps) {
  return <ul className="divide-y divide-gray-200">{matches.map((m) => renderMatchRow(m, renderMatchActions))}</ul>;
}
