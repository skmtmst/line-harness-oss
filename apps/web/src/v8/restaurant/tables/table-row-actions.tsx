import { RowActions } from '@/components/shared/row-actions'
import type { RestaurantTable } from '@/lib/restaurant-test-api'

export default function TableRowActions({ table, canEdit, busy, pendingAccount, onEdit, onStop, onResume, onDelete }: {
  table: RestaurantTable
  canEdit: boolean
  busy: boolean
  pendingAccount: boolean
  onEdit: (table: RestaurantTable) => void
  onStop: (table: RestaurantTable) => void
  onResume: (table: RestaurantTable) => void
  onDelete: (table: RestaurantTable) => void
}) {
  if (!canEdit) return null
  const disabledReason = pendingAccount ? '選んだアカウントの一覧を確認してください' : busy ? 'ほかの変更を反映しています' : undefined
  return <RowActions subjectName={`${table.code}・${table.label}`}
    edit={{ label: '変更', disabled: busy, lockedReason: pendingAccount ? disabledReason : undefined, onClick: () => onEdit(table) }}
    menuButtonProps={{ disabled: busy }}
    menuItems={[{
      id: table.is_active ? 'stop' : 'resume',
      label: table.is_active ? '停止' : '再開',
      disabled: busy,
      lockedReason: pendingAccount ? disabledReason : undefined,
      disabledReason,
      onSelect: () => table.is_active ? onStop(table) : onResume(table),
    }, { id: 'delete', label: '削除', tone: 'danger', disabled: busy, lockedReason: pendingAccount ? disabledReason : undefined, disabledReason, onSelect: () => onDelete(table) }]} />
}
