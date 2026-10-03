import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, type BookingHistoryItem } from '../lib/api.js';
import { logFailure } from '../lib/user-message.js';
import LoadErrorView from '../components/LoadErrorView.js';
import LoadingView from '../components/LoadingView.js';
import HistoryCard from '../components/HistoryCard.js';
import LiffHeader from '../components/ui/LiffHeader.js';
import StatusView from '../components/ui/StatusView.js';
import BottomBar from '../components/ui/BottomBar.js';
import Button from '../components/ui/Button.js';
import Icon from '../components/ui/Icon.js';

/**
 * 予約の履歴 (★V8・YvTJ3)。「これから／これまで」の切り替え。
 * カードの「日時を変える／キャンセル」は機能追加 F-6・API待ちのため出さない。
 * 進む操作は下の帯の「新しく予約する」1つだけ。読み直し・中身はそのまま。
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
    <div className="min-h-screen bg-canvas" style={{ fontFamily: 'var(--liff-look-font-body)' }}>
      <LiffHeader title="予約の履歴" />
      <div
        data-design-node="YvTJ3"
        className="mx-auto w-full max-w-md space-y-3.5 px-4 pt-3 pb-40"
      >
        <h1
          className="text-xl font-bold text-[var(--liff-look-ink)]"
          style={{ fontFamily: 'var(--liff-look-font-heading)' }}
        >
          予約の履歴
        </h1>
        {failed ? (
          <LoadErrorView note="予約はなくなっていません。" onRetry={() => setReloadKey((k) => k + 1)} />
        ) : !data ? (
          <LoadingView />
        ) : (
          <>
            <div
              className="flex rounded-[var(--liff-look-radius)] bg-[var(--liff-look-chip)] p-[3px]"
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
                  className={`flex h-8 flex-1 items-center justify-center rounded-lg text-xs focus-visible:outline-2 focus-visible:outline-ink ${
                    tab === t.key
                      ? 'bg-canvas font-bold text-[var(--liff-look-ink)]'
                      : 'font-semibold text-[var(--liff-look-sub)]'
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
                />
              ) : (
                <StatusView icon="calendar" title="これまでの予約はありません" />
              )
            ) : (
              <ul className="space-y-3.5">
                {(tab === 'upcoming' ? data.upcoming : data.past).map((b) => (
                  <HistoryCard key={b.id} booking={b} />
                ))}
              </ul>
            )}
            <p className="flex gap-1.5 text-[11.5px] leading-[17px] text-[var(--liff-look-sub)]">
              <Icon name="message-circle" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>予定の変更・キャンセルは、お店に LINE でご連絡ください。</span>
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
    </div>
  );
}
