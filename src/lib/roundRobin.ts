export type RoundType = "single" | "double";

export function computeRoundCount(participantCount: number, roundType: RoundType): number {
  const evenCount = participantCount % 2 === 0 ? participantCount : participantCount + 1;
  const singleRoundCount = evenCount - 1;
  return roundType === "double" ? singleRoundCount * 2 : singleRoundCount;
}
