import { useEffect, useRef, useState } from 'react';
import liff from '@line/liff';
import { api } from '../lib/api.js';
import type { SlotPick } from './DateTimePicker.js';
import { addMinutesHm, formatJpLong } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import Icon from './ui/Icon.js';
import Button from './ui/Button.js';
import BottomBar from './ui/BottomBar.js';

type PayPhase = 'confirm' | 'waiting' | 'paid' | 'expired';

/**
 * お支払いありの予約の続き (★V8)。
 * ⑤確認 (CbGpr) → ⑥お支払い (RmjcT) → ⑦確定 (qJNti)。
 * 払い終わらなかったときは v9WJd。
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
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  // 開いたときに記録の金額・期限を読み直す (作りたての記録が正)。
  useEffect(() => {
    let alive = true;
    api
      .bookingPaymentStatus(bookingId)
      .then((res) => {
        if (!alive) return;
        if (typeof res.payment?.amount === 'number') setAmount(res.payment.amount);
        if (typeof res.payment?.hold_until === 'string') setHoldUntil(res.payment.hold_until);
        if (res.payment?.status === 'paid') {
          setPhase('paid');
        } else if (res.payment?.status === 'expired' || res.payment?.status === 'failed') {
          setPhase('expired');
        }
      })
      .catch((e) => logFailure('payment-status-initial', e));
    return () => {
      alive = false;
    };
  }, [bookingId]);

  function stopPolling() {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }

  useEffect(() => stopPolling, []);

  async function refreshStatus() {
    setChecking(true);
    setError(null);
    try {
      const res = await api.bookingPaymentStatus(bookingId);
      const status = res.payment?.status;
      if (status === 'paid') {
        stopPolling();
        setPhase('paid');
      } else if (status === 'expired' || status === 'failed') {
        stopPolling();
        setPhase('expired');
      }
    } catch (e) {
      logFailure('payment-status', e);
      setError('状態を確認できませんでした。時間をおいて再度お試しください。');
    } finally {
      setChecking(false);
    }
  }

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      const res = await api.startBookingPayment(bookingId);
      if (res.checkoutUrl) {
        setCheckoutUrl(res.checkoutUrl);
        setPhase('waiting');
        // 決済画面は外のブラウザで開く (店内の WebView では 3D セキュア等が動かないことがある)。
        liff.openWindow({ url: res.checkoutUrl, external: true });
        stopPolling();
        timer.current = window.setInterval(() => {
          void refreshStatus();
        }, 3000);
      } else {
        // 決済画面が無い (店頭払い等) のにここへ来たときは待ちに戻す。
        setPhase('waiting');
      }
    } catch (e) {
      logFailure('payment-start', e);
      setError('お支払いを始められませんでした。時間をおいて再度お試しください。');
    } finally {
      setStarting(false);
    }
  }

  if (phase === 'paid') {
    return (
      <div className="space-y-3.5" data-design-node="qJNti">
        <div className="flex flex-col items-center px-6 pt-8 pb-2 text-center">
          <span
            className="flex h-18 w-18 items-center justify-center rounded-full bg-liff-soft text-liff-primary"
            aria-hidden="true"
          >
            <Icon name="check" className="h-9 w-9" />
          </span>
          <p className="mt-4 text-xl font-bold text-ink">お支払いが終わりました</p>
          <p className="mt-2 text-[13px] leading-6 text-pretty text-liff-sub">
            ご予約は確定です。当日お待ちしています。
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
        <Button variant="primary" onClick={handleStart} disabled={starting}>
          {starting ? '準備中...' : `¥${amount.toLocaleString()}を支払う`}
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
        <dt className="w-18 shrink-0 text-xs text-liff-sub">メニュー</dt>
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
  const jst = new Date(date.getTime() + 9 * 3600_000);
  return `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日 ${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
}
