import type { FormAvailability } from '@line-crm/shared';

export { choiceReceptionLabel } from '../lib/form-reception.js';
export default function FormReception({ availability }: { availability?: FormAvailability }) {
  if (!availability) return null;
  return <div className="space-y-1 text-xs text-ink-secondary" aria-label="回答の受付条件">
    {availability.deadlineAt && <p>締め切り：{new Date(availability.deadlineAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</p>}
    {availability.oncePerFriend && <p>回答はお一人さま1回までです</p>}
    {availability.totalRemaining != null && <p>受付上限まで残り{availability.totalRemaining}件（送信時に確定します）</p>}
    {!availability.accepting && <p>{availability.reason || 'このフォームは現在受付を停止しています'}</p>}
  </div>;
}
