import type { BookingHistoryItem } from '../lib/api.js';
import type { PaymentView } from '../lib/booking-payment-view.js';
import { utcToJstHm, utcToJstMd } from '../lib/datetime.js';
import Button from '../components/ui/Button.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.js';

/** 予約の取消前に、予約の内容と支払い済みの返金を知らせる。 */
export default function BookingHistoryCancelDialog({ booking, payment, busy, error, onConfirm, onCancel }: {
  booking: BookingHistoryItem | null;
  payment: PaymentView | null;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
      <ConfirmDialog
        open={booking !== null}
        surface={payment ? 'sheet' : 'dialog'}

        title={
          payment
            ? 'この予約をキャンセルしますか？'
            : booking
              ? `${utcToJstMd(booking.starts_at)} ${utcToJstHm(booking.starts_at)} の${booking.menu_name}をキャンセルしますか`
              : ''
        }
        description={payment && booking
          ? `${utcToJstMd(booking.starts_at)} ${utcToJstHm(booking.starts_at)}・${booking.menu_name}・${booking.staff_name}`
          : 'キャンセルすると元に戻せません。キャンセルの期限を過ぎると、ここからは変えられません（トークでご連絡ください）。'}
        error={error ?? undefined}
        confirmLabel={payment ? 'キャンセルして返金を受ける' : 'キャンセルする'}
        cancelLabel={payment ? 'やめる' : '閉じる'}
        destructive
        busy={busy}
        footer={payment ? (
          <div className="flex flex-col gap-2.5">
            <Button variant="danger" disabled={busy} onClick={onConfirm}>キャンセルして返金を受ける</Button>
            <Button variant="secondary" disabled={busy} onClick={onCancel}>やめる</Button>
          </div>
        ) : undefined}
        onCancel={onCancel}
        onConfirm={onConfirm}
      >
        {/* 払い済みの予約のキャンセル（hOILq・B-338）：期限内は全額返金を先に知らせる。 */}
        {payment ? (
          <div className="flex flex-col gap-1 rounded-(--liff-radius) bg-liff-ok-bg px-3.5 py-3" data-refund-note>
            <p className="text-[14px] leading-[20px] font-bold text-liff-ok-ink">{`お支払い済みの ¥${Math.round(payment.amount ?? 0).toLocaleString('ja-JP')} は全額返金します`}</p>
            <p className="text-[12px] leading-[18px] text-ink">カードへの反映まで 5〜10 日かかることがあります。</p>
          </div>
        ) : null}
        {payment ? <p className="text-[12px] leading-[18px] text-liff-sub">{booking?.cancel_deadline_at ? `キャンセルの期限：${utcToJstMd(booking.cancel_deadline_at)} ${utcToJstHm(booking.cancel_deadline_at)} まで。過ぎると返金はありません。` : 'キャンセルの期限を過ぎると返金はありません。'}</p> : null}
      </ConfirmDialog>
  );
}
