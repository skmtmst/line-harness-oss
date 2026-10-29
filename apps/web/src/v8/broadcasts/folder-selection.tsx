'use client'

import type { Folder } from '@line-crm/shared'
import { useFolderMove } from '@/components/shared/use-folder-move'
import { api, type ApiBroadcast } from '@/lib/api'
import { captureBroadcastWriteAccess } from './write-access'

export function useBroadcastFolderSelection({ accountId, canEdit, broadcasts, folders, onChanged }: {
  accountId: string | null
  canEdit: boolean
  broadcasts: ApiBroadcast[]
  folders: Folder[]
  onChanged: () => Promise<void>
}) {
  const permitted = captureBroadcastWriteAccess()
  const items = broadcasts.map(broadcast => ({ ...broadcast, name: broadcast.title }))
  const selection = useFolderMove({
    accountId, canEdit, items, folders, onChanged,
    move: async (item, folderId) => {
      if (!permitted(item)) throw new Error('権限が変わったため、フォルダへの移動を中止しました。')
      const response = await api.broadcasts.update(item.id, { folderId, expectedVersion: item.version ?? 0 })
      if (!response.success) throw new Error(response.error || 'フォルダへ移せませんでした')
    },
  })
  return {
    isSelected: selection.isSelected,
    pageCheckbox: items.length ? selection.pageCheckbox : null,
    checkbox: (broadcast: ApiBroadcast) => items.some(item => item.id === broadcast.id)
      ? selection.checkbox({ ...broadcast, name: broadcast.title }) : null,
    overlays: selection.overlays,
  }
}
