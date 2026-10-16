import type { RoutedTarget } from '../lib/api.js';
import { bookingPriceText } from '../lib/booking-price.js';
import Card from './ui/Card.js';
import Icon from './ui/Icon.js';

/**
 * 答えで予約の行き先が決まったときの案内（B6・Z76uuv）。担当を選ばせず、すぐ日時から始める。
 * 行き先は答えで決まっていて、お客さまが書き換えることはできない。
 */
export function RoutedBanner({ target }: { target: RoutedTarget }) {
  const mode = target.meetingMode === 'online' ? 'オンライン（Zoom・Meet）' : target.meetingMode === 'in_person' ? 'お店で' : null;
  const meta = [target.staffName ? `担当：${target.staffName}` : null, mode, bookingPriceText(target.price, target.price > 0 ? 'fixed' : 'free')].filter(Boolean).join(' ・ ');
  return (
    <section data-routed-banner aria-label="ご案内" className="space-y-2 rounded-(--liff-radius-lg) bg-liff-soft p-3.5 outline-2 -outline-offset-1 outline-liff-primary">
      <p className="text-[15px] leading-6 font-bold text-ink">{`ご相談の内容に合わせて〈${target.menuName}〉をご案内します`}</p>
      <p className="text-xs leading-[18px] text-liff-sub">
        {meta}
        {target.meetingMode === 'online' ? <><br />会議の URL は予約が確定したあと LINE で届きます</> : null}
      </p>
    </section>
  );
}

/** 行き先に空きが無いとき（R02q7）。白い画面にせず、お店へ問い合わせる道を出す。 */
export function NoRoutedSlots({ target, days }: { target: RoutedTarget; days: number }) {
  return (
    <Card className="flex flex-col items-center gap-2 px-5 py-8 text-center">
      <Icon name="calendar-x" className="h-8 w-8 text-liff-sub" />
      <p className="text-[15px] font-bold text-ink">ご案内できる日時がありません</p>
      <p className="text-xs leading-[18px] text-liff-sub">{`${Math.ceil(days / 7)} 週間先まで、${target.menuName}の空きがありません。お店にご相談ください。`}</p>
    </Card>
  );
}
