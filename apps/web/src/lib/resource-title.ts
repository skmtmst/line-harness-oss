/** まだ読めていない名前と、読めたうえで空の名前を区別する。 */
export function resolveResourceTitle({ name, loaded, pendingTitle, emptyTitle = pendingTitle }: {
  name: string | null | undefined
  loaded: boolean
  pendingTitle: string
  emptyTitle?: string
}): string {
  return loaded && name?.trim() ? name : loaded ? emptyTitle : pendingTitle
}
