export interface TagListRequestKey {
  accountId: string | null
  generation: number
}

/** A late response from a previously selected store must never replace current data. */
export function isCurrentTagListRequest(
  current: TagListRequestKey,
  candidate: TagListRequestKey,
): boolean {
  return current.accountId === candidate.accountId && current.generation === candidate.generation
}
