


/**
 * IDEA-21: job の payload から起点となった注文番号を取り出す。
 * 発送後の案内（arrival_check / review_request / cross_sell）の payload は
 * `{ event }` の形で `event.order.number` を持つ。コラム・誕生日の payload は
 * 注文を持たないので null が返り、後続の注文状態チェックを素通りする。
 */
export function orderNumberFromPayload(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    const event = parsed?.event as Record<string, unknown> | undefined;
    const order = event?.order as Record<string, unknown> | undefined;
    const number = order?.number;
    return typeof number === 'string' && number.trim() ? number.trim() : null;
  } catch {
    return null;
  }
}


/**
 * IDEA-21: ECの注文台帳（ec_orders）の現在状態を返す。
 * `external_order_id` は注文番号。行が無いときは「取り消しとは言えない」ので
 * null を返し、呼び出し側は送信を止めない（連携の未到着で案内を欠かさない）。
 */
export async function currentOrderState(
  db: D1Database,
  lineAccountId: string | null,
  orderNumber: string,
): Promise<string | null> {
  if (!lineAccountId) return null;
  const row = await db.prepare(
    `SELECT normalized_status FROM ec_orders
      WHERE line_account_id = ? AND external_order_id = ?
      ORDER BY updated_at DESC LIMIT 1`,
  ).bind(lineAccountId, orderNumber).first<{ normalized_status: string }>();
  return row?.normalized_status ?? null;
}
