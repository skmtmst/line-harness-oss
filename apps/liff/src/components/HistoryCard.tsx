import type { BookingHistoryItem } from '../lib/api.js';
import { utcToJstHm, utcToJstMd } from '../lib/datetime.js';
import Card from './ui/Card.js';
import Badge from './ui/Badge.js';

/**
 * 予約の履歴の札 (★V8・YvTJ3)。日付の四角＋メニュー名＋状態の札。
 * 「日時を変える／キャンセル」の2ボタンは機能追加 F-6・API待ちのため付けない
 * (LIFF から予約を変える・消す口はまだ無い)。
 */
export default function HistoryCard({ booking }: { booking: BookingHistoryItem }) {
  const meta = STATUS_META[booking.status] ?? { label: booking.status, tone: 'neutral' as const };
  return (
    <li>
      <Card className="flex items-center gap-3 p-3.5">
        <div className="flex w-14 shrink-0 flex-col items-center rounded-[var(--liff-look-radius)] bg-[var(--liff-look-off-bg)] py-1.5">
          <span className="text-xs font-semibold whitespace-nowrap text-[var(--liff-look-ink)]">
            {utcToJstMd(booking.starts_at)}
          </span>
          <span className="text-[11px] text-[var(--liff-look-sub)]">{utcToJstHm(booking.starts_at)}</span>
        </div>
        <div className="min-w-0 flex-1 space-y-[3px]">
          <div className="truncate text-sm font-bold text-[var(--liff-look-ink)]" title={booking.menu_name}>
            {booking.menu_name}
          </div>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
      </Card>
    </li>
  );
}

const STATUS_META: Record<string, { label: string; tone: 'confirmed' | 'pending' | 'neutral' }> = {
  requested: { label: 'お店の確認待ち', tone: 'pending' },
  confirmed: { label: '確定', tone: 'confirmed' },
  rejected: { label: '不可', tone: 'neutral' },
  expired: { label: '期限切れ', tone: 'neutral' },
  cancelled: { label: 'キャンセル', tone: 'neutral' },
  completed: { label: '完了', tone: 'neutral' },
  no_show: { label: '無断キャンセル', tone: 'neutral' },
};
