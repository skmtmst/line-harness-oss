import { useLocation, useNavigate } from 'react-router-dom';
import { formatJp } from '../lib/datetime.js';
import StatusView from './ui/StatusView.js';
import Button from './ui/Button.js';
import Icon from './ui/Icon.js';
import type { SlotPick } from './DateTimePicker.js';

/**
 * 1-e 送信した。送信の印＋送った内容のカード＋「予約の履歴を見る」1つ。
 * (撮影: ボタン名は「予約の履歴を見る」のまま)
 */
export default function Done({ menuName, slot }: { menuName: string; slot: SlotPick }) {
  // initLiff() は ?liffId=... をクエリから読むので、内部遷移でも保持する。
  // search を維持しないと「予約の履歴を見る」→ WebView 再読み込みで liffId が失われる。
  const { search } = useLocation();
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <StatusView
        icon="send"
        tone="success"
        title="リクエストを送りました"
        body={'お店が確認すると、LINE にお知らせが届きます。\nこの画面は閉じて大丈夫です。'}
      />
      <dl className="space-y-3 rounded-xl border border-hairline bg-canvas p-4 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="shrink-0 text-ink-secondary">日時</dt>
          <dd className="font-medium text-ink">
            {formatJp(slot.date)} {slot.start}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="shrink-0 text-ink-secondary">メニュー</dt>
          <dd className="min-w-0 truncate font-medium text-ink" title={menuName}>
            {menuName}
          </dd>
        </div>
      </dl>
      <Button
        variant="secondary"
        onClick={() => navigate({ pathname: '/booking/history', search })}
      >
        <Icon name="calendar-days" className="h-4 w-4" />
        予約の履歴を見る
      </Button>
    </div>
  );
}
