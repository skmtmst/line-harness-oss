import { RowActions } from '@/components/shared/row-actions'
import type { RestaurantTable } from '@/lib/restaurant-test-api'

export default function TableRowActions({ table, canEdit, busy, onEdit, onStop, onResume }: {
  table: RestaurantTable
  canEdit: boolean
  busy: boolean
  onEdit: (table: RestaurantTable) => void
  onStop: (table: RestaurantTable) => void
  onResume: (table: RestaurantTable) => void
}) {
  if (!canEdit) return null
  return <RowActions subjectName={`${table.code}・${table.label}`}
    edit={{ label: '変更', disabled: busy, onClick: () => onEdit(table) }}
    menuButtonProps={{ disabled: busy }}
    menuItems={[{
      id: table.is_active ? 'stop' : 'resume',
      label: table.is_active ? '停止' : '再開',
      disabled: busy,
      disabledReason: busy ? 'ほかの変更を反映しています' : undefined,
      onSelect: () => table.is_active ? onStop(table) : onResume(table),
    }]} />
}
