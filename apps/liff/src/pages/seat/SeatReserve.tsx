import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import liff from '@line/liff';
import type { RestaurantCustomerBooking, RestaurantLateArrivalPolicy, RestaurantUnavailableReason } from '@line-crm/shared';
import LiffHeader from '../../components/ui/LiffHeader.js';
import LiffLookScope from '../../components/LiffLookScope.js';
import Stepper from '../../components/ui/Stepper.js';
import BottomBar from '../../components/ui/BottomBar.js';
import Button from '../../components/ui/Button.js';
import ConfirmDialog from '../../components/ui/ConfirmDialog.js';
import LoadingView from '../../components/LoadingView.js';
import LoadErrorView from '../../components/LoadErrorView.js';
import StatusView from '../../components/ui/StatusView.js';
import { restaurantBookingApi } from '../../lib/api.js';
import { logFailure } from '../../lib/user-message.js';
import {
  addDays,
  dayChips,
  dayReason,
  hasOpenSlot,
  lateRule,
  longDate,
  newRequestId,
  normalizePhone,
  noteProblem,
  phoneProblem,
  seatText,
  seatErrorMessage,
  upcomingBookings,
  zonedParts,
  zonedToday,
  type DayChip,
} from '../../lib/seat-reserve.js';
import SeatPick, { type DaySlots } from './SeatPick.js';
import SeatConfirm from './SeatConfirm.js';
import SeatDone from './SeatDone.js';
import SeatMine from './SeatMine.js';

type View = 'pick' | 'confirm' | 'done' | 'mine';
type Store = { id: string; name: string; timezone: string };

const STEPS = ['人数・日時', 'お客さま', '確認'];
const DEFAULT_GUESTS = 2;

/**
 * 飲食店の席の予約 (E-11・★V8 glL3g→km8EG→sAnyy)。入口は /restaurant/reserve/:token。
 * token は管理画面の「LINE 予約の URL」から店を決める。?view=mine で変更・取り消しから開く。
 * 流れ：① 人数と日時 → 仮押さえ → ② 確認 (残り時間) → 確定 → ③ 受け付けました。
 * 変更は ① で選び直して ② で「この内容に変える」(仮押さえなし・版を指定)。
 */
