import { Hono } from 'hono';
import {
  getDashboardOverview,
  getListStats,
  getLineAccountById,
  getLineAccounts,
  type DashboardPeriod,
  type DashboardOverview,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { canAccessLineAccount, getVisibleLineAccountScope } from '../services/account-access.js';

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
): Promise<{ limit: number | null; used: number | null; failed: boolean }> {
  if (!token) return { limit: null, used: null, failed: false };
  try {
    const [quota, consumption] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      }),
      fetch('https://api.line.me/v2/bot/message/quota/consumption', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      }),
    ]);
    if (!quota.ok || !consumption.ok) return { limit: null, used: null, failed: true };
    // type が 'none' のときは上限なし。数字が入らないので null のままにする。
    const q = (await quota.json()) as { type?: string; value?: number };
    const c = (await consumption.json()) as { totalUsage?: number };
    return {
      limit: q.type === 'limited' && typeof q.value === 'number' ? q.value : null,
      used: typeof c.totalUsage === 'number' ? c.totalUsage : null,
      failed: false,
    };
  } catch {
    return { limit: null, used: null, failed: true };
  }
}

dashboard.get('/api/dashboard/overview', async (c) => {
  try {
    const period = readPeriod(c.req.query('period'));
    const accountId = c.req.query('accountId') ?? null;
    const staff = c.get('staff');
    const accounts = await getLineAccounts(c.env.DB);
    if (accountId && !canAccessLineAccount(accounts, staff, accountId)) {
      return c.json({ success: false as const, error: 'LINE account not found' }, 404);
    }
    const selectedAccount = accountId ? await getLineAccountById(c.env.DB, accountId) : null;
    if (accountId && !selectedAccount) {
      return c.json({ success: false as const, error: 'LINE account not found' }, 404);
    }

    const overview: DashboardOverview = await getDashboardOverview(c.env.DB, period, accountId);
    const quota = await fetchQuota(selectedAccount?.channel_access_token ?? c.env.LINE_CHANNEL_ACCESS_TOKEN);
    if (quota.failed) overview.partialFailures.push('quota');

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

/**
 * 一覧画面の上部に出す数（タグ・テンプレート・シナリオ・リマインダ）。
 *
 * 4画面ぶんをまとめて返す。画面ごとに叩くと同じ数え方が散らばって、
 * あとで定義がずれる。1回で返して、画面側が必要なところだけ読む。
 */
dashboard.get('/api/list-stats', async (c) => {
  try {
    const accountScope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    return c.json({ success: true as const, data: await getListStats(c.env.DB, {
      allowedAccountIds: accountScope.allowedAccountIds,
      includeUnassigned: accountScope.canSeeUnassigned,
    }) });
  } catch (err) {
    console.error('GET /api/list-stats error:', err);
    return c.json({ success: false as const, error: '集計を取得できませんでした' }, 500);
  }
});
