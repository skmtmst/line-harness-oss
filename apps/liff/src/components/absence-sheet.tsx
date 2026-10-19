import { jstDate as japanDate } from '@line-crm/shared';
import { useRef, useState } from 'react';
import { api, type EventBookingMine, type MakeupCredit } from '../lib/api.js';
import { logFailure } from '../lib/user-message.js';
import { utcToJstHm, utcToJstMd, formatWeekday } from '../lib/datetime.js';
import Button from './ui/button/index.js';
import Icon from './ui/icon.js';

const jstDay = (iso: string) => japanDate(new Date(iso));
export const mdHm = (iso: string) => `${utcToJstMd(iso)}（${formatWeekday(jstDay(iso))}）${utcToJstHm(iso)}`;

/**
 * 欠席の確かめ（下から出る窓・B3 rx3FL）。締めの内なら「振替を 1 回お渡しします（○/○ まで）」、
 * 締めの後は「今の欠席は振替の対象外です」。欠席の確定と振替先の選択は別の操作（振替先はあとで選べる）。
 */
export default function AbsenceSheet({ booking, onClose, onDone }: {
  booking: EventBookingMine;
  onClose: () => void;
  onDone: (result: { credit: MakeupCredit | null; reason?: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* 二重に押しても 1 回だけ（同じキーで送り直す）。 */
  const key = useRef(crypto.randomUUID());
  const cutoff = booking.makeup?.cutoff_at ? Date.parse(booking.makeup.cutoff_at) : null;
  const eligible = cutoff === null || Date.now() <= cutoff;
  const when = mdHm(booking.slot_starts_at);

  async function run() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const res = await api.eventAbsence(booking.id, key.current);
      onDone({ credit: res.credit, reason: res.reason_if_none });
    } catch (e) {
      logFailure('event-absence', e);
      setError('欠席を送れませんでした。もう一度お試しください。');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 text-ink" role="dialog" aria-modal="true" aria-label="欠席の確かめ" onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose(); }}>
      <Button variant="overlay" aria-label="閉じる" onClick={() => { if (!busy) onClose(); }} />
      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md space-y-3.5 rounded-t-(--liff-radius-lg) bg-canvas px-5 pt-3 pb-8">
        <span className="mx-auto block h-1 w-10 rounded-full bg-liff-chip" aria-hidden="true" />
        <h2 className="pt-3 text-[17px] leading-6 font-bold text-ink">{`${when} ${booking.event_name} を欠席しますか？`}</h2>
        <div data-absence-panel className="flex items-center gap-3 rounded-(--liff-radius) bg-liff-soft p-3.5">
          <Icon name="repeat" className="h-5 w-5 shrink-0 text-liff-primary" />
          <div className="min-w-0">
            <p className="text-[13px] leading-5 font-bold text-ink">{eligible ? '振替を 1 回お渡しします' : '今の欠席は振替の対象外です'}</p>
            <p className="text-xs leading-[18px] text-liff-sub">{eligible ? `${booking.makeup?.valid_until ? `${utcToJstMd(booking.makeup.valid_until)} まで・` : ''}同じクラスの空いている回へ` : '欠席の連絡の締めを過ぎています。欠席はできます。'}</p>
          </div>
        </div>
        <p className="text-[13px] leading-5 text-liff-sub">振替先はこのあと選べます。あとで選んでも大丈夫です。</p>
        {error ? <p role="alert" className="text-[13px] leading-5 text-danger">{error}</p> : null}
        <Button variant="primary" disabled={busy} onClick={() => void run()}>欠席する</Button>
        <div className="flex justify-center"><Button variant="text" disabled={busy} onClick={onClose}>やめる</Button></div>
      </div>
    </div>
  );
}
