export default function BookingCancelDeadline({ deadline }: { deadline?: string | null }) {
  return deadline ? <p className="text-xs text-ink-secondary">キャンセル期限：{new Date(deadline).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</p> : null;
}
