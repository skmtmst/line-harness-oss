import { useLocation, useNavigate } from 'react-router-dom';
import liff from '@line/liff';
import { formatJpLong } from '../lib/datetime.js';
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
  status,
}: {
  menuName: string;
  slot: SlotPick;
  /** 作られた予約の状態。confirmed なら未承認の表示を出さない。 */
  status: string;
}) {
  // initLiff() は ?liffId=... をクエリから読むので、内部遷移でも保持する。
  // search を維持しないと「予約の履歴を見る」→ WebView 再読み込みで liffId が失われる。
  const { search } = useLocation();
  const navigate = useNavigate();

  return (
    <div className="space-y-3.5" data-design-node="VU6Xi">
      {/* 板 VU6Xi：上に 40 空け、丸・題・説明・箱の間は 14。 */}
      <div className="flex flex-col items-center pt-10 text-center">
        <span
          className="mt-3.5 flex h-18 w-18 items-center justify-center rounded-full bg-liff-soft text-liff-primary"
          aria-hidden="true"
        >
          <Icon name="check" className="h-9 w-9" />
        </span>
        <p className="mt-3.5 text-xl font-bold text-ink">
          {status === 'confirmed' ? '予約が確定しました' : 'リクエストを受け付けました'}
        </p>
        <p className="mt-3.5 text-[13px] leading-[21px] text-pretty text-liff-sub">
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
        <div className="flex h-10 items-start gap-2 py-2.5">
          <dt className="w-18 shrink-0 text-xs text-liff-sub">日時</dt>
          <dd className="min-w-0 flex-1 text-sm font-semibold text-ink">
            {/* 板 VU6Xi は始まりの時刻だけ (「13:00〜」)。終わりは確認の段で見せている。 */}
            {`${formatJpLong(slot.date)}${slot.start}〜`}
          </dd>
        </div>
        <div className="flex h-10 items-start gap-2 py-2.5">
          <dt className="w-18 shrink-0 text-xs text-liff-sub">メニュー</dt>
          <dd className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={menuName}>
            {menuName}
          </dd>
        </div>
        <div className="flex h-10 items-start gap-2 py-2.5">
          <dt className="w-18 shrink-0 text-xs text-liff-sub">状態</dt>
          <dd className="min-w-0 flex-1 text-sm font-semibold text-ink">
            {status === 'confirmed' ? '確定' : 'お店の確認待ち'}
          </dd>
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
          予約の履歴を見る
        </Button>
      </BottomBar>
    </div>
  );
}
