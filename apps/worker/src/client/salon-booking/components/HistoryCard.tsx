import { useState } from 'react';
import type { BookingHistoryItem } from '../lib/api.js';
import { utcToJstDisplay } from '../lib/datetime.js';

const STATUS_LABEL: Record<string, { label: string; bg: string; fg: string }> = {
  requested: { label: 'リクエスト中', bg: '#fff7df', fg: '#8a6522' },
  confirmed: { label: '予約確定', bg: '#dcfce7', fg: '#166534' },
  rejected: { label: '受付不可', bg: '#f3f4f6', fg: '#6b7280' },
  expired: { label: '期限切れ', bg: '#f3f4f6', fg: '#6b7280' },
  cancelled: { label: 'キャンセル済み', bg: '#f3f4f6', fg: '#6b7280' },
  completed: { label: '施術完了', bg: '#dbeafe', fg: '#1e40af' },
  no_show: { label: '無断キャンセル', bg: '#fee2e2', fg: '#991b1b' },
};

export default function HistoryCard({
  booking,
  onCancel,
  onRebook,
}: {
  booking: BookingHistoryItem;
  onCancel: (booking: BookingHistoryItem) => Promise<void>;
  onRebook: (booking: BookingHistoryItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const meta = STATUS_LABEL[booking.status] ?? { label: booking.status, bg: '#f3f4f6', fg: '#6b7280' };
  const canCancel =
    (booking.status === 'requested' || booking.status === 'confirmed') &&
    new Date(booking.starts_at) > new Date();

  async function cancel() {
    if (!window.confirm('この予約をキャンセルしますか？この操作は取り消せません。')) return;
    setCancelling(true);
    try {
      await onCancel(booking);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <li className={`sb-history-card ${booking.status === 'cancelled' ? 'opacity-75' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="sb-badge" style={{ background: meta.bg, color: meta.fg }}>{meta.label}</span>
        <span className="text-right text-sm font-bold sb-line-green-text">{utcToJstDisplay(booking.starts_at)}</span>
      </div>
      <div className="mt-4 grid grid-cols-[78px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <span className="font-semibold text-gray-500">施術店舗</span>
        <span className="font-bold text-slate-800">{booking.location_name ?? '店舗未設定'}</span>
        <span className="font-semibold text-gray-500">メニュー</span>
        <span className="font-bold sb-line-green-text">{booking.menu_name}</span>
        <span className="font-semibold text-gray-500">担当</span>
        <span className="font-semibold text-slate-800">{booking.staff_name}</span>
        <span className="font-semibold text-gray-500">料金</span>
        <span className="font-bold sb-line-green-text">¥{booking.price_at_booking.toLocaleString()}</span>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-dashed border-gray-300 pt-4 sb-fade-in">
          <dl className="space-y-3 text-sm">
            <Detail label="お名前" value={booking.customer_name ?? '未登録'} />
            <Detail label="お名前（カナ）" value={booking.customer_kana ?? '未登録'} />
            <Detail label="電話番号" value={booking.customer_phone ?? '未登録'} />
            {booking.customer_note && <Detail label="ご要望" value={booking.customer_note} />}
          </dl>
          {booking.consent_body && (
            <details className="mt-4 rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
              <summary className="cursor-pointer font-bold text-slate-700">
                同意済み：{booking.consent_title}（版 {booking.consent_version}）
              </summary>
              <div className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap leading-6">{booking.consent_body}</div>
            </details>
          )}
        </div>
      )}

      <div className="mt-5 grid gap-2">
        <button onClick={() => setExpanded(!expanded)} className="sb-outline-btn">
          {expanded ? '詳細を閉じる' : '予約を確認する'}
        </button>
        {!canCancel && (
          <button onClick={() => onRebook(booking)} className="sb-outline-btn">同じ内容で予約する</button>
        )}
        {canCancel && (
          <button onClick={() => void cancel()} disabled={cancelling} className="sb-danger-btn">
            {cancelling ? '処理中…' : booking.status === 'requested' ? '予約リクエストを取り消す' : '予約をキャンセルする'}
          </button>
        )}
      </div>
    </li>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-gray-500">{label}</dt>
      <dd className="mt-1 font-bold sb-line-green-text">{value}</dd>
    </div>
  );
}
