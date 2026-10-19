import {
  liffActionUrl,
  type AccountStyle,
  type SetupAnswer,
} from '@line-crm/shared';

import type { StarterItem } from './style-starter-definition.js';
import { featureReadiness } from './style-readiness.js';
export async function restaurantMenuButtons(
  db: D1Database,
  account: string,
  style: AccountStyle,
  item: StarterItem,
  answers: Record<string, SetupAnswer>,
) {
  const line = await db
    .prepare('SELECT liff_id FROM line_accounts WHERE id=?')
    .bind(account)
    .first<{ liff_id: string | null }>();
  const buttons = [];
  for (const button of item.buttons ?? []) {
    const answer = answers[button.feature];
    if (
      button.feature !== 'contact' &&
      ((answer && (answer.mode !== 'configured' || answer.value === false)) ||
        (!answer &&
          !(await featureReadiness(db, account, button.feature, style)).ready))
    )
      continue;
    let actionType = 'message',
      actionData = button.label,
      intent = 'text';
    if (line?.liff_id && ['booking', 'stamps'].includes(button.feature)) {
      if (button.feature === 'stamps')
        actionData = liffActionUrl({
          kind: 'visit_stamp',
          liffId: line.liff_id,
        });
      else if (style === 'restaurant') {
        const link = await db
          .prepare(
            'SELECT l.token FROM rt_reservation_links l JOIN rt_stores s ON s.id=l.store_id WHERE s.line_account_id=? LIMIT 1',
          )
          .bind(account)
          .first<{ token: string }>();
        if (!link) continue;
        actionData = `https://liff.line.me/${encodeURIComponent(line.liff_id)}?${new URLSearchParams({ page: 'restaurant', token: link.token })}`;
      } else if (style === 'lesson')
        actionData = `https://liff.line.me/${encodeURIComponent(line.liff_id)}?page=event`;
      else
        actionData = liffActionUrl({ kind: 'booking', liffId: line.liff_id });
      actionType = 'uri';
      intent = 'url';
    }
    buttons.push({ ...button, actionType, actionData, intent });
  }
  return buttons;
}
