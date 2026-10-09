import { ageFromBirthday, FIXED_FRIEND_FIELDS, type FriendField, type FixedFriendFieldKey } from '@line-crm/shared'
import { formatYmd, formatTime } from '@/lib/format'

export function fixedFieldValue(fields: FriendField[], key: FixedFriendFieldKey, now?: Date): {
  value: string | null; source: string | null; derived: boolean
} {
  const field = fields.find(f => f.fixedKey === key)
  const birth = fields.find(f => f.fixedKey === 'birthday')
  const age = key === 'age' ? ageFromBirthday(birth?.value, now) : null
  const sourceField = age !== null ? birth : field
  const source = sourceField?.valueSource?.type === 'form'
    ? `回答フォーム『${sourceField.valueSource.name ?? '削除されたフォーム'}』から${sourceField.valueUpdatedAt ? ' ' + formatYmd(sourceField.valueUpdatedAt).slice(5).replace('-', '/') + ' ' + formatTime(sourceField.valueUpdatedAt).padStart(5, '0') : ''}`
    : age !== null ? '生年月日から計算' : null
  return { value: age !== null ? String(age) : field?.value ?? null, source, derived: age !== null }
}
export { FIXED_FRIEND_FIELDS }
