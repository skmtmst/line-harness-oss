'use client'

import { createContext } from 'react'

export type FolderNarrowAction = {
  key: symbol
  rowIds: string
  label: string
  disabled: boolean
  lockedReason?: string
  run: () => void
}

export const FolderNarrowContext = createContext<((action: FolderNarrowAction) => () => void) | null>(null)
export const FolderNarrowActionsContext = createContext<FolderNarrowAction[]>([])
export const folderRowIds = (rows: Array<{ id: string }>) => JSON.stringify(rows.map(row => row.id).sort())
export function uniqueFolderAction(actions: FolderNarrowAction[], matches: (action: FolderNarrowAction) => boolean) {
  const matched = actions.filter(matches)
  return matched.length === 1 ? matched[0] : undefined
}
