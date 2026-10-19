import type { PublicationViewSample } from '@line-crm/shared';

export type EcItem = {
  name: string;
  quantity: number;
  product_id?: string | number | null;
  product_url?: string | null;
  unit_amount?: number | null;
  line_amount?: number | null;
};

export type EcEvent = {
  customer_identity?: {email?:string;email_verified?:boolean;phone?:string;phone_verified?:boolean;name?:string;postal_code?:string};
  event_id: string;
  event_type: string;
  occurred_at: string;
  customer_id?: string | number | null;
  point_balance?: number | null;
  purchase_count?: number | null;
  purchase_amount?: number | null;
  line_user_id?: string | null;
  /**
   * ECが計算した会員ランク・マイル（★37-1）。EC側が対応してから届く。
   * 届いた値を正とし、LINE側で足し算しない。
   */
  membership?: {
    annual_miles_yen?: number | null;
    lifetime_miles_yen?: number | null;
    member_rank_key?: string | null;
    member_rank_name?: string | null;
    mile_rate_percent?: number | null;
    rank_valid_until?: string | null;
    mile_balance?: number | null;
    miles_used_this_month?: number | null;
    last_purchased_at?: string | null;
  } | null;
  order?: {
    number?: string;
    total?: number;
    currency?: string;
    date?: string;
    payment_method?: string;
    items?: EcItem[];
    delivery_date?: string | null;
    delivery_time?: string | null;
    detail_url?: string | null;
    payment_deadline?: string | null;
    /** 注文で使われたクーポンコード。誕生日クーポンの利用記録（used_at）へつなげる。 */
    coupon_code?: string | null;
  };
  order_history?: Array<{
    id?: string;
    number?: string;
    date?: string;
    total?: number;
    items?: EcItem[];
    detail_url?: string | null;
  }>;
  subscriptions?: Array<{
    id?: string;
    contract_number?: string;
    status?: string;
    status_code?: string;
    next_charge_date?: string | null;
    next_shipping_date?: string | null;
    cycle?: string | null;
    items?: EcItem[];
  }>;
  shipping?: {
    carrier?: string | null;
    tracking_number?: string | null;
    tracking_url?: string | null;
    shipped_at?: string | null;
  };
  refund?: {
    amount?: number | null;
    full_refund?: boolean | null;
  };
  subscription?: {
    id?: string;
    contract_number?: string;
    amount?: number;
    scheduled_shipping_date?: string | null;
    next_order_date?: string | null;
    change_deadline?: string | null;
    manage_url?: string | null;
    mypage_subscription_url?: string | null;
    payment_method_update_url?: string | null;
    status?: string;
    status_code?: string;
    next_charge_date?: string | null;
    next_shipping_date?: string | null;
    cycle?: string | null;
    items?: EcItem[];
    retry_status?: string | null;
  };
  profile?: {
    owner_name?: string | null;
    pets?: Array<{
      id?: string | number | null;
      name: string;
      animal_type?: 'dog' | 'cat' | 'other';
      gender?: 'male' | 'female' | 'unknown';
      birthday?: string | null;
    }>;
  };
  /**
   * 公式サイトの掲載写真の閲覧数（F-20）。
   * ECが数えた累計を写真ID単位で送る。musuboは大きい方だけ残す。
   */
  publication_views?: PublicationViewSample[] | null;
};



function memberRank(_count: number, amount: number): string {
  if (amount >= 100000) return 'プラチナ会員';
  if (amount >= 50000) return 'ゴールド会員';
  if (amount >= 20000) return 'シルバー会員';
  return '会員';
}


