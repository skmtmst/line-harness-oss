import { useEffect, useState } from 'react';
import { api, type BookingHistoryItem } from '../lib/api.js';
import Icon from './ui/Icon.js';
import Button from './ui/Button.js';

/**
 * 予約が済んだあとのオンラインの会議（B7・★V8 sjkwK・I5hxa）。
 * 確定：会議の URL を開くボタンは開始 10 分前から終わりまでだけ出す（それより前は時刻だけ）。
 * 確認待ち：URL は出さず「確定したら LINE で送る」とだけ伝える（口も確定の前は URL を返さない）。
 * 読む口は予約の履歴（/api/liff/booking/me の meeting_mode・meeting_url）。対面・読めないときは何も出さない。
 */
const JOIN_BEFORE_MS = 10 * 60 * 1000;

export function meetingProvider(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (host.endsWith('zoom.us')) return 'Zoom';
    if (host === 'meet.google.com') return 'Google Meet';
    if (host.endsWith('teams.microsoft.com') || host.endsWith('teams.live.com')) return 'Teams';
  } catch {
    return null;
  }
  return null;
}

function hm(ms: number): string {
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export default function OnlineMeetingCard({ bookingId, status, now = () => Date.now() }: { bookingId: string | null | undefined; status: string; now?: () => number }) {
  const [item, setItem] = useState<BookingHistoryItem | null>(null);
  useEffect(() => {
    if (!bookingId) return;
    let alive = true;
    void Promise.resolve().then(() => api.me()).then((res) => {
      if (alive) setItem([...res.upcoming, ...res.past].find((entry) => entry.id === bookingId) ?? null);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [bookingId]);
  if (!item || item.meeting_mode !== 'online') return null;
  const confirmed = status === 'confirmed' && item.status === 'confirmed';
  const provider = confirmed ? meetingProvider(item.meeting_url) : null;
  const start = new Date(item.starts_at).getTime();
  const end = item.ends_at ? new Date(item.ends_at).getTime() : start + 60 * 60 * 1000;
  const t = now();
  const open = confirmed && item.meeting_url && t >= start - JOIN_BEFORE_MS && t <= end;
  return (
    <section aria-label="オンラインの会議" className="space-y-2.5 rounded-(--liff-radius-lg) bg-canvas p-3.5 outline outline-2 -outline-offset-2 outline-liff-primary">
      <p className="flex items-center gap-2 text-[15px] font-bold text-ink">
        <Icon name="video" className="h-4 w-4 shrink-0 text-liff-primary" />
        {provider ? `オンライン（${provider}）` : 'オンライン'}
      </p>
      {!confirmed ? (
        <p className="text-[13px] leading-5 text-ink">確定したら、会議の URL を LINE でお送りします。</p>
      ) : !item.meeting_url ? (
        <p className="text-[13px] leading-5 text-ink">会議の URL は前日までに LINE でお送りします。</p>
      ) : (
        <>
          <p className="text-[13px] leading-5 text-ink">{`担当：${item.staff_name} ・ URL は LINE にも送りました`}</p>
          {open ? (
            <Button variant="primary" onClick={() => window.open(item.meeting_url ?? '', '_blank', 'noopener')}>会議に参加する</Button>
          ) : null}
          <p className="text-xs leading-[18px] text-liff-sub">
            {open ? '会議の画面が開きます。' : `開始 10 分前（${hm(start - JOIN_BEFORE_MS)}）から参加のボタンが出ます。`}
          </p>
        </>
      )}
    </section>
  );
}
