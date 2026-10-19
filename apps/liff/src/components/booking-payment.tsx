import { jstCalendar as japanCalendar } from '@line-crm/shared';
import PaymentPreparingNote from './payment-preparing-note.js';
import { useVisiblePolling } from '../lib/use-visible-polling.js';
import { CUSTOMER_WORDS, PAYMENT_UNKNOWN } from '../lib/customer-words.js';
import { useEffect, useRef, useState } from 'react';
import liff from '@line/liff';
import { api } from '../lib/api.js';
import type { SlotPick } from './date-time-picker.js';
import { addMinutesHm, formatJpLong } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import Icon from './ui/icon.js';
import Button from './ui/button/index.js';
import BottomBar from './ui/bottom-bar.js';

type PayPhase = 'confirm' | 'waiting' | 'paid' | 'expired' | 'unknown';

/**
 * お支払いありの予約の続き (★V8)。
 * ⑤確認  → ⑥お支払い  → ⑦確定 。
 * 払い終わらなかったときは 。
 * お支払いなしの店ではこの画面は出ない (出さない側で切り替える)。
 */
export default function BookingPayment({
  bookingId,
  menuName,
  initialAmount,
  slot,
  durationMinutes,
}: {
  bookingId: string;
  menuName: string;
  initialAmount: number;
  slot: SlotPick;
  durationMinutes: number;
}) {
  const [phase, setPhase] = useState<PayPhase>('confirm');
  const [amount, setAmount] = useState(initialAmount);
  const [holdUntil, setHoldUntil] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);

  // 開いたときに記録の金額・期限を読み直す (作りたての記録が正)。
  useEffect(() => {
    let alive = true;
    const mine = ++generation.current;
    setReady(false);
    setPhase('confirm');
    setCheckoutUrl(null);
    setError(null);
    api
      .bookingPaymentStatus(bookingId)
      .then((res) => {
        if (!alive || mine !== generation.current) return;
        if (res.operation_status === 'unknown' || res.action_required) { setPhase('unknown'); return; }
        setReady(true);
        if (res.payment?.status === 'failed') { setPhase('unknown'); return; }
        if (typeof res.payment?.amount === 'number') setAmount(res.payment.amount);
        if (typeof res.payment?.hold_until === 'string') setHoldUntil(res.payment.hold_until);
        if (res.payment?.status === 'paid') {
          setPhase('paid');
        } else if (res.payment?.status === 'expired') {
          setPhase('expired');
        }
      })
      .catch((e) => { if (alive) { logFailure('payment-status-initial', e); setPhase('unknown'); } });
    return () => {
      alive = false;
      generation.current++;
    };
  }, [bookingId]);

  async function refreshStatus(): Promise<boolean> {
    if (inFlight.current) return true;
    const mine = generation.current;
    inFlight.current = true;
    setChecking(true);
    setError(null);
    try {
      const res = await api.bookingPaymentStatus(bookingId);
      if (mine !== generation.current) return false;
      if (res.operation_status === 'unknown' || res.action_required) { setPhase('unknown'); return false; }
      const status = res.payment?.status;
      if (status === 'failed') { setPhase('unknown'); return false; }
      if (status === 'paid') {
        setPhase('paid');
      } else if (status === 'expired') {
        setPhase('expired');
      }
      return status !== 'paid' && status !== 'expired';
    } catch (e) {
      if (mine !== generation.current) return false;
      logFailure('payment-status', e);
      setError('状態を確認できませんでした。時間をおいて再度お試しください。');
      return false;
    } finally {
      inFlight.current = false;
      if (mine === generation.current) setChecking(false);
    }
  }

  useVisiblePolling(refreshStatus, phase === 'waiting', 3000);

  async function handleStart() {
    if (inFlight.current || !ready) return;
    const mine = generation.current;
    inFlight.current = true;
    setStarting(true);
    setError(null);
    try {
      const res = await api.startBookingPayment(bookingId);
      if (mine !== generation.current) return;
      if (res.checkoutUrl) {
        setCheckoutUrl(res.checkoutUrl);
        setPhase('waiting');
        // 決済画面は外のブラウザで開く (店内の WebView では 3D セキュア等が動かないことがある)。
        liff.openWindow({ url: res.checkoutUrl, external: true });

      } else {
        // 決済画面が無い (店頭払い等) のにここへ来たときは待ちに戻す。
        setPhase('waiting');
      }
    } catch (e) {
      if (mine !== generation.current) return;
      logFailure('payment-start', e);
      // 開始要求の時間切れは、受理されている可能性がある。新しい開始を勧めない。
      setPhase('unknown');
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  }

  if (phase === 'unknown') return <div className="space-y-3.5">
    <PaymentPreparingNote />
    <p role="status" className="text-sm leading-6 text-ink">{PAYMENT_UNKNOWN}</p>
    <BottomBar><Button variant="primary" onClick={() => liff.closeWindow()}>LINEに戻る</Button></BottomBar>
  </div>;

  if (phase === 'paid') {
    return (
      <div className="space-y-3.5" data-design-node="qJNti">
        <PaymentPreparingNote />
        <div className="flex flex-col items-center px-6 pt-8 pb-2 text-center">
          <span
            className="flex h-18 w-18 items-center justify-center rounded-full bg-liff-soft text-liff-primary"
            aria-hidden="true"
          >
            <Icon name="check" className="h-9 w-9" />
          </span>
          <p className="mt-4 text-xl font-bold text-ink">試験のお支払いを確認しました</p>
          <p className="mt-2 text-[13px] leading-6 text-pretty text-liff-sub">
            予約の状態は予約履歴でご確認ください。
            <br />
            この画面は閉じてかまいません。
          </p>
        </div>
        <PaymentCard menuName={menuName} amount={amount} slot={slot} durationMinutes={durationMinutes} statusLabel="支払い済み" />
        <div className="pb-40" aria-hidden="true" />
        <BottomBar>
          <Button variant="primary" onClick={() => liff.closeWindow()}>
            LINEに戻る
          </Button>
        </BottomBar>
      </div>
    );
  }

  if (phase === 'expired') {
    return (
      <div className="space-y-3.5" data-design-node="v9WJd">
        <PaymentPreparingNote />
        <h2 className="text-xl font-bold text-ink">お支払いが終わりませんでした</h2>
        <p className="text-[13px] leading-6 text-liff-sub">
          仮押さえの期限が切れたため、この予約は取り消されました。料金はいただいていません。
          もう一度、はじめから予約を取り直してください。
        </p>
        <div className="pb-40" aria-hidden="true" />
        <BottomBar>
          <Button variant="primary" onClick={() => liff.closeWindow()}>
            LINEに戻る
          </Button>
        </BottomBar>
      </div>
    );
  }

  if (phase === 'waiting') {
    return (
      <div className="space-y-3.5" data-design-node="RmjcT">
        <PaymentPreparingNote />
        <h2 className="text-xl font-bold text-ink">お支払い待ちです</h2>
        <p className="text-[13px] leading-6 text-liff-sub">
          決済画面でお支払いを済ませてください。終わったら自動で進みます。
          画面が戻らないときは、下のボタンで状態を確認できます。
        </p>
        <PaymentCard menuName={menuName} amount={amount} slot={slot} durationMinutes={durationMinutes} statusLabel="お支払い待ち" />
        {checkoutUrl && (
          <p className="text-[13px] leading-6 text-liff-sub">
            決済画面が開かないときは
            <a className="underline" href={checkoutUrl} target="_blank" rel="noreferrer">
              こちら
            </a>
            から開けます。
          </p>
        )}
        {error && (
          <p role="alert" className="text-[13px] leading-6 text-danger">
            {error}
          </p>
        )}
        <div className="pb-40" aria-hidden="true" />
        <BottomBar>
          <Button variant="primary" onClick={refreshStatus} disabled={checking}>
            {checking ? '確認中...' : '支払いの状態を確認する'}
          </Button>
        </BottomBar>
      </div>
    );
  }

  return (
    <div className="space-y-3.5" data-design-node="CbGpr">
      <PaymentPreparingNote />
      <h2 className="text-xl font-bold text-ink">お支払いの確認</h2>
      <PaymentCard menuName={menuName} amount={amount} slot={slot} durationMinutes={durationMinutes} statusLabel="未払い" />
      <div className="flex gap-2 rounded-[10px] bg-liff-note p-3 text-xs leading-5 text-ink">
        <Icon name="info" className="h-4 w-4 shrink-0 text-liff-sub" />
        <p>
          このまま進むと予約が仮押さえされます。
          {holdUntil && `お支払いは ${formatHoldUntil(holdUntil)} までにお願いします。`}
          期限を過ぎると予約は取り消されます。
        </p>
      </div>
      {error && (
        <p role="alert" className="text-[13px] leading-6 text-danger">
          {error}
        </p>
      )}
      <div className="pb-40" aria-hidden="true" />
      <BottomBar>
        <Button variant="primary" onClick={handleStart} disabled={starting || !ready}>
          {starting ? '準備中...' : `¥${amount.toLocaleString()}の試験へ進む`}
        </Button>
      </BottomBar>
    </div>
  );
}

