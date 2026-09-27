import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, type EventBookingMine, type EventDetail, type EventSlot } from '../lib/api.js';
import {
  formatJstEventAt,
  formatJstEventSpan,
  utcToJstHm,
  utcToJstMd,
  utcToJstWeekday,
} from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from '../components/LoadErrorView.js';
import LoadingView from '../components/LoadingView.js';
import Icon from '../components/ui/Icon.js';
import Button from '../components/ui/Button.js';
import BottomBar from '../components/ui/BottomBar.js';
import PageHeader from '../components/ui/PageHeader.js';

/**
 * 表示してよいURLか。保存時に弾き切れない古い行もあるため、表示側でも
 * https だけをリンク・画像にする (issue 607 の対応)。http・javascript:・
 * 不正文字列は出さない（Worker側の保存拒否とあわせた二層防御）。
 */
export function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value.trim());
}

/** 枠の右に出す残席の文言。数は数えられる分だけ、無ければ「—」にしない。 */
function seatLabel(s: EventSlot): string {
  if (s.remaining != null && s.remaining <= 0) return '満席';
  if (s.capacity == null) return '定員なし';
  if (s.remaining != null) return `残り ${s.remaining}`;
  return '受付中';
}

/**
 * 2-a イベントの詳細。時間を選んでから下の操作の帯で進む。
 * API・上限の数え方・失敗の扱いはそのまま。見た目だけ ★V7。
 */
