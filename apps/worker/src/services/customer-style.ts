import { ACCOUNT_STYLES, type AccountStyle } from '@line-crm/shared';


/** 顧客側へ渡すのは選択済みの公開スタイルだけとし、回答と内部フラグは返さない。 */
export async function accountCustomerStyle(db: D1Database, accountId: string): Promise<AccountStyle | null> {
  const row = await db.prepare(
    "SELECT style FROM account_styles WHERE line_account_id=? AND selection_mode='configured' AND selected_at IS NOT NULL",
  ).bind(accountId).first<{ style: string }>();
  return row && ACCOUNT_STYLES.includes(row.style as AccountStyle) ? row.style as AccountStyle : null;
}
