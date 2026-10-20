import { ACCOUNT_STYLES, type AccountStyle } from '@line-crm/shared';


/** Only the selected public style crosses the customer boundary. Answers and internal flags stay private. */
export async function accountCustomerStyle(db: D1Database, accountId: string): Promise<AccountStyle | null> {
  const row = await db.prepare(
    "SELECT style FROM account_styles WHERE line_account_id=? AND selection_mode='configured' AND selected_at IS NOT NULL",
  ).bind(accountId).first<{ style: string }>();
  return row && ACCOUNT_STYLES.includes(row.style as AccountStyle) ? row.style as AccountStyle : null;
}
