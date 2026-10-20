import { jstDate as japanDate } from '@line-crm/shared';
import Icon from './ui/icon.js';
import { formatWeekday, utcToJstHm, utcToJstMd } from '../lib/datetime.js';

/**
 * 未払いの払う期限（★V8 nWby5・L5g75・）。履歴のカードとマイページで同じ言葉を出す。
 * 「10/24（金）18:00 までにお支払いください」＋「過ぎると…」。期限が分からないときは期限の行を出さない。
 */
export function holdDeadlineText(holdUntil: string): string {
  return `${utcToJstMd(holdUntil)}（${formatWeekday(utcToJstDateKey(holdUntil))}）${utcToJstHm(holdUntil)} までにお支払いください`;
}

function utcToJstDateKey(iso: string): string {
  return japanDate(new Date(iso));
}

export default function UnpaidPaymentNote({ holdUntil, after = '過ぎると予約は取り消され、枠はほかの方に回ります' }: { holdUntil: string | null; after?: string }) {
  if (!holdUntil) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-[12.5px] leading-[18px] font-bold text-liff-wait-ink">
        <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
        {holdDeadlineText(holdUntil)}
      </p>
      <p className="text-[11.5px] leading-[17px] text-liff-sub">{after}</p>
    </div>
  );
}
