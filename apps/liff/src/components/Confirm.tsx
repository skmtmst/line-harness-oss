import { useState } from 'react';
import { api, type MenuItem, type StaffItem } from '../lib/api.js';
import { addMinutesHm, formatJpLong, jstStartsAtIso } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import { useWideViewport } from '../lib/use-wide-viewport.js';
import Icon from './ui/Icon.js';
import Button from './ui/Button.js';
import BottomBar from './ui/BottomBar.js';
import type { SlotPick } from './DateTimePicker.js';

/**
 * 1-d 内容の確認 (★V8・gLReL)。送った中身のカード＋ご要望＋案内の帯。
 * 進む操作 (この内容で予約をリクエスト) は下の操作の帯にだけ置く。
 * 送信の失敗は入力を消さず、その場で理由を出す (動きはそのまま)。
 */
export default function Confirm({
  menu,
  staff,
  slot,
  autoConfirm,
  onBack,
  onSubmitted,
}: {
  menu: MenuItem;
  staff: StaffItem;
  slot: SlotPick;
  /** 予約のルールが承認なし確定のとき真。未承認の案内を出さない。 */
  autoConfirm: boolean;
  /** 「← 日時を選び直す」。日時の段へ戻る。 */
  onBack: () => void;
  /** 送ったあと。引数は作られた予約の状態（requested/confirmed）。 */
  onSubmitted: (status: string) => void;
}) {
  // 414 幅の板（`uZqMA`）は板 ID だけを替える。中身は同じ。
  const wide = useWideViewport();
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(() => crypto.randomUUID());

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createRequest(
        {
          menu_id: menu.id,
          staff_id: staff.id,
          starts_at: jstStartsAtIso(slot.date, slot.start),
          customer_note: note || undefined,
        },
        idemKey,
      );
      onSubmitted(res.status);
    } catch (e) {
      logFailure('create-request', e);
      const err = e as { status?: number; body?: { error?: string } };
      if (err.status === 409 && err.body?.error === 'slot_conflict') {
        setError('この時間枠は他の方の予約と重なりました。日時を選び直してください。');
      } else {
        setError('予約リクエストの送信に失敗しました。時間をおいて再度お試しください。');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3.5" data-design-node={wide ? 'uZqMA' : 'gLReL'}>
      <h2 className="text-xl font-bold text-ink">内容を確かめてください</h2>
      <dl className="divide-y divide-liff-divider rounded-(--liff-radius-lg) bg-canvas px-3.5 py-1 outline outline-1 -outline-offset-1 outline-liff-line">
        <Row label="メニュー" value={menu.name} />
        <Row
          label="日時"
          value={`${formatJpLong(slot.date)} ${slot.start}〜${addMinutesHm(slot.start, staff.duration_minutes)}`}
        />
        <Row label="担当" value={staff.display_name} />
        <Row
          label="料金"
          value={`${staff.price === 0 ? '無料' : `¥${staff.price.toLocaleString()}`}（目安・お店で払う）`}
        />
      </dl>
      <label className="block">
        <span className="text-[13px] font-bold text-ink">
          ご要望 <span className="text-[11px] font-normal text-liff-sub">任意</span>
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1.5 min-h-18 w-full rounded-(--liff-radius) bg-canvas px-3.5 py-3 text-[13px] text-ink outline outline-1 -outline-offset-1 outline-liff-line-strong placeholder:text-liff-idle focus-visible:outline-2 focus-visible:outline-ink"
          rows={3}
          placeholder="例：前髪は短めにしたい"
        />
      </label>
      {error && (
        <p role="alert" className="text-[13px] leading-6 text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2 rounded-(--liff-radius) bg-liff-note p-3 text-xs leading-5 text-ink">
        <Icon name="info" className="h-4 w-4 shrink-0 text-liff-sub" />
        <p>
          {autoConfirm
            ? '送るとその場で確定します。確定のお知らせをLINEで送ります。'
            : 'まだ確定ではありません。お店が確かめたら、LINEでお知らせします。'}
          {menu.cancel_deadline_hours_before != null &&
            `キャンセルは${menu.cancel_deadline_hours_before}時間前まで。`}
        </p>
      </div>
      <div className="pb-40" aria-hidden="true" />
      <BottomBar>
        <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '送信中...' : autoConfirm ? 'この内容で予約を確定する' : 'この内容で予約をリクエスト'}
        </Button>
        <button
          type="button"
          onClick={onBack}
          className="self-center text-xs text-liff-sub focus-visible:outline-2 focus-visible:outline-ink"
        >
          ← 日時を選び直す
        </button>
      </BottomBar>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 py-2.5">
      <dt className="w-18 shrink-0 text-xs text-liff-sub">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}
