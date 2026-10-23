/** APIの絞り込み済みtotal/summaryを、別の種類の全件数へ流用しない。 */
export function runCounts(kind: string, routing: string, total: number | undefined, summary: {
  failed: number; returning?: number; testPending?: number | null
} | null) {
  const all = kind === 'all' && routing === 'all'
  return {
    all: all ? total : undefined,
    failed: all ? summary?.failed : kind === 'all' && routing === 'failed' ? total : undefined,
    pending: all ? summary?.testPending ?? undefined : undefined,
    returning: all ? summary?.returning : kind === 'returning' && routing === 'all' ? total : undefined,
  }
}
