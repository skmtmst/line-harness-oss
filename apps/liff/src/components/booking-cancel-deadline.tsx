import { formatDateTimeLong } from '../lib/datetime.js';

export default function BookingCancelDeadline({ deadline }: { deadline?: string | null }) {
  return deadline ? <p className="text-xs text-ink-secondary">キャンセル期限：{formatDateTimeLong(deadline)}</p> : null;
}
