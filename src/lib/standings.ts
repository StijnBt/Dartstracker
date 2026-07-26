import type { SeasonMatch, SeasonParticipantSummary } from "./api-client";

export type StandingsRow = {
  player: SeasonParticipantSummary;
  matchesPlayed: number;
  legsWon: number;
  legsLost: number;
  diff: number;
  rank: number;
  highestCheckout: number | null;
};

export function computeStandings(
  participants: SeasonParticipantSummary[],
  matches: SeasonMatch[]
): StandingsRow[] {
  const playedMatches = matches.filter((m) => m.status === "played");

  const rows: StandingsRow[] = participants.map((player) => {
    let matchesPlayed = 0;
    let legsWon = 0;
    let legsLost = 0;
    let highestCheckout: number | null = null;

    for (const match of playedMatches) {
      if (match.player1.id === player.id) {
        matchesPlayed++;
        legsWon += match.player1Legs ?? 0;
        legsLost += match.player2Legs ?? 0;
        if (match.player1Checkout !== null && (highestCheckout === null || match.player1Checkout > highestCheckout)) {
          highestCheckout = match.player1Checkout;
        }
      } else if (match.player2.id === player.id) {
        matchesPlayed++;
        legsWon += match.player2Legs ?? 0;
        legsLost += match.player1Legs ?? 0;
        if (match.player2Checkout !== null && (highestCheckout === null || match.player2Checkout > highestCheckout)) {
          highestCheckout = match.player2Checkout;
        }
      }
    }

    return { player, matchesPlayed, legsWon, legsLost, diff: legsWon - legsLost, rank: 0, highestCheckout };
  });

  rows.sort((a, b) => b.legsWon - a.legsWon || b.diff - a.diff);

  let currentRank = 0;
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    if (index === 0 || row.legsWon !== previous.legsWon || row.diff !== previous.diff) {
      currentRank = index + 1;
    }
    row.rank = currentRank;
  });

  return rows;
}
