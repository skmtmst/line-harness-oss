import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type EventDetail, type EventSlot } from '../lib/api.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from '../components/LoadErrorView.js';
import LoadingView from '../components/LoadingView.js';

function formatJp(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
}

function nanoid(): string {
  return crypto.randomUUID();
}

export default function EventConfirm() {
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const slotId = search.get('slotId') ?? '';
  const navigate = useNavigate();

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
      navigate(`/events/${id}/done?bookingId=${res.id}&status=${res.status}`);
    } catch (err) {
      logFailure('create-event-booking', err);
      const e = err as { status?: number; body?: { error?: string } };
      const code = e.body?.error;
      const msg = (() => {
        switch (code) {
          case 'slot_full': return 'すでに満員になりました。別の日時をお選びください。';
          case 'over_friend_limit': return 'このイベントへの予約上限に達しています。';
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

  if (loadFailed) {
    return <LoadErrorView onRetry={() => setReloadKey((k) => k + 1)} />;
  }
  if (slotMissing) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="text-sm leading-6 text-gray-600">
          選択した枠は受付終了しました。別の日時をお選びください。
        </p>
        <button
          type="button"
          onClick={() => navigate(`/events/${id}`)}
          className="mt-4 w-full rounded-lg border border-gray-300 bg-white py-3 text-sm font-semibold text-gray-700 active:bg-gray-100"
        >
          イベントページに戻る
        </button>
      </div>
    );
  }
  if (!event || !slot) {
    return <LoadingView />;
  }

  return (
    <div className="p-4 pb-20">
      <h1 className="text-lg font-bold mb-3">予約内容の確認</h1>
      <div className="border rounded p-3 mb-4 space-y-1">
        <div className="text-sm font-semibold">{event.name}</div>
        <div className="text-sm text-gray-700">📅 {formatJp(slot.starts_at)}</div>
        {event.venue_name && <div className="text-sm text-gray-700">📍 {event.venue_name}</div>}
      </div>

      {event.requires_approval === 1 && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 text-xs rounded p-2 mb-3">
          このイベントは承認制です。受付後、運営が承認するまでお待ちください。
        </div>
      )}

      {(event.questions ?? []).length > 0 && (
        <div className="space-y-3 mb-4">
          {(event.questions ?? []).map((q) => {
            const value = answers[q.id];
            return (
              <div key={q.id}>
                <label className="block text-sm font-medium mb-1">
                  {q.label}
                  {q.required && <span className="text-red-600 ml-1">*</span>}
                </label>
                {q.type === 'text' && (
                  <input
                    type="text"
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => setAnswers((cur) => ({ ...cur, [q.id]: e.target.value }))}
                    className="w-full border rounded p-2 text-sm"
                  />
                )}
                {q.type === 'textarea' && (
                  <textarea
                    value={typeof value === 'string' ? value : ''}
                    onChange={(e) => setAnswers((cur) => ({ ...cur, [q.id]: e.target.value }))}
                    rows={3}
                    className="w-full border rounded p-2 text-sm"
                  />
                )}
                {q.type === 'radio' && (
                  <div className="space-y-1">
                    {(q.options ?? []).map((opt) => (
                      <label key={opt} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={`eq-${q.id}`}
                          checked={value === opt}
                          onChange={() => setAnswers((cur) => ({ ...cur, [q.id]: opt }))}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                )}
                {q.type === 'checkbox' && (
                  <div className="space-y-1">
                    {(q.options ?? []).map((opt) => {
                      const chosen = Array.isArray(value) ? value : [];
                      const checked = chosen.includes(opt);
                      return (
                        <label key={opt} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setAnswers((cur) => ({
                                ...cur,
                                [q.id]: checked ? chosen.filter((x) => x !== opt) : [...chosen, opt],
                              }))
                            }
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

      <label className="block text-sm font-medium mb-1">備考（任意）</label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={4}
        maxLength={5000}
        className="w-full border rounded p-2 text-sm"
        placeholder="質問や伝えたいことがあれば..."
      />
      <div className="text-xs text-gray-500 text-right">{note.length} / 5000</div>

      {submitError && <div className="bg-red-50 text-red-700 p-2 rounded mt-2 text-sm">{submitError}</div>}

      <button
        onClick={submit}
        disabled={submitting}
        className="mt-5 w-full py-3 bg-blue-600 text-white rounded font-medium disabled:opacity-50"
      >
        {submitting ? '送信中...' : '予約をリクエスト'}
      </button>
      <button
        onClick={() => navigate(-1)}
        disabled={submitting}
        className="mt-2 w-full py-2 text-gray-600 text-sm"
      >
        戻る
      </button>
    </div>
  );
}
