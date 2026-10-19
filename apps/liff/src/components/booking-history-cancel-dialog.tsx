import { formatYen } from '@line-crm/shared';
import type { BookingHistoryItem } from '../lib/api.js';
import type { PaymentView } from '../lib/booking-payment-view.js';
import { utcToJstHm, utcToJstMd } from '../lib/datetime.js';
import Button from './ui/button/index.js';
import ConfirmDialog from './ui/confirm-dialog.js';

/** 予約の取消前に、予約の内容と支払い済みの返金を知らせる。 */
export default function BookingHistoryCancelDialog({ booking, payment, busy, error, onConfirm, onCancel }: {
  booking: BookingHistoryItem | null;
  payment: PaymentView | null;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const paid = payment?.kind === 'paid' && (booking?.cancellationQuote?.feeNow ?? 0) === 0 ? payment : null;
  return (
      <ConfirmDialog
        open={booking !== null}
        surface={paid ? 'sheet' : 'dialog'}

        title={
          paid
            ? 'この予約をキャンセルしますか？'
            : booking
              ? `${utcToJstMd(booking.starts_at)} ${utcToJstHm(booking.starts_at)} の${booking.menu_name}をキャンセルしますか`
              : ''
        }
        description={paid && booking
          ? `${utcToJstMd(booking.starts_at)} ${utcToJstHm(booking.starts_at)}・${booking.menu_name}・${booking.staff_name}`
          : 'キャンセルすると元に戻せません。キャンセルの期限を過ぎると、ここからは変えられません（トークでご連絡ください）。'}
        error={error ?? undefined}
        confirmLabel={paid ? 'キャンセルする（試験返金）' : 'キャンセルする'}
        cancelLabel={paid ? 'やめる' : '閉じる'}
        destructive
        busy={busy}
        footer={paid ? (
          <div className="flex flex-col gap-2.5">
            <Button variant="danger" disabled={busy} onClick={onConfirm}>キャンセルする（試験返金）</Button>
            <Button variant="secondary" disabled={busy} onClick={onCancel}>やめる</Button>
          </div>
        ) : undefined}
        onCancel={onCancel}
        onConfirm={onConfirm}
      >
        {/* 払い済みの予約のキャンセル（hOILq・B-338）：試験の返金であることを先に知らせる。 */}
        {paid ? (
          <div className="flex flex-col gap-1 rounded-(--liff-radius) bg-liff-ok-bg px-3.5 py-3" data-refund-note>
            <p className="text-[14px] leading-[20px] font-bold text-liff-ok-ink">{paid.amount == null ? '試験の全額返金を記録します（金額は未取得です）' : `試験のお支払い ${formatYen(paid.amount)} の全額返金を試験で記録します`}</p>
            <p className="text-[12px] leading-[18px] text-ink">実際のカードへの請求・返金は行われません。カード決済は準備中です。</p>
          </div>
        ) : null}
        {!paid && payment?.kind === 'paid' ? <p className="text-[12px] leading-[18px] text-liff-sub">返金についてはトークで担当者へご確認ください。</p> : null}
        {paid ? <p className="text-[12px] leading-[18px] text-liff-sub">{booking?.cancel_deadline_at ? `この画面でのキャンセル期限：${utcToJstMd(booking.cancel_deadline_at)} ${utcToJstHm(booking.cancel_deadline_at)} まで。過ぎたときはトークでご連絡ください。` : 'キャンセルの期限を過ぎたときは、トークで担当者へご連絡ください。'}</p> : null}
      </ConfirmDialog>
  );
}
