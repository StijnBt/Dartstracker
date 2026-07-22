import type { SeasonMatch, SeasonParticipantSummary } from "./api-client";

export type HighestCheckoutAward = {
  value: number;
  players: SeasonParticipantSummary[];
} | null;

export function computeHighestCheckout(
  participants: SeasonParticipantSummary[],
  matches: SeasonMatch[]
): HighestCheckoutAward {
  let value: number | null = null;
  const holders = new Map<number, SeasonParticipantSummary>();

  function consider(player: SeasonParticipantSummary, checkout: number | null) {
    if (checkout === null) return;
    if (value === null || checkout > value) {
      value = checkout;
      holders.clear();
      holders.set(player.id, player);
    } else if (checkout === value) {
      holders.set(player.id, player);
    }
  }

  for (const match of matches) {
    consider(match.player1, match.player1Checkout);
    consider(match.player2, match.player2Checkout);
  }

  if (value === null) return null;
  return { value, players: [...holders.values()] };
}
