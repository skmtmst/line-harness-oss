export type BookingMenuBaseDraft = {
  name: unknown
  durationMinutes: unknown
  bufferAfterMinutes?: unknown
  sortOrder?: unknown
}

/** Worker と同じ基準で、保存前に直せる入力不備を画面内へ出す。 */
export function bookingMenuBaseError(draft: BookingMenuBaseDraft): string | null {
  if (typeof draft.name !== 'string' || !draft.name.trim()) {
    return 'メニュー名を入力してください'
  }
  if (draft.name.trim().length > 200) {
    return 'メニュー名は200文字以内で入力してください'
  }
  const duration = Number(draft.durationMinutes)
  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
    return '所要時間は1〜1440分の整数で入力してください'
  }
  const buffer = draft.bufferAfterMinutes === undefined ? 0 : Number(draft.bufferAfterMinutes)
  if (!Number.isInteger(buffer) || buffer < 0 || buffer > 1440) {
    return '後の空き時間は0〜1440分の整数で入力してください'
  }
  const sortOrder = draft.sortOrder === undefined ? 0 : Number(draft.sortOrder)
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1_000_000) {
    return '並び順は0〜1000000の整数で入力してください'
  }
  return null
}
