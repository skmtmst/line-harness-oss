import type { BookingHistoryItem } from '../lib/api.js';
import { utcToJstHm, utcToJstMd } from '../lib/datetime.js';
import Card from './ui/Card.js';
import Badge from './ui/Badge.js';

/**
 * 3-a 予約の札。日付の四角＋名前＋札＋補足。
 * キャンセル・変更の操作は付けない (LIFF では出来ない)。
 */
export default function HistoryCard({ booking }: { booking: BookingHistoryItem }) {
  const meta = STATUS_META[booking.status] ?? { label: booking.status, tone: 'neutral' as const };
  return (
    <li>
      <Card className="flex items-center gap-3 p-4">
        <div className="flex w-13 shrink-0 flex-col items-center" aria-label={utcToJstMd(booking.starts_at)}>
          <span className="text-base font-bold whitespace-nowrap text-ink">
            {utcToJstMd(booking.starts_at)}
          </span>
          <span className="text-xs text-ink-secondary">{utcToJstHm(booking.starts_at)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-ink" title={booking.menu_name}>
            {booking.menu_name}
          </div>
          <div className="mt-0.5 truncate text-sm text-ink-secondary" title={booking.staff_name}>
            {booking.staff_name}
          </div>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </Card>
    </li>
  );
}

const STATUS_META: Record<string, { label: string; tone: 'confirmed' | 'pending' | 'neutral' }> = {
  requested: { label: '確認待ち', tone: 'pending' },
  confirmed: { label: '確定', tone: 'confirmed' },
  rejected: { label: '不可', tone: 'neutral' },
  expired: { label: '期限切れ', tone: 'neutral' },
  cancelled: { label: 'キャンセル', tone: 'neutral' },
  completed: { label: '完了', tone: 'neutral' },
  no_show: { label: '無断キャンセル', tone: 'neutral' },
};
