import { ACCOUNT_STYLES, type AccountStyle } from '@line-crm/shared';


/** Customer-facing words follow terms.md; no new style or feature is enabled. */
export function notificationWords(style: AccountStyle = 'standard') {
  return {
    contact: style === 'consult' ? '担当' : style === 'lesson' ? '教室' : 'お店',
    menu: style === 'consult' ? '面談の種類' : style === 'lesson' ? 'クラス' : style === 'restaurant' ? 'コース' : 'メニュー',
    staff: style === 'lesson' ? '講師' : '担当',
    event: style === 'lesson' ? 'クラス' : 'イベント',
  };
}

export async function readNotificationStyle(db: D1Database, accountId: string): Promise<AccountStyle> {
  const row = await db.prepare("SELECT style FROM account_styles WHERE line_account_id=? AND selection_mode='configured'")
    .bind(accountId).first<{ style: AccountStyle }>();
  return row && ACCOUNT_STYLES.includes(row.style) ? row.style : 'standard';
}