export default function Event() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // initLiff() は ?liffId=... をクエリから読むので、内部遷移でも保持する。
  // search を維持しないと再読み込みで liffId が失われる。
  const { search } = useLocation();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [slots, setSlots] = useState<EventSlot[]>([]);
  const [myActive, setMyActive] = useState<EventBookingMine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      setFailed(false);
      setLoading(true);
      try {
        // GET 系はパブリック（liffId 経由のアカウント解決のみ）。これらは
        // 失敗するとイベント詳細が出せないので全体失敗扱い。
        const [e, s] = await Promise.all([
          api.getEvent(id!),
          api.getEventSlots(id!),
        ]);
        if (cancelled) return;
        setEvent(e);
        setSlots(s.items);
        setSelectedId(null);

        // 自分の予約数は id_token verify が必要。LIFF が Login Channel に
        // 紐付いてない / login_channel_id 未登録 / friend 未追加など、いろん
        // な要因で 401 になる可能性がある。バッジ表示が落ちるだけなので
        // best-effort にして本画面は描画を続ける。
        try {
          const [upcoming, past] = await Promise.all([
            api.myEventBookings('upcoming'),
            api.myEventBookings('past'),
          ]);
          if (cancelled) return;
          const all = [...upcoming.items, ...past.items];
          setMyActive(
            all.filter(
              (b) => b.event_id === e.id && (b.status === 'requested' || b.status === 'confirmed'),
            ),
          );
        } catch (authErr) {
          // 認証なし → 上限の数えだけ弱くなり、通常表示で続行。
          console.warn('[event] me bookings unavailable:', authErr);
        }
      } catch (err) {
        if (!cancelled) {
          logFailure('event-detail', err);
          setFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  if (loading || failed || !event) {
    return (
      <div className="min-h-screen bg-ground">
        <div className="mx-auto w-full max-w-md space-y-4 px-4 pt-2 pb-10">
          <PageHeader title="イベント" />
          {failed ? (
            <LoadErrorView onRetry={() => setReloadKey((k) => k + 1)} />
          ) : (
            <LoadingView />
          )}
        </div>
      </div>
    );
  }

  const myCount = myActive.length;
  const max = event.max_bookings_per_friend;
  const overLimit = max != null && myCount >= max;

  const starts = slots.map((s) => s.starts_at).sort();
  const ends = slots.map((s) => s.ends_at).sort();
  const span = starts.length > 0 ? formatJstEventSpan(starts[0], ends[ends.length - 1]) : null;

  const caps = slots.map((s) => s.capacity).filter((c): c is number => c != null);
  const rems = slots.map((s) => s.remaining).filter((r): r is number => r != null);
  const seats =
    caps.length === 0
      ? '定員なし'
      : rems.length === 0
        ? `定員 ${caps.reduce((a, b) => a + b, 0)} 席`
        : `残り ${rems.reduce((a, b) => a + b, 0)} 席（定員 ${caps.reduce((a, b) => a + b, 0)}）`;

  function goConfirm() {
    if (!selectedId || overLimit) return;
    const next = new URLSearchParams(search);
    next.set('slotId', selectedId);
    navigate({ pathname: `/events/${id}/confirm`, search: next.toString() });
  }

  return (
    <div className="min-h-screen bg-ground">
      <div className="mx-auto w-full max-w-md space-y-4 px-4 pt-2 pb-28">
        <PageHeader title="イベント" />
        {isHttpsUrl(event.image_url) ? (
          <img
            src={event.image_url}
            alt=""
            className="h-48 w-full rounded-xl border border-hairline object-cover"
          />
        ) : (
          <div
            className="flex h-48 w-full items-center justify-center rounded-xl bg-state-mark text-ink-faint"
            aria-hidden="true"
          >
            <Icon name="image" className="h-8 w-8" />
          </div>
        )}
        <div className="space-y-2">
          <h2 className="text-lg font-bold text-ink">{event.name}</h2>
          {span && (
            <p className="flex items-start gap-2 text-sm text-ink">
              <Icon name="calendar" className="mt-0.5 h-4 w-4 shrink-0 text-ink-secondary" />
              <span>{span}</span>
            </p>
          )}
          {event.venue_name && (
            <p className="flex items-start gap-2 text-sm text-ink">
              <Icon name="map-pin" className="mt-0.5 h-4 w-4 shrink-0 text-ink-secondary" />
              <span className="min-w-0 flex-1 truncate" title={event.venue_name}>
                {event.venue_name}
              </span>
            </p>
          )}
          <p className="flex items-start gap-2 text-sm text-ink">
            <Icon name="users" className="mt-0.5 h-4 w-4 shrink-0 text-ink-secondary" />
            <span>{seats}</span>
          </p>
          {isHttpsUrl(event.venue_url) && (
            <a
              href={event.venue_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-sm text-info-link underline"
              title={event.venue_url}
            >
              {event.venue_url}
            </a>
          )}
        </div>
        {event.description && (
          <p
            className={`text-sm leading-6 whitespace-pre-wrap text-ink ${event.description_centered === 1 ? 'text-center' : ''}`}
          >
            {event.description}
          </p>
        )}

        <div>
          <h3 className="mb-2 text-sm font-bold text-ink">時間を選ぶ</h3>
          {slots.length === 0 ? (
            <p className="text-sm text-ink-secondary">現在予約可能な枠はありません。</p>
          ) : (
            <ul className="space-y-2">
              {slots.map((s) => {
                const full = s.remaining != null && s.remaining <= 0;
                const disabled = full || overLimit;
                const selected = selectedId === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() => setSelectedId(s.id)}
                      title={formatJstEventAt(s.starts_at)}
                      className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-not-allowed ${
                        selected
                          ? 'border-accent-deep bg-ok-bg'
                          : 'border-hairline bg-canvas'
                      } ${disabled ? 'bg-ground text-ink-faint' : ''}`}
                    >
                      <span
                        className={`text-sm font-semibold whitespace-nowrap ${selected ? 'text-ok-ink' : disabled ? 'text-ink-faint' : 'text-ink'}`}
                      >
                        {utcToJstMd(s.starts_at)}({utcToJstWeekday(s.starts_at)}) {utcToJstHm(s.starts_at)}〜
                        {utcToJstHm(s.ends_at)}
                      </span>
                      <span
                        className={`shrink-0 text-xs whitespace-nowrap ${selected ? 'text-ok-ink' : 'text-ink-secondary'}`}
                      >
                        {seatLabel(s)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {overLimit && (
            <p role="alert" className="mt-2 text-xs leading-5 text-danger">
              このイベントへの予約上限（{max}）に達しています。
            </p>
          )}
        </div>
      </div>
      <BottomBar>
        <Button variant="primary" disabled={!selectedId || overLimit} onClick={goConfirm}>
          {selectedId ? 'この時間で申し込む' : '時間を選んでください'}
        </Button>
      </BottomBar>
    </div>
  );
}
