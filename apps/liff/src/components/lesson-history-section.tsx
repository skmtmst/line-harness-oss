import { useCallback, useEffect, useState } from 'react';
import { api, type EventBookingMine, type MakeupCredit } from '../lib/api.js';
import { utcToJstHm } from '../lib/datetime.js';
import AbsenceSheet, { mdHm } from './absence-sheet.js';
import MakeupPicker from './makeup-picker.js';
import Button from './ui/button/index.js';
import Card from './ui/card.js';
import LoadErrorView from './load-error-view.js';

/**
 * 予約の履歴に並ぶ教室の予約（B3・rx3FL・kzE16）。振替を使うクラスの行に［欠席する］、
 * 残っている振替があれば「振替先を選ぶ」。欠席の確定と振替先の選択は別の操作。
 */
export default function LessonHistorySection({ onPicking, onLater, onBookingChanged, creditsOnly = false }: { onPicking?: (picking: boolean) => void; onLater?: () => void; onBookingChanged?: () => void; creditsOnly?: boolean }) {
  const [items, setItems] = useState<EventBookingMine[]>([]);
  const [credits, setCredits] = useState<MakeupCredit[]>([]);
  const [target, setTarget] = useState<EventBookingMine | null>(null);
  const [justAbsent, setJustAbsent] = useState<{ startsAt: string; name: string | null } | null>(null);
  /** 欠席した回を探すための、今・これまでの予約（振替が返す欠席元の予約 ID から日時と教室名を引く）。 */
  const [known, setKnown] = useState<EventBookingMine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(() => {
    setLoadFailed(false);
    Promise.resolve().then(() => api.myEventBookings('upcoming')).then((r) => { const rows = r.items; setKnown((prev) => (Array.isArray(rows) ? [...rows, ...prev.filter((p) => !rows.some((i) => i.id === p.id))] : prev)); setItems(r.items.filter((b) => b.makeup?.enabled && (b.status === 'requested' || b.status === 'confirmed') && Date.parse(b.slot_starts_at) > Date.now())); }).catch(() => setLoadFailed(true));
    Promise.resolve().then(() => api.myEventBookings('past')).then((r) => setKnown((prev) => (Array.isArray(r.items) ? [...prev, ...r.items.filter((i) => !prev.some((p) => p.id === i.id))] : prev))).catch(() => setLoadFailed(true));
    Promise.resolve().then(() => api.makeupCredits()).then((r) => setCredits(r.credits.filter((c) => c.status === 'open'))).catch(() => setLoadFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { onPicking?.(credits.length > 0); return () => onPicking?.(false); }, [credits.length, onPicking]);
  const sourceOf = (c: MakeupCredit) => { if (justAbsent) return justAbsent; const b = known.find((k) => k.id === c.source_event_booking_id); return b ? { startsAt: b.slot_starts_at, name: b.event_name } : null; };
  if (loadFailed) return <LoadErrorView compact note="教室の予約・振替の履歴はなくなっていません。" onRetry={load} />;
  if ((creditsOnly || items.length === 0) && credits.length === 0 && !target) return null;
  return (
    <section className="space-y-3.5" aria-label="教室の予約">
      {credits[0] ? <MakeupPicker key={credits[0].id} credit={credits[0]} source={sourceOf(credits[0])} onUsed={() => { setJustAbsent(null); load(); onBookingChanged?.(); }} onLater={() => { setJustAbsent(null); onLater?.(); }} /> : null}
      {error ? <p role="alert" className="text-[13px] leading-5 text-danger">{error}</p> : null}
      <ul className="space-y-3.5">
        {(creditsOnly ? [] : items).map((b) => (
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
        if (credit) setJustAbsent({ startsAt: t.slot_starts_at, name: t.event_name }); else if (reason) setError(reason);
        load();
      }} /> : null}
    </section>
  );
}