function PaymentCard({
  menuName,
  amount,
  slot,
  durationMinutes,
  statusLabel,
}: {
  menuName: string;
  amount: number;
  slot: SlotPick;
  durationMinutes: number;
  statusLabel: string;
}) {
  return (
    <dl className="divide-y divide-liff-divider rounded-[14px] bg-canvas px-3.5 py-1 outline outline-1 -outline-offset-1 outline-liff-line">
      <div className="flex items-baseline gap-2 py-2.5">
        <dt className="w-18 shrink-0 text-xs text-liff-sub">{CUSTOMER_WORDS.bookingContent}</dt>
        <dd className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={menuName}>
          {menuName}
        </dd>
      </div>
      <div className="flex items-baseline gap-2 py-2.5">
        <dt className="w-18 shrink-0 text-xs text-liff-sub">日時</dt>
        <dd className="min-w-0 flex-1 text-sm font-semibold text-ink">
          {formatJpLong(slot.date)} {slot.start}〜{addMinutesHm(slot.start, durationMinutes)}
        </dd>
      </div>
      <div className="flex items-baseline gap-2 py-2.5">
        <dt className="w-18 shrink-0 text-xs text-liff-sub">金額</dt>
        <dd className="min-w-0 flex-1 text-sm font-semibold text-ink">¥{amount.toLocaleString()}</dd>
      </div>
      <div className="flex items-baseline gap-2 py-2.5">
        <dt className="w-18 shrink-0 text-xs text-liff-sub">状態</dt>
        <dd className="min-w-0 flex-1 text-sm font-semibold text-ink">{statusLabel}</dd>
      </div>
    </dl>
  );
}

function formatHoldUntil(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const jst = japanCalendar(date);
  return `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日 ${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
}
