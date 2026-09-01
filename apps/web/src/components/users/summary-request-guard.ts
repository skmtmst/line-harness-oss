export type LatestRequestGuard = {
  begin: () => number
  invalidate: () => void
  isCurrent: (requestGeneration: number) => boolean
}

/** 遅れて返った古い集計を、現在の画面へ反映させない。 */
export function createLatestRequestGuard(): LatestRequestGuard {
  let generation = 0

  return {
    begin: () => {
      generation += 1
      return generation
    },
    invalidate: () => {
      generation += 1
    },
    isCurrent: (requestGeneration) => requestGeneration === generation,
  }
}
