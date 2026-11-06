import { useEffect, useState } from 'react';
import { formatYen, type BookingCancellationReview, type BookingCancellationConfirmation } from '@line-crm/shared';
import { api, type BookingHistoryItem } from '../lib/api.js';
import { ChoiceInput } from './forms/controls.js';
import LoadErrorView from './load-error-view.js';
import type { PaymentView } from '../lib/booking-payment-view.js';
import { utcToJstHm, utcToJstMd } from '../lib/datetime.js';
import Button from './ui/button/index.js';
import ConfirmDialog from './ui/confirm-dialog.js';

/** 予約の取消前に、予約の内容と支払い済みの返金を知らせる。 */
export default function BookingHistoryCancelDialog({ booking, payment, busy, error, refreshKey = 0, onConfirm, onCancel, onReload }: {
  booking: BookingHistoryItem | null;
  payment: PaymentView | null;
  busy: boolean;
  error: string | null;
  refreshKey?: number;
  onConfirm: (confirmation?:BookingCancellationConfirmation,deadline?:string) => void;
  onCancel: () => void;
  onReload?: () => void;
}) {
  const [review,setReview]=useState<BookingCancellationReview|null>(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0),[accepted,setAccepted]=useState(false),[loadedKey,setLoadedKey]=useState('');
  const needsReview=Boolean(booking?.cancellationQuote?.policyAcceptedRequired || (booking?.cancellationQuote?.feeNow??0)>0 || refreshKey);
  const key=JSON.stringify([booking?.id,booking?.lock_version,refreshKey,retry]);
  useEffect(()=>{let alive=true;setReview(null);setFailed(false);setAccepted(false);setLoadedKey('');
    if(booking&&needsReview)void Promise.resolve().then(()=>api.cancellationQuote(booking.id)).then(value=>{
      if(!Number.isSafeInteger(value.feeNow)||value.feeNow<0||typeof value.canCancel!=='boolean'||!Number.isInteger(value.lockVersion)||!Number.isFinite(Date.parse(value.cancelDeadlineAt)))throw new Error('invalid_cancellation_quote');
      if(alive){setReview(value);setLoadedKey(key)}
    }).catch(()=>{if(alive)setFailed(true)});
    return()=>{alive=false};
  },[key,needsReview]);
  const ready=!needsReview || (loadedKey===key&&review!==null);
  const fee=needsReview?(review?.feeNow??0):0;
  const changed=Boolean(review&&review.lockVersion!==booking?.lock_version);
  const canConfirm=ready&&!failed&&!changed&&(!review||(review.canCancel&&Date.now()<=Date.parse(review.cancelDeadlineAt)&&Date.now()<Date.parse(booking!.starts_at)))&&(fee===0||accepted);
  const confirm=()=>{if(!canConfirm||busy)return;onConfirm(fee>0?{feeAccepted:true,expectedFeeAmount:fee}:undefined,review?.cancelDeadlineAt)};
  const paid = payment?.kind === 'paid' && ready && fee === 0 ? payment : null;
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
          : needsReview ? '取り消す前に、今回のキャンセル料と期限を確認してください。' : 'キャンセルすると元に戻せません。キャンセルの期限を過ぎると、ここからは変えられません（トークでご連絡ください）。'}
        error={error ?? undefined}
        confirmLabel={paid ? 'キャンセルする（試験返金）' : 'キャンセルする'}
        cancelLabel={paid ? 'やめる' : '閉じる'}
        destructive
        busy={busy}
        confirmDisabled={!canConfirm}
        footer={paid ? (
          <div className="flex flex-col gap-2.5">
            <Button variant="danger" disabled={busy || !canConfirm} onClick={confirm}>キャンセルする（試験返金）</Button>
            <Button variant="secondary" disabled={busy} onClick={onCancel}>やめる</Button>
          </div>
        ) : undefined}
        onCancel={onCancel}
        onConfirm={confirm}
      >
        {needsReview&&!ready&&!failed?<p role="status">キャンセル料を確認しています…</p>:null}
        {failed?<LoadErrorView compact message="キャンセル料を確認できませんでした。" onRetry={()=>{if(!busy)setRetry(n=>n+1)}}/>:null}
        {ready&&review?<div className="space-y-3 py-3">
          <p className="text-sm font-bold">{fee>0?`今取り消すとキャンセル料 ${formatYen(fee)} が掛かります`:'今なら無料で取り消せます'}</p>
          {review.freeUntil?<p className="text-xs text-liff-sub">{`${utcToJstMd(review.freeUntil)} ${utcToJstHm(review.freeUntil)} まで無料`}</p>:null}
          <p className="text-xs text-liff-sub">{`この画面でのキャンセルは ${utcToJstMd(review.cancelDeadlineAt)} ${utcToJstHm(review.cancelDeadlineAt)} ${review.policyAcceptedRequired?'の開始前までです。':'までです。'}`}</p>
          {fee>0?<label className="flex items-center gap-2 text-sm"><ChoiceInput type="checkbox" checked={accepted} disabled={busy} onChange={event=>setAccepted(event.target.checked)}/>キャンセル料の決まりを確認しました</label>:null}
          {changed||!review.canCancel?<><p role="alert">予約の内容や期限が変わっています。予約を読み直してください。</p>{onReload?<Button disabled={busy} onClick={onReload}>予約を読み直す</Button>:null}</>:null}
        </div>:null}
        {/* 払い済みの予約のキャンセル（hOILq）：試験の返金であることを先に知らせる。 */}
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