export async function syncMemberSnapshot(db: D1Database, friendId: string, event: EcEvent, now: string): Promise<void> {
  const current = await db.prepare(`SELECT * FROM nen_ec_member_snapshots WHERE friend_id = ?`).bind(friendId).first<Record<string, unknown>>();
  let orders: Array<Record<string, unknown>> = current ? JSON.parse(String(current.orders_json || '[]')) : [];
  let subscription: Record<string, unknown> | null = current?.subscription_json ? JSON.parse(String(current.subscription_json)) : null;
  const hasPurchaseCount = Number.isFinite(event.purchase_count);
  const hasPurchaseAmount = Number.isFinite(event.purchase_amount);
  let count = hasPurchaseCount ? Math.max(0, Math.round(Number(event.purchase_count))) : Number(current?.purchase_count || 0);
  let amount = hasPurchaseAmount ? Math.max(0, Math.round(Number(event.purchase_amount))) : Number(current?.purchase_amount || 0);
  const pointBalance = Number.isFinite(event.point_balance)
    ? Math.max(0, Math.round(Number(event.point_balance)))
    : Number(current?.point_balance || 0);
  if (event.event_type === 'ec.customer.profile_updated' && Array.isArray(event.order_history)) {
    orders = event.order_history.map((order) => ({
      id: order.id || `eccube:order:${order.number || crypto.randomUUID()}`,
      number: order.number,
      date: order.date,
      total: order.total || 0,
      items: order.items || [],
      detailUrl: order.detail_url || null,
    })).slice(0, 50);
    subscription = { contracts: Array.isArray(event.subscriptions) ? event.subscriptions : [], updatedAt: event.occurred_at };
  }
  if (event.event_type === 'ec.order.confirmed' && event.order) {
    const order = { id: event.event_id, number: event.order.number, date: event.occurred_at, total: event.order.total || 0, paymentMethod: event.order.payment_method || null, items: event.order.items || [], detailUrl: event.order.detail_url || null };
    if (!orders.some((item) => item.id === event.event_id || (event.order?.number && item.number === event.order.number))) {
      orders = [order, ...orders].slice(0, 50);
      if (!hasPurchaseCount) count += 1;
      if (!hasPurchaseAmount) amount += Math.max(0, Math.round(event.order.total || 0));
    }
  }
  if (event.event_type.startsWith('ec.subscription.') && event.subscription) {
    const currentContracts = Array.isArray(subscription?.contracts) ? subscription.contracts as Array<Record<string, unknown>> : subscription ? [subscription] : [];
    const nextContract = { ...event.subscription, status: event.event_type === 'ec.subscription.cancelled' ? '解約済み' : event.event_type === 'ec.subscription.payment_failed' ? '決済確認が必要' : '契約中', updatedAt: event.occurred_at };
    const matchIndex = currentContracts.findIndex(contract => (event.subscription?.id && contract.id === event.subscription.id) || (event.subscription?.contract_number && contract.contract_number === event.subscription.contract_number));
    if (matchIndex >= 0) currentContracts[matchIndex] = { ...currentContracts[matchIndex], ...nextContract };
    else currentContracts.unshift(nextContract);
    subscription = { contracts: currentContracts.slice(0, 20), updatedAt: event.occurred_at };
  }
  await db.prepare(
    `INSERT INTO nen_ec_member_snapshots (friend_id, customer_id, orders_json, subscription_json, purchase_count, purchase_amount, point_balance, member_rank, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(friend_id) DO UPDATE SET customer_id=COALESCE(excluded.customer_id, customer_id), orders_json=excluded.orders_json,
       subscription_json=excluded.subscription_json, purchase_count=excluded.purchase_count,
       purchase_amount=excluded.purchase_amount, point_balance=excluded.point_balance,
       member_rank=excluded.member_rank, synced_at=excluded.synced_at`,
  ).bind(friendId, event.customer_id == null ? null : String(event.customer_id), JSON.stringify(orders), subscription ? JSON.stringify(subscription) : null, count, amount, pointBalance, memberRank(count, amount), now).run();
  await applyMembership(db, friendId, event, { amount, pointBalance, orderDate: event.event_type === 'ec.order.confirmed' ? event.occurred_at : null });
}


const nonNegativeInt = (value: unknown): number | null =>
  Number.isFinite(value) ? Math.max(0, Math.round(Number(value))) : null;


/**
 * ECが計算した会員ランク・マイルを写す。
 *
 * `membership` が届いていればその値を正にする（通年・ライフタイム・ランク・残高）。
 * 届いていない（EC側が未対応・古い注文イベント）ときは、暫定として
 * ライフタイム＝これまでの足し算、残高＝ポイント残高だけを追いかけ、
 * ランクキーは触らない（設定としきい値から画面側で求める）。
 */
async function applyMembership(
  db: D1Database,
  friendId: string,
  event: EcEvent,
  fallback: { amount: number; pointBalance: number; orderDate: string | null },
): Promise<void> {
  const membership = event.membership;
  if (membership && typeof membership === 'object') {
    const rankKey = typeof membership.member_rank_key === 'string' && membership.member_rank_key.trim() ? membership.member_rank_key.trim().slice(0, 64) : null;
    const rankName = typeof membership.member_rank_name === 'string' && membership.member_rank_name.trim() ? membership.member_rank_name.trim().slice(0, 40) : null;
    const rate = Number.isFinite(membership.mile_rate_percent) ? Math.max(0, Math.min(10, Number(membership.mile_rate_percent))) : null;
    await db.prepare(
      `UPDATE nen_ec_member_snapshots
          SET annual_miles_yen = COALESCE(?, annual_miles_yen),
              lifetime_miles_yen = COALESCE(?, lifetime_miles_yen),
              member_rank_key = COALESCE(?, member_rank_key),
              member_rank = COALESCE(?, member_rank),
              mile_rate_percent = COALESCE(?, mile_rate_percent),
              rank_valid_until = COALESCE(?, rank_valid_until),
              mile_balance = COALESCE(?, mile_balance),
              miles_used_this_month = COALESCE(?, miles_used_this_month),
              last_purchased_at = COALESCE(?, last_purchased_at)
        WHERE friend_id = ?`,
    ).bind(
      nonNegativeInt(membership.annual_miles_yen),
      nonNegativeInt(membership.lifetime_miles_yen),
      rankKey,
      rankName,
      rate,
      typeof membership.rank_valid_until === 'string' ? membership.rank_valid_until.slice(0, 32) : null,
      nonNegativeInt(membership.mile_balance),
      nonNegativeInt(membership.miles_used_this_month),
      typeof membership.last_purchased_at === 'string' ? membership.last_purchased_at.slice(0, 32) : null,
      friendId,
    ).run();
    return;
  }
  await db.prepare(
    `UPDATE nen_ec_member_snapshots
        SET lifetime_miles_yen = MAX(lifetime_miles_yen, ?),
            mile_balance = ?,
            last_purchased_at = COALESCE(?, last_purchased_at)
      WHERE friend_id = ? AND member_rank_key IS NULL`,
  ).bind(fallback.amount, fallback.pointBalance, fallback.orderDate ? fallback.orderDate.slice(0, 32) : null, friendId).run();
}
