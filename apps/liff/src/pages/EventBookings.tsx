import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type EventBookingMine, type EventSlot } from '../lib/api.js';
import { utcToJstHm, utcToJstMd } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from '../components/LoadErrorView.js';
import LoadingView from '../components/LoadingView.js';
import Card from '../components/ui/Card.js';
import Badge from '../components/ui/Badge.js';
import Button from '../components/ui/Button.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.js';
import Icon from '../components/ui/Icon.js';
import LiffHeader from '../components/ui/LiffHeader.js';
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
  const navigate = useNavigate();
  // ?liffId=... を引き継ぐ (再読み込みで失わない)。
  const { search } = useLocation();
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

  /**
   * U-3: 開催回を変える予約。窓を開けている間だけ持つ。
   * 冪等鍵は窓を開けたときに1つ作り、失敗後の再試行でも使い回す
   * (応答を失った成功を二重にしない)。
   */
  const [pendingChange, setPendingChange] = useState<{
    booking: EventBookingMine;
    slots: EventSlot[] | null;
    slotsFailed: boolean;
    selectedSlotId: string | null;
    idempotencyKey: string;
    changeError: string | null;
  } | null>(null);

  // 自分の予約一覧には枠 ID が無いため、今の時間は開始日時で見分ける。
  function isCurrentSlot(booking: EventBookingMine, slot: EventSlot): boolean {
    return slot.starts_at === booking.slot_starts_at;
  }

  async function openChange(booking: EventBookingMine) {
    if (busy) return;
    setActionError(null);
    setPendingChange({
      booking,
      slots: null,
      slotsFailed: false,
      selectedSlotId: null,
      idempotencyKey: crypto.randomUUID(),
      changeError: null,
    });
    try {
      const res = await api.getEventSlots(booking.event_id);
      setPendingChange((current) => {
        if (!current || current.booking.id !== booking.id) return current;
        const first = res.items.find(
          (s) => !isCurrentSlot(booking, s) && s.remaining !== 0,
        );
        return { ...current, slots: res.items, selectedSlotId: first?.id ?? null };
      });
    } catch (e) {
      logFailure('change-event-booking-slots', e);
      setPendingChange((current) =>
        current && current.booking.id === booking.id ? { ...current, slotsFailed: true } : current,
      );
    }
  }

  async function runChange() {
    const target = pendingChange;
    if (!target || !target.selectedSlotId || busy) return;
    const selected = target.slots?.find((s) => s.id === target.selectedSlotId);
    // 今の時間そのものは選ばせない (API も same_slot で止める)。
    if (!selected || isCurrentSlot(target.booking, selected)) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.changeMyEventBooking(
        target.booking.id,
        target.selectedSlotId,
        target.idempotencyKey,
      );
      setPendingChange(null);
      await refresh();
    } catch (err) {
      logFailure('change-event-booking', err);
      const e = err as { body?: { error?: string } };
      const msg = (() => {
        switch (e.body?.error) {
          case 'slot_full': return '選んだ時間は満席になりました。別の時間を選んでください。';
          case 'change_deadline_passed': return '変更期限を過ぎています。LINE で運営にご連絡ください。';
          case 'change_not_allowed': return 'このイベントは LIFF からの変更に対応していません。LINE で運営にご連絡ください。';
          case 'slot_inactive':
          case 'slot_started':
          case 'entry_closed': return '選んだ時間は受付を終えています。別の時間を選んでください。';
          case 'same_slot': return '今と同じ時間です。別の時間を選んでください。';
          case 'over_friend_limit':
          case 'duplicate_friend_booking': return '申込の上限に達しているため変えられません。LINE で運営にご連絡ください。';
          case 'invalid_state': return 'この予約は既に変更・キャンセル済みのため変えられません。一覧を開き直してください。';
          case 'send_in_flight_retry': return '送信の直前でした。少し待ってから、もう一度お試しください。';
          default: return '変えられませんでした。時間をおいて、もう一度お試しください。';
        }
      })();
      setPendingChange((current) =>
        current && current.booking.id === target.booking.id ? { ...current, changeError: msg } : current,
      );
    } finally {
      setBusy(false);
    }
  }

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
    <div className="min-h-screen bg-ground" data-design-node="y1bs9A">
      <LiffHeader title="自分のイベント" />
      <div className="mx-auto w-full max-w-md space-y-4 px-4 pt-3 pb-10">
        <h1 className="text-xl font-bold text-ink">自分のイベント</h1>
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
                            <div className="mt-1">
                              <Badge tone={meta.tone}>{meta.text}</Badge>
                            </div>
                          </div>
                          <button
                            type="button"
                            aria-label={`${b.event_name}のイベントを見る`}
                            onClick={() =>
                              navigate({ pathname: `/events/${b.event_id}`, search })
                            }
                            className="flex h-11 w-8 shrink-0 items-center justify-center text-ink-faint focus-visible:outline-2 focus-visible:outline-ink"
                          >
                            <Icon name="chevron-right" className="h-5 w-5" />
                          </button>
                        </div>
                        {canCancel(b) && (
                          <div className="mt-3 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                void openChange(b);
                              }}
                              disabled={busy}
                              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-hairline bg-canvas px-3 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-50"
                            >
                              時間を変える
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActionError(null);
                                setPendingCancel(b);
                              }}
                              disabled={busy}
                              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-danger/30 bg-canvas px-3 text-sm font-semibold text-danger focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-50"
                            >
                              キャンセルする
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
      <ConfirmDialog
        open={pendingChange !== null}
        title={pendingChange ? `「${pendingChange.booking.event_name}」の時間を変えますか？` : ''}
        description={
          pendingChange
            ? '新しい時間の席を取れたときだけ、今の予約を取り消します。満席の時間へは変えられません。'
            : ''
        }
        confirmLabel="この時間に変える"
        cancelLabel="やめる"
        busy={busy}
        error={pendingChange?.changeError ?? undefined}
        onCancel={() => {
          if (!busy) setPendingChange(null);
        }}
        onConfirm={
          pendingChange?.selectedSlotId && !busy ? () => void runChange() : undefined
        }
      >
        {pendingChange && (
          <div className="mt-3">
            {pendingChange.slots === null && !pendingChange.slotsFailed && (
              <p className="text-sm text-ink-secondary">時間を読み込んでいます…</p>
            )}
            {pendingChange.slotsFailed && (
              <div className="space-y-2">
                <p className="text-sm text-ink-secondary">
                  時間を読み込めませんでした。予約はなくなっていません。
                </p>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void openChange(pendingChange.booking)}
                >
                  読み直す
                </Button>
              </div>
            )}
            {pendingChange.slots !== null && (
              <ul className="space-y-2">
                {pendingChange.slots.map((s) => {
                  const current = isCurrentSlot(pendingChange.booking, s);
                  const full = s.remaining === 0;
                  const disabled = current || full || busy;
                  const selected = pendingChange.selectedSlotId === s.id;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-pressed={selected}
                        onClick={() =>
                          setPendingChange((prev) =>
                            prev ? { ...prev, selectedSlotId: s.id, changeError: null } : prev,
                          )
                        }
                        className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-not-allowed ${
                          disabled
                            ? 'border-hairline bg-shell-gray'
                            : selected
                              ? 'border-liff-primary bg-liff-primary'
                              : 'border-hairline bg-canvas'
                        }`}
                      >
                        <span
                          className={`text-sm font-semibold whitespace-nowrap ${disabled ? 'text-ink-faint' : selected ? 'text-white' : 'text-ink'}`}
                        >
                          {utcToJstMd(s.starts_at)} {utcToJstHm(s.starts_at)}〜
                          {utcToJstHm(s.ends_at)}
                        </span>
                        <span
                          className={`shrink-0 text-xs whitespace-nowrap ${disabled ? 'text-ink-faint' : selected ? 'text-white' : 'text-ink-secondary'}`}
                        >
                          {current ? '今の時間' : full ? '満席' : '空きあり'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