export default function SeatReserve() {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const [store, setStore] = useState<Store | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'missing' | 'ready'>('loading');
  const [view, setView] = useState<View>(params.get('view') === 'mine' ? 'mine' : 'pick');
  const [today, setToday] = useState('');
  const [chips, setChips] = useState<DayChip[]>([]);
  const [days, setDays] = useState<Record<string, DaySlots>>({});
  /* 空きが無い日の理由と、店の遅れたときの決まり（空きの口が返す）。 */
  const [reasons, setReasons] = useState<Record<string, RestaurantUnavailableReason | undefined>>({});
  const [late, setLate] = useState<RestaurantLateArrivalPolicy | null>(null);
  /* ご要望・電話（任意）。確定の口へ送る。 */
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState('');
  const [guestCount, setGuestCount] = useState(DEFAULT_GUESTS);
  const [date, setDate] = useState('');
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [cancelMinutes, setCancelMinutes] = useState<number | null>(null);
  const [hold, setHold] = useState<RestaurantCustomerBooking | null>(null);
  const [holdMinutes, setHoldMinutes] = useState(0);
  const [expired, setExpired] = useState(false);
  const [target, setTarget] = useState<RestaurantCustomerBooking | null>(null);
  const [result, setResult] = useState<{ booking: RestaurantCustomerBooking; changed: boolean } | null>(null);
  const [mine, setMine] = useState<RestaurantCustomerBooking[]>([]);
  const [cancelling, setCancelling] = useState<RestaurantCustomerBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('LINEのお客さま');
  // 再実行だけ同じ受付番号を使う。選び直したら新しくする。
  const requestId = useRef<string | null>(null);
  const generation = useRef(0);

  const fetchDay = useCallback(
    async (s: Store, d: string, guests: number, gen: number) => {
      setDays((prev) => ({ ...prev, [d]: 'loading' }));
      try {
        const r = await restaurantBookingApi.availability(s.id, d, guests);
        if (gen !== generation.current) return;
        setCancelMinutes(r.data.cancelDeadlineMinutesBefore);
        setLate(r.data.lateArrivalPolicy ?? null);
        setReasons((prev) => ({ ...prev, [d]: hasOpenSlot(r.data.slots) ? undefined : dayReason(r.data.slots, r.data.unavailableReason) }));
        setDays((prev) => ({ ...prev, [d]: r.data.slots }));
      } catch (e) {
        if (gen !== generation.current) return;
        const status = (e as { status?: number }).status;
        // 400 は予約できる日の外・営業時間が無い日。休みと同じに扱う。
        if (status !== 400) logFailure('seat-availability', e);
        setDays((prev) => ({ ...prev, [d]: status === 400 ? 'closed' : 'error' }));
      }
    },
    [],
  );

  const loadDays = useCallback(
    (s: Store, list: string[], guests: number) => {
      const gen = ++generation.current;
      setDays({});
      return Promise.all(list.map((d) => fetchDay(s, d, guests, gen)));
    },
    [fetchDay],
  );

  const loadMine = useCallback(async (s: Store) => {
    const r = await restaurantBookingApi.mine(s.id);
    setMine(upcomingBookings(r.data));
  }, []);

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const link = await restaurantBookingApi.link(token);
      const s = link.data;
      const t = zonedToday(s.timezone);
      const c = dayChips(t);
      setStore(s);
      setToday(t);
      setChips(c);
      setDate(t);
      await loadDays(s, [...c.map((x) => x.date), addDays(t, c.length)], DEFAULT_GUESTS);
      if (params.get('view') === 'mine') await loadMine(s);
      setLoadState('ready');
    } catch (e) {
      logFailure('seat-link', e);
      setLoadState((e as { status?: number }).status === 404 ? 'missing' : 'error');
    }
  }, [token, loadDays, loadMine, params]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    liff
      .getProfile()
      .then((p) => p.displayName && setCustomerName(p.displayName))
      .catch((e) => logFailure('seat-profile', e));
  }, []);

  // 最初の日に空きが無ければ、空きのある最初の札の日を選んでおく。
  useEffect(() => {
    if (!chips.length || startsAt) return;
    const cur = days[date];
    if (Array.isArray(cur) && cur.some((x) => x.available)) return;
    if (chips.some((c) => days[c.date] === undefined || days[c.date] === 'loading')) return;
    const first = chips.find((c) => {
      const v = days[c.date];
      return Array.isArray(v) && v.some((x) => x.available);
    });
    if (first && first.date !== date && chips.some((c) => c.date === date)) setDate(first.date);
  }, [chips, days, date, startsAt]);

  function pickGuests(n: number) {
    if (!store || n === guestCount) return;
    setGuestCount(n);
    setStartsAt(null);
    setError(null);
    requestId.current = null;
    const list = [...chips.map((x) => x.date), addDays(today, chips.length)];
    if (!list.includes(date)) list.push(date);
    void loadDays(store, list, n);
  }

  function pickDate(d: string) {
    if (!store) return;
    setDate(d);
    setStartsAt(null);
    setError(null);
    requestId.current = null;
    if (days[d] === undefined || days[d] === 'error') void fetchDay(store, d, guestCount, generation.current);
  }

  function pickTime(s: string) {
    setStartsAt(s);
    setError(null);
    requestId.current = null;
  }

  const slot = (() => {
    const v = days[date];
    return Array.isArray(v) ? v.find((x) => x.startsAt === startsAt) ?? null : null;
  })();

  async function proceed() {
    if (!store || !slot) return;
    setError(null);
    if (target) {
      setView('confirm');
      return;
    }
    setBusy(true);
    requestId.current ??= newRequestId();
    try {
      const r = await restaurantBookingApi.hold({
        storeId: store.id,
        startsAt: slot.startsAt,
        guestCount,
        requestId: requestId.current,
      });
      setHold(r.data);
      setHoldMinutes(
        r.data.holdExpiresAt ? Math.max(1, Math.round((Date.parse(r.data.holdExpiresAt) - Date.now()) / 60000)) : 0,
      );
      setExpired(false);
      setView('confirm');
    } catch (e) {
      logFailure('seat-hold', e);
      setError(seatErrorMessage(e));
      // 届いたか分からない失敗 (通信・500) は、次の押下で同じ受付番号を送って二重にしない。
      // 断られた (409 など) ときだけ新しい番号にする。
      const status = (e as { status?: number }).status;
      if (status !== undefined && status < 500) requestId.current = null;
      if ((e as { body?: { error?: string } }).body?.error === 'slot_conflict') {
        setStartsAt(null);
        void fetchDay(store, date, guestCount, generation.current);
      }
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!store) return;
    const problem = target ? '' : noteProblem(note) || phoneProblem(phone);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = target
        ? await restaurantBookingApi.reschedule(target.id, {
            expectedVersion: target.version,
            startsAt: slot!.startsAt,
            guestCount,
          })
        : await restaurantBookingApi.confirm(hold!.id, hold!.version, {
            note: note.trim() || null,
            customerPhone: normalizePhone(phone) || null,
          });
      setResult({ booking: r.data, changed: !!target });
      setHold(null);
      setTarget(null);
      requestId.current = null;
      setView('done');
    } catch (e) {
      logFailure(target ? 'seat-reschedule' : 'seat-confirm', e);
      setError(seatErrorMessage(e));
      if ((e as { body?: { error?: string } }).body?.error === 'hold_expired') setExpired(true);
    } finally {
      setBusy(false);
    }
  }

  function backToPick() {
    // 仮押さえは返す (ほかのお客さまが選べるように)。失敗しても期限で外れるので止めない。
    if (hold && !expired) {
      restaurantBookingApi.cancel(hold.id, hold.version).catch((e) => logFailure('seat-release', e));
    }
    setHold(null);
    setExpired(false);
    setError(null);
    requestId.current = null;
    if (store) void fetchDay(store, date, guestCount, generation.current);
    setView('pick');
  }

  async function openMine() {
    if (!store) return;
    setError(null);
    setView('mine');
    try {
      await loadMine(store);
    } catch (e) {
      logFailure('seat-mine', e);
      setError('ご予約を読み込めませんでした。電波のよいところで、もう一度お試しください。');
    }
  }

  function startChange(b: RestaurantCustomerBooking) {
    if (!store) return;
    const d = zonedParts(b.startsAt, store.timezone).date;
    setTarget(b);
    setGuestCount(b.guestCount);
    setDate(d);
    setStartsAt(null);
    setError(null);
    const list = [...chips.map((x) => x.date), addDays(today, chips.length)];
    if (!list.includes(d)) list.push(d);
    void loadDays(store, list, b.guestCount);
    setView('pick');
  }

  async function doCancel() {
    if (!store || !cancelling) return;
    setBusy(true);
    setError(null);
    try {
      await restaurantBookingApi.cancel(cancelling.id, cancelling.version);
      setCancelling(null);
      await loadMine(store);
    } catch (e) {
      logFailure('seat-cancel', e);
      setError(seatErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function newBooking() {
    setNote('');
    setPhone('');
    setTarget(null);
    setResult(null);
    setStartsAt(null);
    setError(null);
    setView('pick');
  }

  if (loadState === 'loading') return <LoadingView />;
  if (loadState === 'missing')
    return (
      <LiffLookScope className="min-h-screen bg-canvas">
        <LiffHeader title="ご予約" />
        <div className="mx-auto w-full max-w-md px-4 pt-3">
          <StatusView
            icon="calendar-x"
            title="予約のページが見つかりません"
            body="お店から届いたリンクを、もう一度開いてください。"
          />
        </div>
      </LiffLookScope>
    );
  if (loadState === 'error' || !store)
    return (
      <LiffLookScope className="min-h-screen bg-canvas">
        <LiffHeader title="ご予約" />
        <div className="mx-auto w-full max-w-md px-4 pt-3">
          <LoadErrorView note="ご予約はなくなっていません。" onRetry={() => void load()} />
        </div>
      </LiffLookScope>
    );

  const minutes = cancelMinutes ?? 0;
  return (
    <LiffLookScope className="min-h-screen bg-canvas">
      <LiffHeader title="ご予約" />
      {(view === 'pick' || view === 'confirm') && (
        <Stepper steps={STEPS} current={view === 'pick' ? 0 : STEPS.length - 1} />
      )}
      <div className="mx-auto w-full max-w-md px-4 pt-3">
        <div key={view} className="liff-step">
          {view === 'pick' && (
            <SeatPick
              timeZone={store.timezone}
              today={today}
              chips={chips}
              days={days}
              reasons={reasons}
              guestCount={guestCount}
              date={date}
              startsAt={startsAt}
              error={error}
              onGuest={pickGuests}
              onDate={pickDate}
              onTime={pickTime}
              onRetry={() => void fetchDay(store, date, guestCount, generation.current)}
            />
          )}
          {view === 'confirm' && slot && (
            <SeatConfirm
                timeZone={store.timezone}
                storeName={store.name}
                customerName={customerName}
                startsAt={slot.startsAt}
                endsAt={slot.endsAt}
                guestCount={guestCount}
                cancelDeadlineMinutesBefore={minutes}
                seat={seatText(target ? target.seatType : hold?.seatType, slot.seatTypes)}
                late={lateRule(late)}
                note={target ? (target.note ?? '') : note}
                phone={target ? (target.customerPhone ?? '') : phone}
                onNote={setNote}
                onPhone={setPhone}
                holdExpiresAt={target ? null : (hold?.holdExpiresAt ?? null)}
                holdMinutes={holdMinutes}
                reschedule={!!target}
                error={error}
                onBack={backToPick}
                onExpired={() => setExpired(true)}
              />
          )}
          {view === 'done' && result && (
            <SeatDone
              booking={result.booking}
              timeZone={store.timezone}
              cancelDeadlineMinutesBefore={minutes}
              changed={result.changed}
            />
          )}
          {view === 'mine' && (
            <SeatMine
              rows={mine}
              timeZone={store.timezone}
              cancelDeadlineMinutesBefore={minutes}
              error={error}
              onChange={startChange}
              onCancel={(b) => {
                setError(null);
                setCancelling(b);
              }}
            />
          )}
        </div>
      </div>

      {view === 'pick' && (
        <BottomBar>
          <Button variant="primary" disabled={!slot || busy} onClick={() => void proceed()}>
            {busy ? 'お取りしています…' : 'この時刻で進む'}
          </Button>
          {target && (
            <button
              type="button"
              onClick={() => void openMine()}
              className="self-center text-xs text-liff-sub focus-visible:outline-2 focus-visible:outline-ink"
            >
              ← 変更をやめる
            </button>
          )}
        </BottomBar>
      )}
      {view === 'confirm' && (
        <BottomBar>
          <Button variant="primary" disabled={busy || expired} onClick={() => void finish()}>
            {busy ? '送信中...' : target ? 'この内容に変える' : '予約を確定する'}
          </Button>
        </BottomBar>
      )}
      {view === 'done' && (
        <BottomBar>
          <Button variant="primary" onClick={() => liff.closeWindow()}>
            LINEに戻る
          </Button>
          <Button variant="secondary" onClick={() => void openMine()}>
            予約を変える・取り消す
          </Button>
        </BottomBar>
      )}
      {view === 'mine' && (
        <BottomBar>
          <Button variant="primary" onClick={() => liff.closeWindow()}>
            LINEに戻る
          </Button>
          <Button variant="secondary" onClick={newBooking}>
            新しく予約する
          </Button>
        </BottomBar>
      )}

      <ConfirmDialog
        open={!!cancelling}
        title="ご予約を取り消しますか"
        description={
          cancelling
            ? (() => {
                const p = zonedParts(cancelling.startsAt, store.timezone);
                return `${longDate(p.date)}${p.hm}〜・${cancelling.guestCount}名のご予約を取り消します。元に戻せません。`;
              })()
            : ''
        }
        confirmLabel="取り消す"
        cancelLabel="やめる"
        destructive
        busy={busy}
        error={cancelling ? (error ?? undefined) : undefined}
        onConfirm={() => void doCancel()}
        onCancel={() => {
          setCancelling(null);
          setError(null);
        }}
      />
    </LiffLookScope>
  );
}
