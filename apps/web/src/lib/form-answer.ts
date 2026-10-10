import { formatAnswerValue, type FormInputBlock } from '@line-crm/shared'

/** 型が古い回答にも残っていないときは、保存済みの構造から住所・予約を読む。 */
export function formAnswerText(value: unknown, block?: FormInputBlock): string {
  if (typeof value === 'string' && value.includes('[object Object]')) {
    return '以前の保存で内容が失われています。元の回答を確認してください'
  }
  if (Array.isArray(value)) return value.map(item => formAnswerText(item)).join(', ')
  if (value !== null && typeof value === 'object') {
    const v = value as Record<string, unknown>
    const type = block?.type ?? ('startsAt' in v && 'menuId' in v ? 'booking'
      : ['postalCode', 'prefecture', 'city', 'addressLine1'].some(key => key in v) ? 'address' : null)
    if (!type) return JSON.stringify(value)
    return formatAnswerValue(block ?? { type } as FormInputBlock, value)
  }
  return formatAnswerValue(block ?? { type: 'text' } as FormInputBlock, value)
}
