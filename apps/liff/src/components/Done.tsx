import { useLocation, useNavigate } from 'react-router-dom';
import liff from '@line/liff';
import { addMinutesHm, formatJpLong } from '../lib/datetime.js';
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
}: {
  menuName: string;
  slot: SlotPick;
  durationMinutes: number;
}) {
  // initLiff() は ?liffId=... をクエリから読むので、内部遷移でも保持する。
  // search を維持しないと「予約の履歴を見る」→ WebView 再読み込みで liffId が失われる。
  const { search } = useLocation();
  const navigate = useNavigate();

  return (
    <div className="space-y-3.5" data-design-node="VU6Xi">
      <div className="flex flex-col items-center px-6 pt-8 pb-2 text-center">
        <span
          className="flex h-18 w-18 items-center justify-center rounded-full bg-liff-soft text-liff-primary"
          aria-hidden="true"
        >
          <Icon name="check" className="h-9 w-9" />
        </span>
        <p className="mt-4 text-xl font-bold text-ink">リクエストを受け付けました</p>
        <p className="mt-2 text-[13px] leading-6 text-pretty text-liff-sub">
          お店が確かめたら、LINEでお知らせします。
          <br />
          この画面は閉じてかまいません。
        </p>
      </div>
      <dl className="divide-y divide-liff-divider rounded-[14px] bg-canvas px-3.5 py-1 outline outline-1 -outline-offset-1 outline-liff-line">
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
          <dd className="min-w-0 flex-1 text-sm font-semibold text-ink">お店の確認待ち</dd>
        </div>
      </dl>
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
