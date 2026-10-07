import type { RestaurantCustomerBooking } from '@line-crm/shared';
import Icon from '../../components/ui/Icon.js';
import { STATUS_LABEL, changeRule, longDate, zonedParts } from '../../lib/seat-reserve.js';

/**
 * ③ 受け付けました (★V8 sAnyy)。緑の丸の印＋題＋説明＋日時・人数・状態の箱。
 * 下の帯 (LINEに戻る・予約を変える・取り消す) は呼ぶ側が置く。
 */
export default function SeatDone({
  booking,
  timeZone,
  cancelDeadlineMinutesBefore,
  changed,
}: {
  booking: RestaurantCustomerBooking;
  timeZone: string;
  cancelDeadlineMinutesBefore: number;
  /** 変更のあと。題を「変更しました」にする。 */
  changed: boolean;
}) {
  const p = zonedParts(booking.startsAt, timeZone);
  const rows: Array<[string, string]> = [
    ['日時', `${longDate(p.date)}${p.hm}〜`],
    ['人数', `${booking.guestCount}名`],
    ['状態', STATUS_LABEL[booking.status] ?? booking.status],
  ];
  return (
    <div className="space-y-3.5" data-design-node="sAnyy">
      <div className="flex flex-col items-center pt-10 text-center">
        <span
          className="mt-3.5 flex h-18 w-18 items-center justify-center rounded-full bg-liff-soft text-liff-primary"
          aria-hidden="true"
        >
          <Icon name="check" className="h-9 w-9" />
        </span>
        <p className="mt-3.5 text-xl leading-[29px] font-bold text-ink">
          {changed ? 'ご予約を変更しました' : 'ご予約を受け付けました'}
        </p>
        <p className="mt-3.5 text-[13px] leading-[21px] text-pretty text-liff-sub">
          確認の LINE をお送りしました。
          <br />
          {`${changeRule(booking.startsAt, cancelDeadlineMinutesBefore, timeZone)}。`}
        </p>
      </div>
      <dl className="divide-y divide-liff-divider rounded-(--liff-radius-lg) bg-canvas px-3.5 py-1 outline outline-1 -outline-offset-1 outline-liff-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex h-10 items-start gap-2 py-2.5">
            <dt className="w-18 shrink-0 text-xs leading-[17px] text-liff-sub">{k}</dt>
            <dd className="min-w-0 flex-1 truncate text-sm leading-5 font-semibold text-ink" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <div className="pb-48" aria-hidden="true" />
    </div>
  );
}
