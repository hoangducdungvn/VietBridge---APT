/** Use energy only until Silero has produced its first authoritative result. */
export function selectVadProbability(
  energyProbability: number,
  sileroProbability: number | null,
): number {
  return sileroProbability ?? energyProbability;
}
