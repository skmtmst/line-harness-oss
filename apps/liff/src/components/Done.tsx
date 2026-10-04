import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import liff from '@line/liff';
import { addMinutesHm, formatJpLong } from '../lib/datetime.js';
import { api } from '../lib/api.js';
import { logFailure } from '../lib/user-message.js';
import Button from './ui/Button.js';
import BottomBar from './ui/BottomBar.js';
import Icon from './ui/Icon.js';
import type { SlotPick } from './DateTimePicker.js';

/**
 * 1-e 受け付けました (★V8・VU6Xi)。緑の丸の印＋題＋送った内容のカード。
 * 下の帯は「LINEに戻る」(主) と「予約の履歴を見る」(副)。
 * (撮影: ボタン名は「予約の履歴を見る」のまま)
 */
export default function Done({
  menuName,
  slot,
  durationMinutes,
  status,
  bookingId,
  prepayNotice,
}: {
  menuName: string;
  slot: SlotPick;
  durationMinutes: number;
  /** 作られた予約の状態。confirmed なら未承認の表示を出さない。 */
  status: string;
  /** 予約ID（前払いのみの案内があるときだけ使う）。 */
  bookingId?: string | null;
  /** 無断キャンセルが続いている人への前払いのみの案内。無いときは出さない。 */
  prepayNotice?: string | null;
}) {
  // initLiff() は ?liffId=... をクエリから読むので、内部遷移でも保持する。
  // search を維持しないと「予約の履歴を見る」→ WebView 再読み込みで liffId が失われる。
  const { search } = useLocation();
  const navigate = useNavigate();
  /** お支払いへ進む：starting | phone（決済が無い店）| failed。 */
  const [payState, setPayState] = useState<'idle' | 'starting' | 'phone' | 'failed'>('idle');

  async function startPayment() {
    if (!bookingId || payState === 'starting') return;
    setPayState('starting');
    try {
      const res = await api.startBookingPayment(bookingId);
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      // 決済の用意が無い店では電話での確認に案内する。
      setPayState('phone');
    } catch (e) {
      logFailure('start-booking-payment', e);
      setPayState('failed');
    }
  }

  return (
    <div className="space-y-3.5" data-design-node="VU6Xi">
      <div className="flex flex-col items-center px-6 pt-8 pb-2 text-center">
        <span
          className="flex h-18 w-18 items-center justify-center rounded-full bg-liff-soft text-liff-primary"
          aria-hidden="true"
        >
          <Icon name="check" className="h-9 w-9" />
        </span>
        <p className="mt-4 text-xl font-bold text-ink">
          {status === 'confirmed' ? '予約が確定しました' : 'リクエストを受け付けました'}
        </p>
        <p className="mt-2 text-[13px] leading-6 text-pretty text-liff-sub">
          {status === 'confirmed' ? (
            <>
              変更・キャンセルはお店へご連絡ください。
              <br />
              この画面は閉じてかまいません。
            </>
          ) : (
            <>
              お店が確かめたら、LINEでお知らせします。
              <br />
              この画面は閉じてかまいません。
            </>
          )}
        </p>
      </div>
      <dl className="divide-y divide-liff-divider rounded-(--liff-radius-lg) bg-canvas px-3.5 py-1 outline outline-1 -outline-offset-1 outline-liff-line">
        <div className="flex items-baseline gap-2 py-2.5">
          <dt className="w-18 shrink-0 text-xs text-liff-sub">日時</dt>
          <dd className="min-w-0 flex-1 text-sm font-semibold text-ink">
            {formatJpLong(slot.date)} {slot.start}〜{addMinutesHm(slot.start, durationMinutes)}
          </dd>
        </div>
        <div className="flex items-baseline gap-2 py-2.5">
          <dt className="w-18 shrink-0 text-xs text-liff-sub">メニュー</dt>
          <dd className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={menuName}>
            {menuName}
          </dd>
        </div>
        <div className="flex items-baseline gap-2 py-2.5">
          <dt className="w-18 shrink-0 text-xs text-liff-sub">状態</dt>
          <dd className="min-w-0 flex-1 text-sm font-semibold text-ink">
            {status === 'confirmed' ? '確定' : 'お店の確認待ち'}
          </dd>
        </div>
      </dl>
      {prepayNotice && (
        <section
          aria-label="事前のお支払いのお願い"
          className="rounded-(--liff-radius-lg) bg-canvas p-3.5 outline-1 -outline-offset-1 outline-liff-line"
        >
          <p className="text-[15px] font-bold text-ink">事前のお支払いをお願いしています</p>
          <p className="mt-1 text-[13px] leading-6 text-liff-sub">{prepayNotice}</p>
          {payState === 'phone' ? (
            <p className="mt-2 text-[13px] leading-6 text-ink" role="status">
              このお店ではアプリでのお支払いができません。お手数ですが、お店に電話で確認してください。
            </p>
          ) : (
            <Button
              variant="primary"
              onClick={startPayment}
              disabled={payState === 'starting'}
              className="mt-3"
            >
              {payState === 'starting' ? 'お支払いへ進んでいます…' : 'お支払いへ進む'}
            </Button>
          )}
          {payState === 'failed' && (
            <p className="mt-2 text-[13px] leading-6 text-danger" role="alert">
              お支払いの用意に失敗しました。電波の良い所でもう一度押してください。
            </p>
          )}
        </section>
      )}
      <div className="pb-40" aria-hidden="true" />
      <BottomBar>
        <Button variant="primary" onClick={() => liff.closeWindow()}>
          LINEに戻る
        </Button>
        <Button
          variant="secondary"
          onClick={() => navigate({ pathname: '/booking/history', search })}
        >
          <Icon name="calendar-days" className="h-4 w-4" />
          予約の履歴を見る
        </Button>
      </BottomBar>
    </div>
  );
}
