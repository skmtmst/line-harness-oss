import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type MakeupCredit, type MakeupOption } from '../lib/api.js';
import { addDays, formatMd, formatWeekday, jstToday, utcToJstHm } from '../lib/datetime.js';
import { logFailure } from '../lib/user-message.js';
import Button from './ui/Button.js';
import BottomBar from './ui/BottomBar.js';
import Icon from './ui/Icon.js';
import { mdHm } from './AbsenceSheet.js';

const jstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const mondayOf = (date: string) => { const d = new Date(`${date}T00:00:00Z`); return addDays(date, -((d.getUTCDay() + 6) % 7)); };

/**
 * 振替の帯と「振替先を選ぶ」（B3 kzE16）。帯＝「振替 1 回・○/○ まで」。
 * 週のカレンダーで日を選び、同じ種類・期限内・空きのある回だけを並べる。満席の回は選べない。
 * 選ぶ前に空きを確かめ直し、埋まっていたらその旨を出す（振替は残る）。［振替先はあとで選ぶ］で閉じても振替は残る。
 */
export default function MakeupPicker({ credit, source, onUsed, onLater }: {
  credit: MakeupCredit;
  /** 欠席した回（日時と教室名）。帯の 1 行目に書く。口が返さない間は、予約の一覧から探して渡す。 */
  source?: { startsAt: string; name: string | null } | null;
  onUsed: () => void;
  onLater?: () => void;
}) {
  /* 欠席した回の次の週（今日より前は選べない）から始める。 */
  const firstLoad = useRef(true);
  const [week, setWeek] = useState(() => { const next = credit.source_starts_at ? addDays(mondayOf(jstDate(credit.source_starts_at)), 7) : jstToday(); const today = jstToday(); return mondayOf(next > today ? next : today); });
  const [options, setOptions] = useState<MakeupOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(crypto.randomUUID());

  const load = useCallback(() => {
    setOptions(null); setFailed(false);
    api.makeupOptions(credit.id, week).then((r) => {
      const inWeek = (o: MakeupOption) => { const d = jstDate(o.starts_at); return d >= week && d <= addDays(week, 6); };
      const earliest = r.options.find((o) => !o.full);
      /* 初めて開いたときだけ、振替できる一番早い日の週へ移る（見えている週と選んだ日を食い違わせない）。 */
      if (firstLoad.current) {
        firstLoad.current = false;
        if (earliest && !inWeek(earliest)) { setWeek(mondayOf(jstDate(earliest.starts_at))); return; }
      }
      setOptions(r.options);
      const first = r.options.find((o) => !o.full && inWeek(o));
      setDay((cur) => (cur && r.options.some((o) => jstDate(o.starts_at) === cur && inWeek(o)) ? cur : first ? jstDate(first.starts_at) : null));
      setPicked((cur) => (cur && r.options.some((o) => o.slot_id === cur && !o.full && inWeek(o)) ? cur : first?.slot_id ?? null));
    }).catch((e) => { logFailure('makeup-options', e); setFailed(true); });
  }, [credit.id, week]);
  useEffect(() => { load(); }, [load]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const rows = (options ?? []).filter((o) => !day || jstDate(o.starts_at) === day);
  const chosen = (options ?? []).find((o) => o.slot_id === picked) ?? null;

  async function use() {
    if (!chosen || busy) return;
    setBusy(true); setError(null);
    try { await api.useMakeup(credit.id, chosen.slot_id, key.current); onUsed(); }
    catch (e) {
      logFailure('makeup-use', e);
      const code = (e as { body?: { error?: string } }).body?.error;
      if (code === 'slot_full' || code === 'slot_conflict') { key.current = crypto.randomUUID(); setError('この回は埋まりました。ほかの回を選んでください。振替は残っています。'); load(); }
      else setError('振替を予約できませんでした。振替は残っています。もう一度お試しください。');
    } finally { setBusy(false); }
  }

  return (
    <section className="space-y-3.5" aria-label="振替">
      <div data-makeup-band className="flex flex-col gap-1.5 rounded-(--liff-radius-lg) bg-liff-soft p-3.5 outline-1 -outline-offset-1 outline-liff-primary">
        <p className="flex items-center gap-2 text-sm font-bold text-ink"><Icon name="repeat" className="h-4 w-4 text-liff-primary" />{`振替 1 回・${formatMd(jstDate(credit.expires_at))} まで`}</p>
        <p className="text-[13px] leading-5 text-ink">{(() => { const at = source?.startsAt ?? credit.source_starts_at; const name = source?.name ?? credit.source_name ?? ''; return at ? `${mdHm(at)} ${name} を欠席にしました。振替先はあとで選んでも大丈夫です。` : '振替先はあとで選んでも大丈夫です。'; })()}</p>
      </div>
      <div className="space-y-3 rounded-(--liff-radius-lg) bg-canvas p-3.5 outline-1 -outline-offset-1 outline-liff-line">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink">振替先を選ぶ</h2>
          <span className="flex items-center gap-2 text-xs text-liff-sub">
            <Button variant="icon" aria-label="前の週" onClick={() => setWeek(addDays(week, -7))}><Icon name="chevron-left" className="h-4 w-4" /></Button>
            {`${formatMd(week)}〜${formatMd(addDays(week, 6))}`}
            <Button variant="icon" aria-label="次の週" onClick={() => setWeek(addDays(week, 7))}><Icon name="chevron-right" className="h-4 w-4" /></Button>
          </span>
        </div>
        <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="日にち">
          {days.map((d) => {
            const has = (options ?? []).some((o) => jstDate(o.starts_at) === d && !o.full);
            return (
              <Button key={d} variant="day" selected={day === d} unavailable={!has} disabled={!has} aria-pressed={day === d} onClick={() => { setDay(d); setPicked((options ?? []).find((o) => jstDate(o.starts_at) === d && !o.full)?.slot_id ?? null); }}>
                <span className="liff-num text-sm font-bold">{Number(d.slice(8))}</span>
                <span className="text-[10.5px]">{formatWeekday(d)}</span>
              </Button>
            );
          })}
        </div>
        {failed ? <p role="alert" className="text-[13px] text-danger">空いている回を読み込めませんでした。<Button variant="link" onClick={load}>もう一度</Button></p> : null}
        {options !== null && options.length === 0 ? (
          <p className="text-[13px] leading-5 text-liff-sub">期限内に空いている回がありません。お店にご相談ください。</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((o) => {
              const selected = o.slot_id === picked;
              return (
                <li key={o.slot_id}>
                  <Button variant="option" selected={selected} unavailable={o.full} disabled={o.full} aria-pressed={selected} onClick={() => { setPicked(o.slot_id); setError(null); }}>
                    <span className={`liff-num text-sm font-bold whitespace-nowrap ${o.full ? 'text-liff-off-ink' : 'text-ink'}`}>{utcToJstHm(o.starts_at)}</span>
                    <span className={`min-w-0 flex-1 truncate text-left text-[13px] ${o.full ? 'text-liff-off-ink' : 'text-ink'}`}>{o.name}</span>
                    <span className={`shrink-0 text-xs whitespace-nowrap ${o.full ? 'text-danger' : 'text-liff-sub'}`}>{o.full ? '満席（選べません）' : o.remaining != null ? `残り ${o.remaining}` : '空きあり'}</span>
                    {selected ? <Icon name="circle-check" className="h-[18px] w-[18px] shrink-0 text-liff-primary" /> : null}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {error ? <p role="alert" className="text-[13px] leading-5 text-danger">{error}</p> : null}
      <div className="pb-40" aria-hidden="true" />
      <BottomBar>
        <Button variant="primary" disabled={!chosen || busy} onClick={() => void use()}>{chosen ? `${mdHm(chosen.starts_at)} に振り替える` : '振替先を選んでください'}</Button>
        {onLater ? <Button variant="text" onClick={onLater}>振替先はあとで選ぶ</Button> : null}
      </BottomBar>
    </section>
  );
}
