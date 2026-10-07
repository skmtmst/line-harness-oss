import type { BookingHistoryItem } from '../lib/api.js';
import { utcToJstHm, utcToJstMd } from '../lib/datetime.js';
import Card from './ui/Card.js';
import Badge from './ui/Badge.js';
import Button from './ui/Button.js';

/**
 * 予約の履歴の札 (★V8・YvTJ3)。日付の四角＋メニュー名＋状態の札。
 * 下に「日時を変える／キャンセル」の2ボタン (F-6 本人の変更・取消)。
 * 押す口が渡されたときだけ出す (履歴の口が版などを返さないと送れないため、呼び側が決める)。
 */
export default function HistoryCard({
  booking,
  onChange,
  onCancel,
  disabled = false,
}: {
  booking: BookingHistoryItem;
  onChange?: () => void;
  onCancel?: () => void;
  disabled?: boolean;
}) {
  const meta = STATUS_META[booking.status] ?? { label: booking.status, tone: 'neutral' as const };
  const hasActions = Boolean(onChange || onCancel);
  return (
    <li>
      <Card className="flex flex-col gap-2.5 p-3.5">
        <div className="flex items-center gap-3">
          <div className="flex w-14 shrink-0 flex-col items-center rounded-(--liff-radius) bg-liff-off-bg py-1.5">
            <span className="liff-num text-[15px] leading-[18px] font-bold whitespace-nowrap text-ink">
              {utcToJstMd(booking.starts_at)}
            </span>
            <span className="liff-num text-[11px] leading-[13px] text-liff-sub">{utcToJstHm(booking.starts_at)}</span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-start gap-[3px]">
            <div className="w-full truncate text-sm leading-normal font-bold text-ink" title={booking.menu_name}>
              {booking.menu_name}
            </div>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
        </div>
        {hasActions && (
          <div className="flex gap-2">
            {onChange && (
              <Button variant="secondary" className="flex-1" disabled={disabled} onClick={onChange}>
                日時を変える
              </Button>
            )}
            {onCancel && (
              <Button variant="secondary" className="flex-1" disabled={disabled} onClick={onCancel}>
                キャンセル
              </Button>
            )}
          </div>
        )}
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
