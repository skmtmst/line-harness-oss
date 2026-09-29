import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { liffRoutes } from './liff.js';

const access = vi.hoisted(() => ({
  getScope: vi.fn(),
}));
vi.mock('../services/account-access.js', () => ({
  getVisibleLineAccountScope: access.getScope,
  canAccessAllLineAccounts: vi.fn().mockReturnValue(true),
}));

type OrderRow = {
  id: string;
  order_number: string;
  normalized_status: string;
  provider_status: string;
  currency: string;
  total_amount_minor: number | null;
  refunded_amount_minor: number | null;
  ordered_at: string;
  detail_url: string | null;
  friend_id: string;
  friend_name: string | null;
};

const orders: OrderRow[] = [
  {
    id: 'o1', order_number: '1001', normalized_status: 'current', provider_status: 'paid',
    currency: 'JPY', total_amount_minor: 5000, refunded_amount_minor: 0,
    ordered_at: '2026-08-20T10:00:00.000Z', detail_url: null,
    friend_id: 'friend-1', friend_name: '山田太郎',
  },
  {
    id: 'o2', order_number: '1002', normalized_status: 'refunded', provider_status: 'refunded',
    currency: 'JPY', total_amount_minor: 3000, refunded_amount_minor: 3000,
    ordered_at: '2026-08-21T10:00:00.000Z', detail_url: null,
    friend_id: 'friend-1', friend_name: '山田太郎',
  },
];

type RecordedQuery = { sql: string; binds: unknown[] };

/*
 * モック方針:
 * - /api/analytics/ref/:refCode/orders は3本の口を叩く。
 *   明細(all)・件数(first, COUNT)・要約(first, SUM)。
 *   どれも `ec_orders o JOIN friends f` で、f.ref_code = ? が first-touch
 *   帰属の条件。モックは渡された ref と一致する注文だけを返す。
 * - /api/analytics/ref-summary は4本。経路別一覧(all)・総数(first)・
 *   ref有り数(first)・注文の計測範囲(first, ec_orders起点)。
 */
