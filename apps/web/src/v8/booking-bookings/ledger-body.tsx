'use client'

import type { ReactNode } from 'react'
import { ListPageBody, type ListFolderNav } from '@/components/templates/list-page'
import { ListToolbarFrame } from '@/components/shared/list-toolbar'
import { FOLDER_RAIL_WIDTH } from '@/components/shared/folder-panel'

export default function BookingLedgerBody({ view, readOnly, stats, folders, folderNav, toolbar, pagination, children }: {
  view: string
  readOnly: boolean
  stats: ReactNode
  folders: ReactNode
  folderNav: ListFolderNav
  toolbar: ReactNode
  pagination: ReactNode
  children: ReactNode
}) {
  if (view === 'month') return <ListPageBody skeleton readOnly={readOnly} stats={stats}
    folders={folders} folderNav={folderNav} toolbar={<ListToolbarFrame>{toolbar}</ListToolbarFrame>} pagination={pagination}>
    {children}
  </ListPageBody>

  return <>
    {stats}
    <div data-design="Body" className="flex flex-col items-start gap-4 xl:flex-row">
      <div data-design="Folders" className="shrink-0" style={{ width: FOLDER_RAIL_WIDTH }}>{folders}</div>
      <div className="min-w-0 flex-1">{toolbar}{children}{pagination}</div>
    </div>
  </>
}
