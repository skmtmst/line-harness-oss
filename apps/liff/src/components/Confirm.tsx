import { useState } from 'react';
import { api, type MenuItem, type StaffItem } from '../lib/api.js';
import { formatJp, jstStartsAtIso } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import Icon from './ui/Icon.js';
import Button from './ui/Button.js';
import BottomBar from './ui/BottomBar.js';
import type { SlotPick } from './DateTimePicker.js';

/**
 * 1-d 内容の確認。送った中身のカード＋ご要望＋案内の帯。
 * 進む操作 (予約をリクエストする) は下の操作の帯にだけ置く。
 * 送信の失敗は入力を消さず、その場で理由を出す (動きはそのまま)。
 */
export default function Confirm({
  menu,
  staff,
  slot,
  onSubmitted,
}: {
  menu: MenuItem;
  staff: StaffItem;
  slot: SlotPick;
  onSubmitted: () => void;
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(() => crypto.randomUUID());

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.createRequest(
        {
          menu_id: menu.id,
          staff_id: staff.id,
          starts_at: jstStartsAtIso(slot.date, slot.start),
          customer_note: note || undefined,
        },
        idemKey,
      );
      onSubmitted();
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
    <div className="space-y-4">
      <dl className="space-y-3 rounded-xl border border-hairline bg-canvas p-4 text-sm">
        <Row label="メニュー" value={menu.name} />
        <Row label="日時" value={`${formatJp(slot.date)} ${slot.start}`} />
        <Row label="所要" value={`${staff.duration_minutes}分`} />
        <Row label="担当" value={staff.display_name} />
        <Row label="料金（目安）" value={`¥${staff.price.toLocaleString()}`} />
      </dl>
      <label className="block">
        <span className="text-sm text-ink">
          ご要望 <span className="text-xs text-ink-faint">任意</span>
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 min-h-24 w-full rounded-lg border border-hairline bg-canvas p-3 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-2 focus-visible:outline-ink"
          rows={3}
          placeholder="例：前髪は短めにしたい"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm leading-6 text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2 rounded-lg bg-info-bg p-3 text-xs leading-5 text-ink-secondary">
        <Icon name="info" className="h-4 w-4 shrink-0" />
        <p>まだ確定ではありません。お店が確認すると LINE でお知らせします。</p>
      </div>
      <div className="pb-28" aria-hidden="true" />
      <BottomBar>
        <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '送信中...' : '予約をリクエストする'}
        </Button>
      </BottomBar>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ink-secondary">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}
