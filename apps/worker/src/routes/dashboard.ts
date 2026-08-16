import { Hono } from 'hono';
import {
  getDashboardOverview,
  type DashboardPeriod,
  type DashboardOverview,
} from '@line-crm/db';
import type { Env } from '../index.js';

/**
 * ダッシュボードが1回で読む数。
 *
 * 設計（Pen.dev `V2 1-1 ダッシュボード`）は1画面に10か所以上の数を出す。
 * カードごとに叩くと往復が増えるうえ、数の基準時刻がカード間でずれる。
 * 「有効友だちは今朝の値、未対応は今の値」という画面は読み違えのもとなので、
 * まとめて1回で返す。
 */
export const dashboard = new Hono<Env>();

const PERIODS: DashboardPeriod[] = ['today', 'last7', 'last28'];

function readPeriod(raw: string | undefined): DashboardPeriod {
  return PERIODS.includes(raw as DashboardPeriod) ? (raw as DashboardPeriod) : 'today';
}

/**
 * 今月の送信枠を LINE から取る。
 *
 * 取れなくても画面は出したいので、失敗は null にして握りつぶす。
 * ここで落とすと、LINE 側の一時的な不調で管理画面全体が開かなくなる。
 */
async function fetchQuota(
  token: string | undefined,
): Promise<{ limit: number | null; used: number | null }> {
  if (!token) return { limit: null, used: null };
  try {
    const [quota, consumption] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch('https://api.line.me/v2/bot/message/quota/consumption', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);
    if (!quota.ok || !consumption.ok) return { limit: null, used: null };
    // type が 'none' のときは上限なし。数字が入らないので null のままにする。
    const q = (await quota.json()) as { type?: string; value?: number };
    const c = (await consumption.json()) as { totalUsage?: number };
    return {
      limit: q.type === 'limited' && typeof q.value === 'number' ? q.value : null,
      used: typeof c.totalUsage === 'number' ? c.totalUsage : null,
    };
  } catch {
    return { limit: null, used: null };
  }
}

dashboard.get('/api/dashboard/overview', async (c) => {
  try {
    const period = readPeriod(c.req.query('period'));
    const accountId = c.req.query('accountId') ?? null;

    const overview: DashboardOverview = await getDashboardOverview(c.env.DB, period, accountId);
    const quota = await fetchQuota(c.env.LINE_CHANNEL_ACCESS_TOKEN);

    return c.json({
      success: true as const,
      data: {
        ...overview,
        delivery: { ...overview.delivery, quotaLimit: quota.limit, quotaUsed: quota.used },
      },
    });
  } catch (err) {
    console.error('GET /api/dashboard/overview error:', err);
    return c.json({ success: false as const, error: 'ダッシュボードの数を取得できませんでした' }, 500);
  }
});
