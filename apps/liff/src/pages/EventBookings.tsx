import { useCallback, useEffect, useState } from 'react';
import { api, type EventBookingMine } from '../lib/api.js';
import { utcToJstHm, utcToJstMd } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from '../components/LoadErrorView.js';
import LoadingView from '../components/LoadingView.js';
import Card from '../components/ui/Card.js';
import Badge from '../components/ui/Badge.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.js';
import Icon from '../components/ui/Icon.js';
import PageHeader from '../components/ui/PageHeader.js';
import StatusView from '../components/ui/StatusView.js';

/** 札の文字は設計どおり (参加・承認待ち…)。意味は今の状態名のまま変えない。 */
const statusMeta: Record<string, { text: string; tone: 'confirmed' | 'pending' | 'neutral' }> = {
  confirmed: { text: '参加', tone: 'confirmed' },
  requested: { text: '承認待ち', tone: 'pending' },
  rejected: { text: '見送り', tone: 'neutral' },
  cancelled: { text: 'キャンセル', tone: 'neutral' },
  expired: { text: '期限切れ', tone: 'neutral' },
  attended: { text: '参加済', tone: 'neutral' },
  no_show: { text: '不参加', tone: 'neutral' },
};

function canCancel(b: EventBookingMine): boolean {
  if (b.status !== 'requested' && b.status !== 'confirmed') return false;
  if (b.cancel_deadline_hours_before == null) return false;
  const deadlineMs = new Date(b.slot_starts_at).getTime() - b.cancel_deadline_hours_before * 3600_000;
  return deadlineMs > Date.now();
}

/**
 * 3-b 自分のイベント。「これから／これまで」の切り替え。
 * キャンセルは期限まで。確認の出し方と失敗の文言はそのまま。
 * 見た目だけ ★V7 (日付の四角＋名前＋札＋補足)。
 */
export default function EventBookings() {
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [items, setItems] = useState<EventBookingMine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // 読み込みの失敗と、キャンセル操作の失敗は別に持つ。
  // 混ぜると失敗を「予約0件」と言ってしまう。
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setActionError(null);
    try {
      const res = await api.myEventBookings(tab);
      setItems(res.items);
    } catch (e) {
      logFailure('event-bookings', e);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 取り消す予約。開いている間だけ持つ。ブラウザの `confirm()` は使わず、
  // 共通の確認窓で聞く (やめるを選ぶとここが空のまま終わる)。
  const [pendingCancel, setPendingCancel] = useState<EventBookingMine | null>(null);

  async function runCancel() {
    const b = pendingCancel;
    if (!b || busy) return;
    setPendingCancel(null);
    setBusy(true);
    setActionError(null);
    try {
      await api.cancelMyEventBooking(b.id);
      await refresh();
    } catch (err) {
      logFailure('cancel-event-booking', err);
      const e = err as { body?: { error?: string } };
      const msg = (() => {
        switch (e.body?.error) {
          case 'cancel_deadline_passed': return 'キャンセル期限を過ぎています。';
          case 'cancel_not_allowed': return 'このイベントは LIFF からのキャンセルに対応していません。LINE で運営にご連絡ください。';
          case 'invalid_state': return 'この予約は既にキャンセル済 / 確定外のためキャンセルできません。';
          default: return 'キャンセルできませんでした。時間をおいて、もう一度お試しください。';
        }
      })();
      setActionError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ground">
      <div className="mx-auto w-full max-w-md space-y-4 px-4 pt-2 pb-10">
        <PageHeader title="自分のイベント" />
        {loading ? (
          <LoadingView />
        ) : loadFailed ? (
          <LoadErrorView note="申し込みはなくなっていません。" onRetry={() => void refresh()} />
        ) : (
          <>
            <div
              className="flex rounded-xl bg-hairline/40 p-1"
              role="tablist"
              aria-label="イベントの期間"
            >
              {(
                [
                  { key: 'upcoming', label: 'これから' },
                  { key: 'past', label: 'これまで' },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`min-h-11 flex-1 rounded-lg px-2 text-sm focus-visible:outline-2 focus-visible:outline-ink ${
                    tab === t.key
                      ? 'bg-canvas font-bold text-ink shadow-sm'
                      : 'text-ink-secondary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {actionError && (
              <p role="alert" className="text-sm leading-6 text-danger">
                {actionError}
              </p>
            )}
            {items.length === 0 ? (
              tab === 'upcoming' ? (
                <StatusView icon="calendar" title="これからのイベントはありません" />
              ) : (
                <StatusView icon="calendar" title="これまでのイベントはありません" />
              )
            ) : (
              <ul className="space-y-2">
                {items.map((b) => {
                  const meta = statusMeta[b.status] ?? { text: b.status, tone: 'neutral' as const };
                  return (
                    <li key={b.id}>
                      <Card className="p-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex w-13 shrink-0 flex-col items-center"
                            aria-label={`${utcToJstMd(b.slot_starts_at)} ${utcToJstHm(b.slot_starts_at)}`}
                          >
                            <span className="text-base font-bold whitespace-nowrap text-ink">
                              {utcToJstMd(b.slot_starts_at)}
                            </span>
                            <span className="text-xs text-ink-secondary">
                              {utcToJstHm(b.slot_starts_at)}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold text-ink" title={b.event_name}>
                              {b.event_name}
                            </div>
                            {b.venue_name && (
                              <div
                                className="mt-0.5 truncate text-sm text-ink-secondary"
                                title={b.venue_name}
                              >
                                {b.venue_name}
                              </div>
                            )}
                          </div>
                          <Badge tone={meta.tone}>{meta.text}</Badge>
                        </div>
                        {canCancel(b) && (
                          <div className="mt-2 text-left">
                            <button
                              type="button"
                              onClick={() => {
                                setActionError(null);
                                setPendingCancel(b);
                              }}
                              disabled={busy}
                              className="inline-flex min-h-11 items-center gap-0.5 text-sm font-semibold text-info-link focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-50"
                            >
                              キャンセルする
                              <Icon name="chevron-right" className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
      <ConfirmDialog
        open={pendingCancel !== null}
        title={pendingCancel ? `「${pendingCancel.event_name}」の予約をキャンセルしますか？` : ''}
        description={
          pendingCancel
            ? `${utcToJstMd(pendingCancel.slot_starts_at)} ${utcToJstHm(pendingCancel.slot_starts_at)}${pendingCancel.venue_name ? `・${pendingCancel.venue_name}` : ''}の予約を取り消します。`
            : ''
        }
        confirmLabel="キャンセルする"
        cancelLabel="やめる"
        destructive
        busy={busy}
        onCancel={() => {
          if (!busy) setPendingCancel(null);
        }}
        onConfirm={() => void runCancel()}
      />
    </div>
  );
}
