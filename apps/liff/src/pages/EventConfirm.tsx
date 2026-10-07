import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type EventDetail, type EventSlot } from '../lib/api.js';
import { formatJstEventAt } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from '../components/LoadErrorView.js';
import LoadingView from '../components/LoadingView.js';
import Icon from '../components/ui/Icon.js';
import Button from '../components/ui/Button.js';
import BottomBar from '../components/ui/BottomBar.js';
import PrivacyNote from '../components/ui/PrivacyNote.js';
import LiffHeader from '../components/ui/LiffHeader.js';
import LiffLookScope from '../components/LiffLookScope.js';

function nanoid(): string {
  return crypto.randomUUID();
}

/**
 * 2-b 申し込みの確認。送る中身のカード＋案内の帯＋備考。
 * 進む操作 (申し込む) は下の操作の帯にだけ置く。
 * 質問・備考・冪等キー・送信の失敗の扱いはそのまま。見た目だけ ★V7。
 *
 * 満席で待ちに入ったとき Worker は 200 で {waitlisted: true} を返す。
 * そのときは 2-d (キャンセル待ちに入りました) へ進む。
 */
export default function EventConfirm() {
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const slotId = search.get('slotId') ?? '';
  const navigate = useNavigate();
  // ?liffId=... を引き継ぐ (再読み込みで失わない)。
  const { search: locationSearch } = useLocation();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [slot, setSlot] = useState<EventSlot | null>(null);
  const [note, setNote] = useState('');
  // カスタム質問への回答。質問id → 文字列、複数選択は文字列配列。
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  // 読み込みの失敗と送信の失敗は別に持つ。送信の失敗は入力を消さずその場に出す。
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [slotMissing, setSlotMissing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Stable Idempotency-Key — regenerate would defeat the purpose if user
  // taps twice. One key per Confirm-screen mount.
  const idemKey = useMemo(() => nanoid(), []);

  useEffect(() => {
    if (!id || !slotId) return;
    let cancelled = false;
    async function load() {
      setLoadFailed(false);
      setSubmitError(null);
      setSlotMissing(false);
      try {
        const [e, s] = await Promise.all([api.getEvent(id!), api.getEventSlots(id!)]);
        if (cancelled) return;
        setEvent(e);
        const found = s.items.find((x) => x.id === slotId);
        if (!found) {
          // 枠が消えた / 満員でフィルタアウト / 開始済 → 詳細画面に戻す。
          // null のまま放置すると無限ローディングになる。
          setSlotMissing(true);
          return;
        }
        setSlot(found);
      } catch (err) {
        if (!cancelled) {
          logFailure('event-confirm', err);
          setLoadFailed(true);
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [id, slotId, reloadKey]);

  function goDone(query: string) {
    const keep = new URLSearchParams(locationSearch);
    const next = new URLSearchParams(query);
    for (const [k, v] of keep) {
      if (k !== 'slotId' && !next.has(k)) next.set(k, v);
    }
    navigate({ pathname: `/events/${id}/done`, search: next.toString() });
  }

  async function submit() {
    if (!id || !slotId) return;
    if (note.length > 5000) {
      setSubmitError('備考は5000字以内で入力してください');
      return;
    }
    // 必須質問の未回答を送信前に止める。サーバ側でも同じ検査をしている。
    const missing = (event?.questions ?? []).find((q) => {
      if (!q.required) return false;
      const a = answers[q.id];
      return a == null || (typeof a === 'string' ? a.trim() === '' : a.length === 0);
    });
    if (missing) {
      setSubmitError(`「${missing.label}」が未回答です`);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const hasAnswers = Object.keys(answers).length > 0;
      const res = await api.createEventBooking(
        id,
        { slot_id: slotId, customer_note: note || null, ...(hasAnswers ? { answers } : {}) },
        idemKey,
      );
      const startsAt = `startsAt=${encodeURIComponent(slot?.starts_at ?? '')}`;
      if ('waitlisted' in res) {
        goDone(`status=waitlisted&${startsAt}`);
        return;
      }
      goDone(`bookingId=${res.id}&status=${res.status}&${startsAt}`);
    } catch (err) {
      logFailure('create-event-booking', err);
      const e = err as { status?: number; body?: { error?: string } };
      const code = e.body?.error;
      const msg = (() => {
        switch (code) {
          case 'slot_full': return 'すでに満員になりました。別の日時をお選びください。';
          case 'over_friend_limit': return 'このイベントへの予約上限に達しています。';
          case 'duplicate_friend_booking': return 'この時間はすでに申し込み済みです。自分のイベントで確認してください。';
          case 'entry_closed': return '申込期限を過ぎています。別のイベントをお探しください。';
          case 'slot_started': return 'この枠は既に開始されています。';
          case 'slot_inactive': return 'この枠は受付を締め切りました。';
          case 'event_unpublished': return 'このイベントは現在受付を停止しています。';
          case 'unauthorized':
          case 'friend_not_found':
            return 'LINE 認証に失敗しました。一度 LINE のトークルームに戻り、友だち追加が完了していることを確認してから再度お試しください。';
          case 'missing_required_answers': return '未回答の必須項目があります。入力してからもう一度お試しください。';
          case 'idempotent_in_progress': return '前回のリクエストを処理中です。少しお待ちください。';
          default: return '予約を送れませんでした。時間をおいて、もう一度お試しください。';
        }
      })();
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function back() {
    navigate(-1);
  }

  if (loadFailed || slotMissing || !event || !slot) {
    return (
      <LiffLookScope className="min-h-screen bg-ground">
        <LiffHeader title="申し込みの確認" />
        <div className="mx-auto w-full max-w-md space-y-4 px-4 pt-2 pb-10">
          {loadFailed ? (
            <LoadErrorView onRetry={() => setReloadKey((k) => k + 1)} />
          ) : slotMissing ? (
            <div className="space-y-4 text-center">
              <p className="pt-8 text-sm leading-6 text-ink-secondary">
                選択した枠は受付終了しました。別の日時をお選びください。
              </p>
              <Button variant="primary" onClick={() => navigate({ pathname: `/events/${id}`, search: locationSearch })}>
                イベントページに戻る
              </Button>
            </div>
          ) : (
            <LoadingView />
          )}
        </div>
      </LiffLookScope>
    );
  }

  const infoText = event.requires_approval === 1
    ? 'このイベントは承認制です。受付後、運営が承認するまでお待ちください。キャンセルは期限まで「自分のイベント」からできます（期限はイベントごとに違います）。'
    : 'キャンセルは期限まで「自分のイベント」からできます（期限はイベントごとに違います）。';

  return (
    <LiffLookScope className="min-h-screen bg-ground" designNode="EscPA">
      <LiffHeader title="申し込みの確認" />
      <div className="mx-auto w-full max-w-md space-y-4 px-4 pt-3 pb-28">
        <h1 className="text-xl font-bold text-ink">内容を確かめてください</h1>
        <dl className="divide-y divide-liff-divider rounded-(--liff-radius-lg) bg-canvas px-3.5 py-1 outline outline-1 -outline-offset-1 outline-liff-line">
          <Row label="イベント" value={event.name} />
          <Row label="日時" value={formatJstEventAt(slot.starts_at)} />
          {event.venue_name && <Row label="場所" value={event.venue_name} />}
          {event.venue_address && <Row label="住所" value={event.venue_address} />}
        </dl>

        <div className="flex gap-2 rounded-lg bg-info-bg p-3 text-xs leading-5 text-ink">
          <Icon name="info" className="h-4 w-4 shrink-0" />
          <p>{infoText}</p>
        </div>

        {(event.questions ?? []).length > 0 && (
          <div className="space-y-4">
            {(event.questions ?? []).map((q) => {
              const value = answers[q.id];
              return (
                <div key={q.id}>
                  <span className="mb-1 block text-sm text-ink" id={`eq-label-${q.id}`}>
                    {q.label}
                    {q.required ? (
                      <span className="ml-1 text-danger" aria-label="必須">*</span>
                    ) : (
                      <span className="ml-1 text-xs text-ink-faint">任意</span>
                    )}
                  </span>
                  {q.type === 'text' && (
                    <input
                      type="text"
                      aria-labelledby={`eq-label-${q.id}`}
                      value={typeof value === 'string' ? value : ''}
                      onChange={(e) => setAnswers((cur) => ({ ...cur, [q.id]: e.target.value }))}
                      className="w-full rounded-lg border border-hairline bg-canvas p-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-ink"
                    />
                  )}
                  {q.type === 'textarea' && (
                    <textarea
                      aria-labelledby={`eq-label-${q.id}`}
                      value={typeof value === 'string' ? value : ''}
                      onChange={(e) => setAnswers((cur) => ({ ...cur, [q.id]: e.target.value }))}
                      rows={3}
                      className="w-full rounded-lg border border-hairline bg-canvas p-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-ink"
                    />
                  )}
                  {q.type === 'radio' && (
                    <div className="space-y-1" role="radiogroup" aria-labelledby={`eq-label-${q.id}`}>
                      {(q.options ?? []).map((opt) => (
                        <label key={opt} className="flex min-h-11 items-center gap-2 text-sm text-ink">
                          <input
                            type="radio"
                            name={`eq-${q.id}`}
                            checked={value === opt}
                            onChange={() => setAnswers((cur) => ({ ...cur, [q.id]: opt }))}
                            className="h-4 w-4 accent-liff-primary"
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  )}
                  {q.type === 'checkbox' && (
                    <div className="space-y-1" role="group" aria-labelledby={`eq-label-${q.id}`}>
                      {(q.options ?? []).map((opt) => {
                        const chosen = Array.isArray(value) ? value : [];
                        const checked = chosen.includes(opt);
                        return (
                          <label key={opt} className="flex min-h-11 items-center gap-2 text-sm text-ink">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setAnswers((cur) => ({
                                  ...cur,
                                  [q.id]: checked ? chosen.filter((x) => x !== opt) : [...chosen, opt],
                                }))
                              }
                              className="h-4 w-4 accent-liff-primary"
                            />
                            {opt}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <label className="block">
          <span className="text-sm font-bold text-ink">
            備考 <span className="text-[11px] font-normal text-liff-sub">任意</span>
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="質問や伝えたいことがあれば..."
            className="mt-1 min-h-24 w-full rounded-[10px] border border-liff-line-strong bg-canvas px-3.5 py-3 text-sm text-ink placeholder:text-liff-idle focus-visible:outline-2 focus-visible:outline-ink"
          />
        </label>
        <p className="text-right text-xs text-ink-faint">{note.length} / 5000</p>

        {submitError && (
          <p role="alert" className="text-sm leading-6 text-danger">
            {submitError}
          </p>
        )}
        <PrivacyNote />
      </div>
      <BottomBar>
        <Button variant="primary" onClick={submit} disabled={submitting}>
          {submitting ? '送信中...' : '申し込む'}
        </Button>
        <button
          type="button"
          onClick={back}
          className="liff-hit self-center px-4 py-1 text-xs text-liff-sub focus-visible:outline-2 focus-visible:outline-ink"
        >
          ←戻る
        </button>
      </BottomBar>
    </LiffLookScope>
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
