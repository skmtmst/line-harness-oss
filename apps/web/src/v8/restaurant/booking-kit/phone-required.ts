/** 電話予約の既存の必須欄だけを、両入口で同じ不足案内へまとめる。 */
export function phoneReservationInputReason(fields: { label: string; value: string | boolean }[]): string | undefined {
  const missing = fields.filter(({ value }) => typeof value === 'string' ? !value.trim() : !value)
  return missing.length ? `${missing.map(({ label }) => label).join('・')}を入れてください。` : undefined
}
