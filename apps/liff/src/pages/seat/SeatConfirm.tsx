import { useEffect, useState } from 'react';
import { changeRule, longDate, remainingText, stayText, zonedParts } from '../../lib/seat-reserve.js';

/**
 * ② 確認 (★V8 km8EG)。お店・日時・人数・お席・お名前・電話の箱、ご要望、取り消しの決まり、仮押さえの残り時間。
 * 確定のボタンは下の操作の帯 (呼ぶ側) に置く。仮押さえの時間が切れたら onExpired を呼ぶ。
 *
 * 口が無いもの (報告済み)：ご要望・電話は席予約の口に送り先が無い。ご要望は入力できない形で
 * 「LINEでお送りください」と案内し、電話は「LINEでご連絡します」と書く (受け取らない値を集めない)。
 */
export default function SeatConfirm({
  timeZone,
  storeName,
  customerName,
  startsAt,
  endsAt,
  guestCount,
  cancelDeadlineMinutesBefore,
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
    ['お席', 'お店で決めます'],
    ['お名前', `${customerName} さま`],
    ['電話', 'LINEでご連絡します'],
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
      </dl>
      <div className="flex flex-col gap-1.5">
        <p className="flex items-center gap-1.5 text-[13px] leading-5 font-bold text-ink">
          ご要望（任意）<span className="text-[11px] leading-[17px] font-normal text-liff-sub">任意</span>
        </p>
        <p className="flex h-9 items-center truncate rounded-(--liff-radius) bg-canvas px-3 text-sm text-liff-sub outline outline-1 -outline-offset-1 outline-liff-line-strong">
          ご要望はこのあと LINE でお送りください
        </p>
      </div>
      <ul className="flex flex-col gap-1 rounded-(--liff-radius) bg-liff-off-bg p-3 text-xs leading-[18px] text-liff-sub">
        <li>{`・${changeRule(startsAt, cancelDeadlineMinutesBefore, timeZone, now)}`}</li>
        <li>・遅れるときは、この LINE でお店へお知らせください</li>
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
      <div className="flex">
        <button
          type="button"
          onClick={onBack}
          className="text-xs leading-[18px] text-liff-sub focus-visible:outline-2 focus-visible:outline-ink"
        >
          ← 時刻を選び直す
        </button>
      </div>
      <div className="pb-40" aria-hidden="true" />
    </div>
  );
}
