import { ageFromBirthday, allergyValues, BASIC_FRIEND_FIELDS as FIXED_FRIEND_FIELDS, type FriendField, type FixedFriendFieldKey } from '@line-crm/shared'
import { formatYmd, formatTime } from '@/lib/format'

export function fixedFieldValue(fields: FriendField[], key: FixedFriendFieldKey, now?: Date): {
  value: string | null; source: string | null; derived: boolean
  /** 題の横に1行で出す短い出どころ（vX3wQ「来店アンケート・10/2」）。全文は source を title に。 */
  sourceShort: string | null
} {
  const field = fields.find(f => f.fixedKey === key)
  const birth = fields.find(f => f.fixedKey === 'birthday')
  const age = key === 'age' ? ageFromBirthday(birth?.value, now) : null
  const sourceField = age !== null ? birth : field
  const source = sourceField?.valueSource?.type === 'form'
    ? `回答フォーム『${sourceField.valueSource.name ?? '削除されたフォーム'}』から${sourceField.valueUpdatedAt ? ' ' + formatYmd(sourceField.valueUpdatedAt).slice(5).replace('-', '/') + ' ' + formatTime(sourceField.valueUpdatedAt).padStart(5, '0') : ''}`
    : age !== null ? '生年月日から計算' : null
  const updated = sourceField?.valueUpdatedAt ? formatYmd(sourceField.valueUpdatedAt).slice(5).split('-').map(Number).join('/') : null
  const sourceShort = age !== null ? '生年月日から・読むだけ'
    : sourceField?.valueSource?.type === 'form' ? [sourceField.valueSource.name ?? '削除されたフォーム', updated].filter(Boolean).join('・') : null
  return { sourceShort: sourceShort ?? (field?.value ? '手で入れた' : null), value: age !== null ? String(age) : key === 'allergy' ? allergyValues(field?.value).join('・') || null : field?.value ?? null, source: source ?? (field?.value ? '手で入れた' : null), derived: age !== null }
}
export { FIXED_FRIEND_FIELDS }
