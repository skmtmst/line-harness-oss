import { useEffect, useState } from 'react';
import PrivacyNote from '../../components/ui/PrivacyNote.js';
import { changeRule, longDate, remainingText, stayText, zonedParts } from '../../lib/seat-reserve.js';

const FIELD = 'h-9 w-full rounded-(--liff-radius) bg-canvas px-3 text-sm text-ink placeholder:text-liff-sub outline outline-1 -outline-offset-1 outline-liff-line-strong focus-visible:outline-2 focus-visible:outline-ink';

/**
 * ② 確認 (★V8 km8EG)。お店・日時・人数・お席・お名前・電話の箱、ご要望、取り消しの決まり、仮押さえの残り時間。
 * 確定のボタンは下の操作の帯 (呼ぶ側) に置く。仮押さえの時間が切れたら onExpired を呼ぶ。
 *
 * ご要望（任意・200字）と電話（任意）は、確定の口へ送る（API-11）。お席は割り当てた卓・空いている卓の種類。
 * 遅れたときの決まりは店の設定（無ければ LINE で知らせる案内）。変更（reschedule）は前の予約の値を見せるだけ。
 */
export default function SeatConfirm({
  timeZone,
  storeName,
  customerName,
  startsAt,
  endsAt,
  guestCount,
  cancelDeadlineMinutesBefore,
  seat,
  late,
  note,
  phone,
  onNote,
  onPhone,
  holdExpiresAt,
  holdMinutes,
  reschedule,
  error,
  onBack,
  onExpired,
}: {
  timeZone: string;
  storeName: string;
  customerName: string;
  startsAt: string;
  endsAt: string;
  guestCount: number;
  cancelDeadlineMinutesBefore: number;
  /** お席の言葉（「テーブル席（お店で決めます）」）。 */
  seat: string;
  /** 遅れたときの決まりの1文（句点なし）。 */
  late: string;
  note: string;
  phone: string;
  onNote: (value: string) => void;
  onPhone: (value: string) => void;
  /** 仮押さえの期限。変更 (reschedule) のときは仮押さえが無いので null。 */
  holdExpiresAt: string | null;
  /** お取りしている長さ (分)。 */
  holdMinutes: number;
  reschedule: boolean;
  error: string | null;
  /** 「← 時刻を選び直す」。下の帯は確定のボタンだけにする (板どおり)。 */
  onBack: () => void;
  onExpired: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!holdExpiresAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [holdExpiresAt]);
  const left = holdExpiresAt ? Date.parse(holdExpiresAt) - now : null;
  useEffect(() => {
    if (left !== null && left <= 0) onExpired();
  }, [left !== null && left <= 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = zonedParts(startsAt, timeZone);
  const rows: Array<[string, string]> = [
    ['お店', storeName],
    ['日時', `${longDate(p.date)}${p.hm}〜${stayText(startsAt, endsAt)}`],
    ['人数', `${guestCount}名`],
    ['お席', seat],
    ['お名前', `${customerName} さま`],
  ];

  return (
    <div className="space-y-3.5" data-design-node="km8EG">
      <h2 className="text-xl font-bold text-ink">{reschedule ? 'この内容に変更します' : 'この内容で予約します'}</h2>
      <dl className="flex flex-col gap-2.5 rounded-(--liff-radius-lg) bg-canvas p-3.5 outline outline-1 -outline-offset-1 outline-liff-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-start gap-3">
            <dt className="shrink-0 text-[13px] leading-5 text-liff-sub">{k}</dt>
            <dd className="min-w-0 flex-1 truncate text-[13px] leading-5 font-semibold text-ink" title={v}>
              {v}
            </dd>
          </div>
        ))}
        <div className="flex items-start gap-3">
          <dt className="shrink-0 text-[13px] leading-5 text-liff-sub">
            <label htmlFor="seat-phone">電話</label>
          </dt>
          <dd className="min-w-0 flex-1">
            {reschedule ? (
              <span className="block truncate text-[13px] leading-5 font-semibold text-ink">{phone || '—'}</span>
            ) : (
              <input
                id="seat-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={50}
                value={phone}
                onChange={(e) => onPhone(e.target.value)}
                placeholder="任意（お店からの連絡用）"
                className="block w-full bg-transparent text-[13px] leading-5 font-semibold text-ink placeholder:font-normal placeholder:text-liff-sub focus-visible:outline-2 focus-visible:outline-ink"
              />
            )}
          </dd>
        </div>
      </dl>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="seat-note" className="flex items-center gap-1.5 text-[13px] leading-5 font-bold text-ink">
          ご要望（任意）<span className="text-[11px] leading-[17px] font-normal text-liff-sub">任意</span>
        </label>
        {reschedule ? (
          <p className="flex h-9 items-center truncate rounded-(--liff-radius) bg-canvas px-3 text-sm text-ink outline outline-1 -outline-offset-1 outline-liff-line-strong">
            {note || 'なし'}
          </p>
        ) : (
          <input
            id="seat-note"
            type="text"
            maxLength={200}
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder="例：記念日です・ベビーカーで行きます"
            className={FIELD}
          />
        )}
      </div>
      <ul className="flex flex-col gap-1 rounded-(--liff-radius) bg-liff-off-bg p-3 text-xs leading-[18px] text-liff-sub">
        <li>{`・${changeRule(startsAt, cancelDeadlineMinutesBefore, timeZone, now)}`}</li>
        <li>{`・${late}`}</li>
      </ul>
      {left !== null && (
        <p className="text-xs leading-[18px] text-liff-wait-ink" role="timer" aria-live="off">
          {left > 0
            ? `この時刻を ${holdMinutes}分 お取りしています（残り ${remainingText(left)}）`
            : 'お取りしていた時間が過ぎました。時刻を選び直してください。'}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] leading-6 text-danger">
          {error}
        </p>
      )}
      <PrivacyNote />
      <div className="flex">
        <button
          type="button"
          onClick={onBack}
          className="liff-hit text-xs leading-[18px] text-liff-sub focus-visible:outline-2 focus-visible:outline-ink"
        >
          ← 時刻を選び直す
        </button>
      </div>
      <div className="pb-40" aria-hidden="true" />
    </div>
  );
}
