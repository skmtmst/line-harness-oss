const BOOKING_REMINDER_RULES = [
  { label: '前日', minutesBefore: 24 * 60 },
  { label: '開始2時間前', minutesBefore: 2 * 60 },
] as const

/**
 * 予約確定時に Worker が作る2本と同じ予定を、運用者が読める時刻へ直す。
 * すでに過ぎた予定は Worker も登録しないため、画面にも出さない。
 */
export function reminderScheduleLabels(date: string, time: string, now = new Date()): string[] {
  if (!date || !time) return []
  const startsAt = new Date(`${date}T${time}:00+09:00`)
  if (Number.isNaN(startsAt.getTime())) return []
  return BOOKING_REMINDER_RULES.flatMap((rule) => {
    const scheduledAt = new Date(startsAt.getTime() - rule.minutesBefore * 60_000)
    if (scheduledAt <= now) return []
    return [`${rule.label}：${scheduledAt.toLocaleString('ja-JP', {
      month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Tokyo',
    })}`]
  })
}
