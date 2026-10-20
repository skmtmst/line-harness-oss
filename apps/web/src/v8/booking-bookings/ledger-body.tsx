'use client'

import type { ReactNode } from 'react'
import { ListPageBody, type ListFolderNav } from '@/components/templates/list-page'
import { ListToolbarFrame } from '@/components/shared/list-toolbar'

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
  /* ：メニュー名「トリミング（小型犬）」が1行で読める列幅（列 210＋左右の余白）。 */
  if (view === 'month') return <ListPageBody skeleton readOnly={readOnly} stats={stats}
    folders={folders} folderWidth={232} folderNav={folderNav} toolbar={<ListToolbarFrame layout="stacked">{toolbar}</ListToolbarFrame>} pagination={pagination}>
    {children}
  </ListPageBody>

  return <ListPageBody skeleton readOnly={readOnly} stats={stats}
    folders={folders} folderNav={folderNav} toolbar={toolbar} pagination={pagination}>
    {children}
  </ListPageBody>
}
