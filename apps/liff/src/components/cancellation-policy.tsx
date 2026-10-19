import { formatYen as yen, yenPercent, jstCalendar as japanCalendar } from '@line-crm/shared';
import type { BookingCancellationPreview } from '../lib/api.js';
import { ChoiceInput } from './forms/controls.js';

/**
 * 予約の確認の段の「キャンセル料の決まり」（B1・★V8 kwC8E・Q8HLq）。
 * 決まりがオンの店だけ出す。チェックは初めは空で、入れるまで予約のボタンは押せない（Confirm 側）。
 * 金額は料金からの割合で出す（端数は切り捨て）。デポジットがあるときは確認のカードに今払う額・お店で払う額を足す。
 */
export { yen };
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

/** 「11/19（木）14:00」。日本時間で出す。 */
export function jpDeadline(iso: string): string {
  const d = japanCalendar(new Date(iso));
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAY[d.getUTCDay()]}）${hh}:${mm}`;
}

export default function CancellationPolicy({
  preview,
  accepted,
  onAcceptedChange,
}: {
  preview: BookingCancellationPreview;
  accepted: boolean;
  onAcceptedChange: (next: boolean) => void;
}) {
  const tiers = preview.tiers?.filter((tier) => tier.percent > 0) ?? [{ beforeHours: 0, percent: preview.afterPercent }];
  const fee = (percent: number) => `料金の ${percent}%（${yen(yenPercent(preview.price, percent))}）`;
  return (
    <section aria-labelledby="cancellation-policy-heading" className="space-y-3.5">
      <h3 id="cancellation-policy-heading" className="text-base font-bold text-ink">
        {preview.deposit ? 'キャンセル料とデポジット' : 'キャンセル料'}
      </h3>
      <div className="space-y-2.5 rounded-(--liff-radius-lg) bg-canvas p-3.5 outline outline-2 -outline-offset-2 outline-liff-primary">
        <p className="text-sm font-bold text-ink">キャンセル料の決まり</p>
        <dl className="space-y-2.5 text-[13px] leading-5 text-ink">
          {preview.freeUntil ? (
            <div className="flex gap-2">
              <dt>{`${jpDeadline(preview.freeUntil)} まで`}</dt>
              <dd className="font-bold">無料</dd>
            </div>
          ) : null}
          {tiers.map((tier) => (
            <div className="flex gap-2" key={tier.beforeHours}>
              <dt>{tier.beforeHours === 0 ? 'それ以降' : `開始の${tier.beforeHours}時間前まで`}</dt>
              <dd className="font-bold">{fee(tier.percent)}</dd>
            </div>
          ))}
          <div className="flex gap-2">
            <dt>連絡なしの欠席</dt>
            <dd className="font-bold">{fee(preview.noShowPercent)}</dd>
          </div>
        </dl>
        <label className="flex min-h-8 items-center gap-2 text-[13px] text-ink">
          <ChoiceInput type="checkbox" checked={accepted} onChange={(event) => onAcceptedChange(event.target.checked)} />
          キャンセル料の決まりを確認しました
        </label>
      </div>
      <p className="text-xs leading-[18px] text-liff-sub">
        {preview.deposit
          ? 'デポジットのカード決済は準備中です。いまは試験の確認だけで、実際の請求・返金は行われません。支払い方法はトークでご確認ください。'
          : 'カード決済は準備中です。チェックを入れると試験のカードを登録できます。実際の請求・返金は行われません。支払い方法はトークでご確認ください。'}
      </p>
    </section>
  );
}
