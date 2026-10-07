import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type BookingHistoryItem } from '../lib/api.js';
import { addDays, jstStartsAtIso, jstToday, formatMd, formatWeekday, utcToJstHm, utcToJstMd } from '../lib/datetime.js';
import ConfirmDialog from '../components/ui/ConfirmDialog.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from '../components/LoadErrorView.js';
import LoadingView from '../components/LoadingView.js';
import HistoryCard from '../components/HistoryCard.js';
import LiffHeader from '../components/ui/LiffHeader.js';
import LiffLookScope from '../components/LiffLookScope.js';
import StatusView from '../components/ui/StatusView.js';
import BottomBar from '../components/ui/BottomBar.js';
import Button from '../components/ui/Button.js';
import Icon from '../components/ui/Icon.js';

/** 日時を変える窓で、今日から何日先までの空きを出すか（空きの口は28日までまとめて読める）。 */
const CHANGE_RANGE_DAYS = 14;
/** 窓に並べる空きの数の上限（多すぎると選べない）。 */
const CHANGE_SLOT_LIMIT = 24;

type ChangeSlot = { date: string; start: string };

/** 取消の失敗を、お客さまが次に何をすればよいかの1文にする。 */
function cancelFailureMessage(code: string | undefined): string {
  switch (code) {
    case 'self_deadline_passed': return 'キャンセルの期限を過ぎています。トークでご連絡ください。';
    case 'version_conflict':
    case 'not_editable':
    case 'booking_not_found': return '予約の内容が変わっていました。一覧を読み直しました。';
    case 'send_in_flight_retry': return 'お知らせを送っている途中でした。少し待ってから、もう一度お試しください。';
    default: return 'キャンセルできませんでした。電波のよいところで、もう一度お試しください。';
  }
}

/** 日時変更の失敗の1文。 */
function changeFailureMessage(code: string | undefined): string {
  switch (code) {
    case 'slot_not_available':
    case 'slot_conflict': return '選んだ日時は埋まりました。別の日時を選んでください。';
    case 'self_deadline_passed': return '変更の期限を過ぎています。トークでご連絡ください。';
    case 'past_cutoff':
    case 'past_datetime':
    case 'invalid_starts_at': return '選んだ日時は受付を終えています。別の日時を選んでください。';
    case 'version_conflict':
    case 'not_editable':
    case 'booking_not_found': return '予約の内容が変わっていました。一覧を読み直してから、もう一度お試しください。';
    case 'send_in_flight_retry': return 'お知らせを送っている途中でした。少し待ってから、もう一度お試しください。';
    default: return '日時を変えられませんでした。電波のよいところで、もう一度お試しください。';
  }
}

function errorCode(err: unknown): string | undefined {
  const body = (err as { body?: { error?: unknown } } | null)?.body;
  return typeof body?.error === 'string' ? body.error : undefined;
}

/**
 * 予約の履歴 (★V8・YvTJ3)。「これから／これまで」の切り替え。
 * これからの予約のカードに「日時を変える／キャンセル」(F-6 本人の変更・取消)。
 * 送るには予約の版 (lock_version) が要るので、履歴の口が返した予約にだけ出す
 * (日時を変えるはメニューと担当も要る)。返さない予約には出さず、下の文で「トークでご連絡ください」と案内する。
 * 進む操作は下の帯の「新しく予約する」。
 */
