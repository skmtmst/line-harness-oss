import { useCallback, useEffect, useState } from 'react';
import { api, type EventBookingMine, type MakeupCredit } from '../lib/api.js';
import { utcToJstHm } from '../lib/datetime.js';
import AbsenceSheet, { mdHm } from './AbsenceSheet.js';
import MakeupPicker from './MakeupPicker.js';
import Button from './ui/Button.js';
import Card from './ui/Card.js';

/**
 * 予約の履歴に並ぶ教室の予約（B3・rx3FL・kzE16）。振替を使うクラスの行に［欠席する］、
 * 残っている振替があれば「振替先を選ぶ」。欠席の確定と振替先の選択は別の操作。
 */
export default function LessonHistorySection({ onPicking }: { onPicking?: (picking: boolean) => void }) {
  const [items, setItems] = useState<EventBookingMine[]>([]);
  const [credits, setCredits] = useState<MakeupCredit[]>([]);
  const [target, setTarget] = useState<EventBookingMine | null>(null);
  const [justAbsent, setJustAbsent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    Promise.resolve().then(() => api.myEventBookings('upcoming')).then((r) => setItems(r.items.filter((b) => b.makeup?.enabled && (b.status === 'requested' || b.status === 'confirmed') && Date.parse(b.slot_starts_at) > Date.now()))).catch(() => setItems([]));
    Promise.resolve().then(() => api.makeupCredits()).then((r) => setCredits(r.credits.filter((c) => c.status === 'open'))).catch(() => setCredits([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { onPicking?.(credits.length > 0); return () => onPicking?.(false); }, [credits.length, onPicking]);
  if (items.length === 0 && credits.length === 0 && !target) return null;
  return (
    <section className="space-y-3.5" aria-label="教室の予約">
      {credits[0] ? <MakeupPicker key={credits[0].id} credit={credits[0]} justAbsent={justAbsent} onUsed={() => { setJustAbsent(null); load(); }} onLater={() => setJustAbsent(null)} /> : null}
      {error ? <p role="alert" className="text-[13px] leading-5 text-danger">{error}</p> : null}
      <ul className="space-y-3.5">
        {items.map((b) => (
          <li key={b.id}>
            <Card className="space-y-2.5 p-3.5">
              <h3 className="text-[15px] font-bold text-ink">{mdHm(b.slot_starts_at)}</h3>
              <p className="text-[13px] text-ink">{[b.event_name, b.venue_name].filter(Boolean).join('・ ')}</p>
              <p className="text-xs text-liff-sub">{[b.makeup?.plan_label, b.makeup?.cutoff_at ? `欠席の連絡は ${utcToJstHm(b.makeup.cutoff_at)} まで` : null].filter(Boolean).join(' ・ ')}</p>
              <Button variant="secondary" onClick={() => { setError(null); setTarget(b); }}>欠席する</Button>
            </Card>
          </li>
        ))}
      </ul>
      {target ? <AbsenceSheet booking={target} onClose={() => setTarget(null)} onDone={({ credit, reason }) => {
        const t = target; setTarget(null);
        if (credit) setJustAbsent(t.slot_starts_at); else if (reason) setError(reason);
        load();
      }} /> : null}
    </section>
  );
}
