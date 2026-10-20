import { restaurantMenuButtons } from './style-restaurant-buttons.js';
import { liffActionUrl, type AccountStyle, type SetupAnswer } from '@line-crm/shared';

import { isCustomerUri, type StarterItem } from './style-starter-definition.js';
import { featureReadiness } from './style-readiness.js';

/** Preview and persistence use the same resolver; a missing destination never becomes a fake text action. */
export async function styleMenuButtons(
  db: D1Database, account: string, style: AccountStyle, item: StarterItem,
  answers: Record<string, SetupAnswer>,
) {
  if (style === 'restaurant') return restaurantMenuButtons(db, account, style, item, answers);
  const line = await db.prepare('SELECT liff_id FROM line_accounts WHERE id=?')
    .bind(account).first<{ liff_id: string | null }>();
  const buttons = [];
  for (const button of item.buttons ?? []) {
    const answer = answers[button.feature];
    if (button.feature !== 'contact' && answer && (answer.mode !== 'configured' || answer.value === false)) continue;
    let actionType = 'message', actionData = button.label, intent = 'text';
    if (button.feature === 'contact') {
      buttons.push({ ...button, actionType, actionData, intent });
      continue;
    }
    if (button.actionType === 'uri') {
      if (!isCustomerUri(button.actionData)) continue;
      const target = new URL(button.actionData);
      // A stored foreign LIFF ID must not take customers into another account.
      if (target.hostname === 'liff.line.me' && target.pathname.split('/')[1] !== line?.liff_id) continue;
      actionType = 'uri'; actionData = button.actionData; intent = 'url';
    } else if (button.actionType === 'message' && button.actionData?.trim()) {
      actionData = button.actionData;
    } else if (line?.liff_id) {
      const liffBase = `https://liff.line.me/${encodeURIComponent(line.liff_id)}`;
      if (button.feature === 'tickets') {
        actionData = `${liffBase}/?page=mypage`;
      } else if (button.feature === 'classCapacity' || (button.feature === 'booking' && style === 'lesson')) {
        if (button.actionData === 'history') actionData = `${liffBase}/events/me`;
        else {
          // A real published class, never the nonexistent page=event list.
          const event = await db.prepare(
            "SELECT id FROM events WHERE line_account_id=? AND is_published=1 AND deleted_at IS NULL AND (lifecycle_status IS NULL OR lifecycle_status='published') AND (? IS NULL OR id=?) ORDER BY id LIMIT 2",
          ).bind(account, answer?.resourceId ?? null, answer?.resourceId ?? null).all<{ id: string }>();
          // Multiple classes require an explicit destination rather than silently choosing one.
          if (event.results.length !== 1) continue;
          actionData = `${liffBase}/events/${encodeURIComponent(event.results[0]!.id)}`;
        }
      } else if (['booking', 'stamps'].includes(button.feature)) {
        if (!(await featureReadiness(db, account, button.feature, style)).ready) continue;
        if (button.feature === 'stamps') actionData = liffActionUrl({ kind: 'visit_stamp', liffId: line.liff_id });
        else actionData = liffActionUrl({ kind: button.actionData === 'history' ? 'booking_history' : 'booking', liffId: line.liff_id });
      } else continue; // Photos, documents, shop URLs and coupons need a concrete existing URI/keyword.
      actionType = 'uri'; intent = 'url';
    } else continue;
    buttons.push({ ...button, actionType, actionData, intent });
  }
  return buttons;
}
