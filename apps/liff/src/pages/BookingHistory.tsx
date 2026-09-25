import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type BookingHistoryItem } from '../lib/api.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from '../components/LoadErrorView.js';
import LoadingView from '../components/LoadingView.js';
import HistoryCard from '../components/HistoryCard.js';
import PageHeader from '../components/ui/PageHeader.js';
import StatusView from '../components/ui/StatusView.js';
import Icon from '../components/ui/Icon.js';

/**
 * 3-a・3-c 予約の履歴。「これから／これまで」の切り替え。
 * キャンセル・変更の操作は付けない (LIFF では出来ない)。
 * 読み直し・保存の中身はそのまま。見た目と文言だけ ★V7。
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

  return (
    <div className="min-h-screen bg-ground">
      <div className="mx-auto w-full max-w-md space-y-4 px-4 pt-2 pb-10">
        <PageHeader title="予約の履歴" />
        {failed ? (
          <LoadErrorView onRetry={() => setReloadKey((k) => k + 1)} />
        ) : !data ? (
          <LoadingView />
        ) : (
          <>
            <div
              className="flex rounded-xl bg-hairline/40 p-1"
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
            {(tab === 'upcoming' ? data.upcoming : data.past).length === 0 ? (
              tab === 'upcoming' ? (
                <StatusView
                  icon="calendar"
                  title="これからの予約はありません"
                  body="空いている日時から、そのまま予約できます。"
                  action={{ label: '予約する', onClick: () => navigate({ pathname: '/booking', search }) }}
                />
              ) : (
                <StatusView icon="calendar" title="これまでの予約はありません" />
              )
            ) : (
              <ul className="space-y-2">
                {(tab === 'upcoming' ? data.upcoming : data.past).map((b) => (
                  <HistoryCard key={b.id} booking={b} />
                ))}
              </ul>
            )}
            <p className="flex gap-1.5 text-xs leading-5 text-ink-secondary">
              <Icon name="message-circle" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>予定の変更・キャンセルは、お店に LINE でご連絡ください。</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