function database(records: RecordedQuery[]): D1Database {
  return {
    prepare(sql: string) {
      const record = { sql, binds: [] as unknown[] };
      records.push(record);
      const statement = {
        bind(...binds: unknown[]) { record.binds = binds; return statement; },
        async all() {
          // ref-summary の経路別一覧(注文の相関副問合せを含むので先に判定)
          if (sql.includes('LEFT JOIN entry_routes')) {
            return {
              results: [{
                ref_code: 'campaign-a', name: '夏のキャンペーン',
                friend_count: 3, click_count: 5, latest_at: '2026-08-25T00:00:00Z',
                order_count: 2, refunded_order_count: 1, cancelled_order_count: 0,
              }],
            };
          }
          if (sql.includes('FROM ec_orders o')) {
            // 注文明細: ref_code の bind と一致する注文だけ返す(first-touch再現)
            const [refCode] = record.binds as [string];
            const attributed = refCode === 'campaign-a' ? orders : [];
            return { results: attributed };
          }
          return { results: [] };
        },
        async first() {
          // ref-summary の注文計測範囲(別名 orders_*)
          if (sql.includes('orders_total')) {
            return { orders_total: 10, orders_linked: 7, orders_attributed: 4, orders_refunded: 1, orders_cancelled: 1 };
          }
          // /orders の要約
          if (sql.includes('SUM(CASE WHEN o.normalized_status')) {
            return { refunded: 1, cancelled: 0, total_amount: 8000, refunded_amount: 3000 };
          }
          if (sql.includes('COUNT(*)') && sql.includes('FROM ec_orders')) {
            // 件数も明細と同じ母集団(first-touch帰属の注文)を返す
            const [refCode] = record.binds as [string];
            return { count: refCode === 'campaign-a' ? orders.length : 0 };
          }
          if (sql.includes('ref_code IS NOT NULL')) return { count: 3 };
          if (sql.includes('COUNT(*)') && sql.includes('FROM friends')) return { count: 5 };
          return null;
        },
        async run() { return { success: true, meta: { changes: 0 } }; },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function app() {
  const instance = new Hono();
  instance.use('*', async (c, next) => {
    c.set('staff' as never, { id: 'owner-1', role: 'owner', tenantId: 'tenant-a' } as never);
    await next();
  });
  instance.route('/', liffRoutes);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  access.getScope.mockResolvedValue({ allowedAccountIds: ['account-a'], canSeeUnassigned: false });
});

describe('GET /api/analytics/ref/:refCode/orders (IDEA-18)', () => {
  test('first-touchでこの経路に帰属する友だちの注文を、返金・取消の状態つきで返す', async () => {
    const records: RecordedQuery[] = [];
    const response = await app().request('/api/analytics/ref/campaign-a/orders', { headers: {} }, { DB: database(records) });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      success: boolean;
      data: {
        refCode: string;
        total: number;
        summary: { refunded: number; cancelled: number; totalAmount: number | null; refundedAmount: number | null };
        items: Array<{
          orderNumber: string; status: string; totalAmount: number | null;
          refundedAmount: number | null; friend: { id: string; displayName: string | null };
        }>;
      };
    };
    expect(body.data.refCode).toBe('campaign-a');
    expect(body.data.total).toBe(2);
    expect(body.data.items).toHaveLength(2);
    // 返金は「別の注文」ではなく同じ注文の状態として返る
    const refunded = body.data.items.find((o) => o.orderNumber === '1002');
    expect(refunded?.status).toBe('refunded');
    expect(refunded?.refundedAmount).toBe(3000);
    expect(body.data.items[0].friend.displayName).toBe('山田太郎');
    // 要約は明細と同じ母集団で数える(集計と明細のつき合わせ用)
    expect(body.data.summary).toEqual({ refunded: 1, cancelled: 0, totalAmount: 8000, refundedAmount: 3000 });
  });

  test('帰属はfriends.ref_code(first-touch)を起点にし、注文は友だちIDで結ぶ', async () => {
    const records: RecordedQuery[] = [];
    await app().request('/api/analytics/ref/campaign-a/orders', {}, { DB: database(records) });

    const orderQueries = records.filter((r) => r.sql.includes('FROM ec_orders o'));
    expect(orderQueries.length).toBeGreaterThan(0);
    for (const q of orderQueries) {
      expect(q.sql).toContain('JOIN friends f ON f.id = o.friend_id');
      expect(q.sql).toContain('f.ref_code = ?');
      // 二重計上防止: 一意キー(取り込み元×注文番号)で潰れているので
      // 明細・集計とも再グルーピングしない
      expect(q.sql).not.toContain('GROUP BY');
    }
  });

  test('経路未登録・帰属注文なしでも404にせず空の明細を返す(未計測≠0件と分けられる)', async () => {
    const records: RecordedQuery[] = [];
    const response = await app().request('/api/analytics/ref/unknown-ref/orders', {}, { DB: database(records) });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { items: unknown[]; total: number } };
    expect(body.data.total).toBe(0);
    expect(body.data.items).toHaveLength(0);
  });

  test('ページ指定はlimit/offsetに素通しし、上限50で丸める', async () => {
    const records: RecordedQuery[] = [];
    await app().request('/api/analytics/ref/campaign-a/orders?limit=200&offset=10', {}, { DB: database(records) });
    const itemsQuery = records.find((r) => r.sql.includes('LIMIT ? OFFSET ?'));
    expect(itemsQuery?.binds.slice(-2)).toEqual([50, 10]);
  });

  test('見えないアカウント指定は403で、どのクエリも走らない', async () => {
    const records: RecordedQuery[] = [];
    const response = await app().request(
      '/api/analytics/ref/campaign-a/orders?lineAccountId=account-hidden', {}, { DB: database(records) },
    );
    expect(response.status).toBe(403);
    expect(records).toHaveLength(0);
  });

  test('アカウント範囲は友だち側と同じ条件を注文側にも掛ける', async () => {
    const records: RecordedQuery[] = [];
    await app().request('/api/analytics/ref/campaign-a/orders', {}, { DB: database(records) });
    for (const q of records) {
      // スコープは友だち側(f.line_account_id)に掛かる。注文は帰属した
      // 友だちの所属に引きずられるので、友だちと同じ条件でよい。
      expect(q.sql).toContain('f.line_account_id');
      expect(q.binds).toContain('account-a');
    }
  });
});

describe('GET /api/analytics/ref-summary の注文計測ブロック (IDEA-18)', () => {
  test('計測範囲(全体・連携済み・経路判明)と経路別の購入・返金・取消を返す', async () => {
    const records: RecordedQuery[] = [];
    const response = await app().request('/api/analytics/ref-summary', {}, { DB: database(records) });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: {
        orders: { total: number; linked: number; attributed: number; refunded: number; cancelled: number };
        routes: Array<{ refCode: string; orderCount: number; refundedOrderCount: number; cancelledOrderCount: number }>;
      };
    };
    expect(body.data.orders).toEqual({ total: 10, linked: 7, attributed: 4, refunded: 1, cancelled: 1 });
    const route = body.data.routes.find((r) => r.refCode === 'campaign-a');
    expect(route?.orderCount).toBe(2);
    expect(route?.refundedOrderCount).toBe(1);
    expect(route?.cancelledOrderCount).toBe(0);
  });

  test('未計測は0件の成果と区別できる: total>attributed を別欄で返す', async () => {
    const records: RecordedQuery[] = [];
    const response = await app().request('/api/analytics/ref-summary', {}, { DB: database(records) });
    const body = await response.json() as { data: { orders: { total: number; attributed: number } } };
    // 全体10件のうち経路が分かるのは4件。残り6件は「0件の成果」ではなく未計測。
    expect(body.data.orders.total).toBeGreaterThan(body.data.orders.attributed);
  });

  test('経路別の購入件数は注文側でも同じアカウント範囲(f2)で絞る', async () => {
    const records: RecordedQuery[] = [];
    await app().request('/api/analytics/ref-summary', {}, { DB: database(records) });
    const routeQuery = records.find((r) => r.sql.includes('LEFT JOIN entry_routes'));
    // 相関副問合せの友だち別名 f2 にも同じ範囲が掛かっているか
    expect(routeQuery?.sql).toContain('f2.line_account_id');
    // 注文の計測範囲クエリは注文自身の所属(o.line_account_id)で絞る
    const ordersQuery = records.find((r) => r.sql.includes('orders_total'));
    expect(ordersQuery?.sql).toContain('o.line_account_id');
  });
});
