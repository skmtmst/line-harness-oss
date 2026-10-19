import type { EventBookingMine } from '../lib/api.js';

/** 札の文字は設計どおり (★V8 ：申し込み済み・キャンセル待ち…)。意味は今の状態名のまま変えない。 */
export const statusMeta: Record<string, { text: string; tone: 'confirmed' | 'pending' | 'neutral' }> = {
  confirmed: { text: '申し込み済み', tone: 'confirmed' },
  waitlisted: { text: 'キャンセル待ち', tone: 'pending' },
  requested: { text: '承認待ち', tone: 'pending' },
  rejected: { text: '見送り', tone: 'neutral' },
  cancelled: { text: 'キャンセル', tone: 'neutral' },
  expired: { text: '期限切れ', tone: 'neutral' },
  attended: { text: '参加済', tone: 'neutral' },
  no_show: { text: '不参加', tone: 'neutral' },
};

export function canLeaveWaitlist(b: EventBookingMine): boolean {
  return b.source === 'waitlist' && (b.status === 'waitlisted' || b.status === 'waiting' || b.status === 'offered');
}