export default function BookingHistory() {
  const [data, setData] = useState<{ upcoming: BookingHistoryItem[]; past: BookingHistoryItem[] } | null>(
    null,
  );
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const navigate = useNavigate();
  const { search } = useLocation();
  /* 取消の確認・日時変更の窓と、送っている途中・失敗の文。 */
  const [pendingCancel, setPendingCancel] = useState<BookingHistoryItem | null>(null);
  const [pendingChange, setPendingChange] = useState<{
    booking: BookingHistoryItem;
    slots: ChangeSlot[] | null;
    slotsFailed: boolean;
    selected: ChangeSlot | null;
    error: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setFailed(false);
    api
      .me()
      .then(setData)
      .catch((e) => {
        logFailure('booking-history', e);
        setFailed(true);
      });
  }, [reloadKey]);

  const canCancel = (b: BookingHistoryItem) => tab === 'upcoming' && typeof b.lock_version === 'number';
  const canChange = (b: BookingHistoryItem) =>
    canCancel(b) && typeof b.menu_id === 'string' && typeof b.staff_id === 'string';

  async function runCancel() {
    const target = pendingCancel;
    if (!target || busy || typeof target.lock_version !== 'number') return;
    setBusy(true);
    setActionError(null);
    try {
      await api.cancelMyBooking(target.id, target.lock_version);
      setPendingCancel(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      logFailure('booking-history-cancel', err);
      const code = errorCode(err);
      setPendingCancel(null);
      setActionError(cancelFailureMessage(code));
      if (code === 'version_conflict' || code === 'not_editable' || code === 'booking_not_found') {
        setReloadKey((k) => k + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  async function openChange(booking: BookingHistoryItem) {
    if (busy || !booking.menu_id || !booking.staff_id) return;
    setActionError(null);
    setPendingChange({ booking, slots: null, slotsFailed: false, selected: null, error: null });
    const from = jstToday();
    try {
      const res = await api.availability(booking.menu_id, booking.staff_id, from, addDays(from, CHANGE_RANGE_DAYS - 1));
      const current = booking.starts_at;
      const slots: ChangeSlot[] = [];
      for (const bucket of res.by_staff ?? []) {
        for (const slot of bucket.slots ?? []) {
          const open = !((slot.remaining ?? 1) <= 0 || slot.state === 'full' || slot.state === 'closed');
          if (!open) continue;
          if (new Date(jstStartsAtIso(slot.date, slot.start)).getTime() === new Date(current).getTime()) continue;
          if (slots.some((s) => s.date === slot.date && s.start === slot.start)) continue;
          slots.push({ date: slot.date, start: slot.start });
        }
      }
      slots.sort((a, b) => (`${a.date} ${a.start}` < `${b.date} ${b.start}` ? -1 : 1));
      setPendingChange((prev) =>
        prev && prev.booking.id === booking.id ? { ...prev, slots: slots.slice(0, CHANGE_SLOT_LIMIT) } : prev,
      );
    } catch (err) {
      logFailure('booking-history-change-slots', err);
      setPendingChange((prev) => (prev && prev.booking.id === booking.id ? { ...prev, slotsFailed: true } : prev));
    }
  }

  async function runChange() {
    const target = pendingChange;
    if (!target || !target.selected || busy || typeof target.booking.lock_version !== 'number') return;
    setBusy(true);
    try {
      await api.rescheduleMyBooking(target.booking.id, {
        starts_at: jstStartsAtIso(target.selected.date, target.selected.start),
        lock_version: target.booking.lock_version,
      });
      setPendingChange(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      logFailure('booking-history-change', err);
      const message = changeFailureMessage(errorCode(err));
      setPendingChange((prev) =>
        prev && prev.booking.id === target.booking.id ? { ...prev, error: message, selected: null } : prev,
      );
    } finally {
      setBusy(false);
    }
  }

  const list = data ? (tab === 'upcoming' ? data.upcoming : data.past) : [];
  const anySelfChange = list.some((b) => canCancel(b));

  return (
    <LiffLookScope className="min-h-screen bg-canvas">
      <LiffHeader title="予約の履歴" />
      <div
        data-design-node="YvTJ3"
        className="mx-auto w-full max-w-md space-y-3.5 px-4 pt-3 pb-40"
      >
        <h1 className="text-xl font-bold text-ink">予約の履歴</h1>
        {failed ? (
          <LoadErrorView note="予約はなくなっていません。" onRetry={() => setReloadKey((k) => k + 1)} />
        ) : !data ? (
          <LoadingView />
        ) : (
          <>
            <div
              className="flex rounded-(--liff-radius) bg-liff-chip p-[3px]"
              role="tablist"
              aria-label="予約の期間"
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
                  className={`liff-hit flex h-8 flex-1 items-center justify-center rounded-lg text-xs focus-visible:outline-2 focus-visible:outline-ink ${
                    tab === t.key
                      ? 'bg-canvas font-bold text-ink'
                      : 'font-semibold text-liff-sub'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {actionError && (
              <p role="alert" className="text-[13px] leading-5 text-danger">{actionError}</p>
            )}
            {list.length === 0 ? (
              tab === 'upcoming' ? (
                <StatusView
                  icon="calendar"
                  title="これからの予約はありません"
                  body="空いている日時から、そのまま予約できます。"
                />
              ) : (
                <StatusView icon="calendar" title="これまでの予約はありません" />
              )
            ) : (
              <ul className="space-y-3.5">
                {list.map((b) => (
                  <HistoryCard
                    key={b.id}
                    booking={b}
                    disabled={busy}
                    onChange={canChange(b) ? () => void openChange(b) : undefined}
                    onCancel={canCancel(b) ? () => { setActionError(null); setPendingCancel(b); } : undefined}
                  />
                ))}
              </ul>
            )}
            <p className="flex gap-1.5 text-[11.5px] leading-[17px] text-liff-sub">
              <Icon name="message-circle" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {anySelfChange
                  ? 'キャンセルの期限を過ぎた予約の変更は、トークでご連絡ください。'
                  : '予定の変更・キャンセルは、お店に LINE でご連絡ください。'}
              </span>
            </p>
          </>
        )}
      </div>
      {data && !failed && (
        <BottomBar>
          <Button
            variant="primary"
            onClick={() => navigate({ pathname: '/booking', search })}
          >
            新しく予約する
          </Button>
        </BottomBar>
      )}
      <ConfirmDialog
        open={pendingCancel !== null}
        title={
          pendingCancel
            ? `${utcToJstMd(pendingCancel.starts_at)} ${utcToJstHm(pendingCancel.starts_at)} の${pendingCancel.menu_name}をキャンセルしますか`
            : ''
        }
        description="キャンセルすると元に戻せません。キャンセルの期限を過ぎると、ここからは変えられません（トークでご連絡ください）。"
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
        title={pendingChange ? `「${pendingChange.booking.menu_name}」の日時を変えますか` : ''}
        description="空いている日時から選びます。新しい日時を取れたときだけ、今の予約が変わります。"
        confirmLabel="この日時に変える"
        cancelLabel="やめる"
        busy={busy}
        error={pendingChange?.error ?? undefined}
        onCancel={() => {
          if (!busy) setPendingChange(null);
        }}
        onConfirm={pendingChange?.selected && !busy ? () => void runChange() : undefined}
      >
        {pendingChange && (
          <div className="mt-3">
            {pendingChange.slots === null && !pendingChange.slotsFailed && (
              <p className="text-sm text-ink-secondary">空いている日時を読み込んでいます…</p>
            )}
            {pendingChange.slotsFailed && (
              <div className="space-y-2">
                <p className="text-sm text-ink-secondary">
                  空いている日時を読み込めませんでした。予約はなくなっていません。
                </p>
                <Button variant="secondary" disabled={busy} onClick={() => void openChange(pendingChange.booking)}>
                  読み直す
                </Button>
              </div>
            )}
            {pendingChange.slots !== null && pendingChange.slots.length === 0 && (
              <p className="text-sm text-ink-secondary">
                {`${CHANGE_RANGE_DAYS}日先までに空いている日時がありません。トークでご連絡ください。`}
              </p>
            )}
            {pendingChange.slots !== null && pendingChange.slots.length > 0 && (
              <ul className="max-h-72 space-y-2 overflow-y-auto">
                {pendingChange.slots.map((slot) => {
                  const selected =
                    pendingChange.selected?.date === slot.date && pendingChange.selected?.start === slot.start;
                  return (
                    <li key={`${slot.date}-${slot.start}`}>
                      <button
                        type="button"
                        disabled={busy}
                        aria-pressed={selected}
                        onClick={() =>
                          setPendingChange((prev) => (prev ? { ...prev, selected: slot, error: null } : prev))
                        }
                        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-(--liff-radius) border px-4 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-not-allowed ${
                          selected ? 'border-liff-primary bg-liff-primary' : 'border-hairline bg-canvas'
                        }`}
                      >
                        <span
                          className={`liff-num text-sm font-semibold whitespace-nowrap ${selected ? 'text-(--liff-on-primary)' : 'text-ink'}`}
                        >
                          {`${formatMd(slot.date)}（${formatWeekday(slot.date)}） ${slot.start}`}
                        </span>
                        <span
                          className={`shrink-0 text-xs whitespace-nowrap ${selected ? 'text-(--liff-on-primary)' : 'text-ink-secondary'}`}
                        >
                          {selected ? 'この日時' : '空きあり'}
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
    </LiffLookScope>
  );
}
