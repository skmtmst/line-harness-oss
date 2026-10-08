import type { ReactNode } from 'react'
import type { Folder } from '@line-crm/shared'

/** 店と統括で同じ一覧を使うための口。統括の通信は呼び出し側が持つ。 */
export interface AttributeListHost<T> {
  items: T[]
  status: 'loading' | 'ready' | 'error' | 'forbidden'
  busy: boolean
  error?: string
  reload: () => void
  onCreate: () => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
  onDistribute: (id: string) => void
  onOrder: (ids: string[]) => Promise<void>
  kpis?: ReactNode
  folders?: Folder[]
  foldersFailed?: boolean
  onAddFolder?: () => void
  onEditFolder?: (id: string) => void
  onRemoveFolder?: (id: string) => void
}
