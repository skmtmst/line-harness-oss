import { Hono } from 'hono';
import {
  getDashboardOverview,
  getDashboardDefaultPreference,
  getDashboardPreference,
  getListStats,
  getLineAccountById,
  deleteDashboardPreference,
  saveDashboardDefaultPreference,
  saveDashboardPreference,
  type DashboardPeriod,
  type DashboardOverview,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { requireRole } from '../middleware/role-guard.js';
import { auditLog } from '../lib/audit-log.js';

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

const DASHBOARD_CARD_GROUPS = {
  today: new Set(['today-inbox', 'today-photo-review', 'today-bookings', 'today-shipments']),
  main: new Set(['shipment', 'pending-inbox', 'friend-trend', 'friend-add', 'scenario-status', 'uid-migration']),
  right: new Set([
    'send-quota', 'operational-alerts', 'connection-status', 'friend-status', 'upcoming',
    'monthly-delivery', 'recent-results', 'booking-status', 'inflow-top', 'funnel-alert',
    'automation-failures',
  ]),
} as const;

type DashboardCards = Record<keyof typeof DASHBOARD_CARD_GROUPS, Array<{ id: string; visible: boolean }>>;

function readAccountId(c: { req: { query(name: string): string | undefined } }): string | null {
  return c.req.query('account_id') ?? c.req.query('accountId') ?? null;
}

function readDashboardCards(value: unknown): DashboardCards | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const out = {} as DashboardCards;
  for (const group of Object.keys(DASHBOARD_CARD_GROUPS) as Array<keyof typeof DASHBOARD_CARD_GROUPS>) {
    const input = record[group];
    if (!Array.isArray(input)) return null;
    const seen = new Set<string>();
    const items: Array<{ id: string; visible: boolean }> = [];
    for (const candidate of input) {
      if (!candidate || typeof candidate !== 'object') return null;
      const item = candidate as { id?: unknown; visible?: unknown };
      if (typeof item.id !== 'string' || !DASHBOARD_CARD_GROUPS[group].has(item.id)) return null;
      if (typeof item.visible !== 'boolean' || seen.has(item.id)) return null;
      seen.add(item.id);
      items.push({ id: item.id, visible: item.visible });
    }
    if (group === 'today' && items.filter((item) => item.visible).length > 4) return null;
    out[group] = items;
  }
  return out;
}

function parseStoredCards(cards: string): DashboardCards | null {
  try { return readDashboardCards(JSON.parse(cards)); } catch { return null; }
}

async function requireVisibleAccount(c: {
  req: { query(name: string): string | undefined };
  env: Env['Bindings'];
  get(name: 'staff'): Env['Variables']['staff'];
}): Promise<{ accountId: string } | { response: Response }> {
  const accountId = readAccountId(c);
  if (!accountId) {
    return { response: Response.json({ success: false, error: 'LINEアカウントを選択してください' }, { status: 400 }) };
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return { response: Response.json({ success: false, error: 'LINE account not found' }, { status: 404 }) };
  }
  return { accountId };
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
    const access = await requireVisibleAccount(c);
    if ('response' in access) return access.response;
    const { accountId } = access;
    const selectedAccount = await getLineAccountById(c.env.DB, accountId);
    if (!selectedAccount) {
      return c.json({ success: false as const, error: 'LINE account not found' }, 404);
    }

    const statsScope = { allowedAccountIds: [accountId], includeUnassigned: false };
    const overview: DashboardOverview = await getDashboardOverview(c.env.DB, period, statsScope);
    const quotaToken = selectedAccount.channel_access_token;
    const quota = await fetchQuota(quotaToken);
    if (quota.failed) {
      overview.partialFailures.push('quota');
    }
    overview.sections.quota.status = quota.failed ? 'unavailable' : 'ok';

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

/** Explicit owner-only tenant overview for operational monitoring. */
dashboard.get('/api/dashboard/organization-overview', requireRole('owner'), async (c) => {
  try {
    const period = readPeriod(c.req.query('period'));
    const visibleScope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const overview = await getDashboardOverview(c.env.DB, period, {
      allowedAccountIds: visibleScope.allowedAccountIds,
      includeUnassigned: false,
    });
    const quotas = await Promise.all(visibleScope.accounts.map((account) => fetchQuota(account.channel_access_token)));
    const quotaFailed = quotas.some((quota) => quota.failed);
    if (quotaFailed) {
      overview.partialFailures.push('quota');
    }
    overview.sections.quota.status = quotaFailed ? 'unavailable' : 'ok';
    const everyLimitKnown = quotas.length > 0 && quotas.every((quota) => quota.limit !== null);
    const everyUsageKnown = quotas.length > 0 && quotas.every((quota) => quota.used !== null);
    return c.json({
      success: true as const,
      data: {
        ...overview,
        delivery: {
          ...overview.delivery,
          quotaLimit: everyLimitKnown ? quotas.reduce((sum, quota) => sum + (quota.limit ?? 0), 0) : null,
          quotaUsed: everyUsageKnown ? quotas.reduce((sum, quota) => sum + (quota.used ?? 0), 0) : null,
        },
      },
    });
  } catch (err) {
    console.error('GET /api/dashboard/organization-overview error:', err);
    return c.json({ success: false as const, error: '全体の運用数を取得できませんでした' }, 500);
  }
});

dashboard.get('/api/dashboard/preferences', async (c) => {
  try {
    const access = await requireVisibleAccount(c);
    if ('response' in access) return access.response;
    const staff = c.get('staff');
    const personal = await getDashboardPreference(c.env.DB, staff.id, access.accountId);
    if (personal) {
      const cards = parseStoredCards(personal.cards);
      if (!cards) throw new Error('invalid stored dashboard preference');
      return c.json({ success: true as const, data: { source: 'personal' as const, version: personal.version, cards, updatedAt: personal.updated_at } });
    }
    const defaults = await getDashboardDefaultPreference(c.env.DB, access.accountId);
    if (defaults) {
      const cards = parseStoredCards(defaults.cards);
      if (!cards) throw new Error('invalid stored dashboard default preference');
      return c.json({ success: true as const, data: { source: 'account-default' as const, version: 0, cards, updatedAt: defaults.updated_at } });
    }
    return c.json({ success: true as const, data: { source: 'builtin' as const, version: 0, cards: null, updatedAt: null } });
  } catch (err) {
    console.error('GET /api/dashboard/preferences error:', err);
    return c.json({ success: false as const, error: 'ダッシュボードの配置を取得できませんでした' }, 500);
  }
});

dashboard.put('/api/dashboard/preferences', async (c) => {
  try {
    const access = await requireVisibleAccount(c);
    if ('response' in access) return access.response;
    const body = await c.req.json<{ version?: unknown; cards?: unknown }>();
    const cards = readDashboardCards(body.cards);
    if (!Number.isInteger(body.version) || Number(body.version) < 0 || !cards) {
      return c.json({ success: false as const, error: '配置または版の指定が正しくありません' }, 400);
    }
    const saved = await saveDashboardPreference(c.env.DB, {
      staffId: c.get('staff').id,
      lineAccountId: access.accountId,
      expectedVersion: Number(body.version),
      cards,
    });
    if (saved.status === 'conflict') {
      return c.json({ success: false as const, error: '別の画面で配置が更新されました。再読み込みしてください', currentVersion: saved.current.version }, 409);
    }
    auditLog(c, 'dashboard.preference.update', { kind: 'line_account', id: access.accountId });
    return c.json({ success: true as const, data: { source: 'personal' as const, version: saved.row.version, cards, updatedAt: saved.row.updated_at } });
  } catch (err) {
    console.error('PUT /api/dashboard/preferences error:', err);
    return c.json({ success: false as const, error: 'ダッシュボードの配置を保存できませんでした' }, 500);
  }
});

dashboard.delete('/api/dashboard/preferences', async (c) => {
  try {
    const access = await requireVisibleAccount(c);
    if ('response' in access) return access.response;
    await deleteDashboardPreference(c.env.DB, c.get('staff').id, access.accountId);
    auditLog(c, 'dashboard.preference.reset', { kind: 'line_account', id: access.accountId });
    return c.json({ success: true as const, data: null });
  } catch (err) {
    console.error('DELETE /api/dashboard/preferences error:', err);
    return c.json({ success: false as const, error: 'ダッシュボードの配置を初期化できませんでした' }, 500);
  }
});

dashboard.put('/api/dashboard/preferences/default', requireRole('owner'), async (c) => {
  try {
    const access = await requireVisibleAccount(c);
    if ('response' in access) return access.response;
    const body = await c.req.json<{ cards?: unknown }>();
    const cards = readDashboardCards(body.cards);
    if (!cards) return c.json({ success: false as const, error: '配置の指定が正しくありません' }, 400);
    const saved = await saveDashboardDefaultPreference(c.env.DB, {
      lineAccountId: access.accountId,
      staffId: c.get('staff').id,
      cards,
    });
    auditLog(c, 'dashboard.preference.default.update', { kind: 'line_account', id: access.accountId });
    return c.json({ success: true as const, data: { version: saved.version, cards, updatedAt: saved.updated_at } });
  } catch (err) {
    console.error('PUT /api/dashboard/preferences/default error:', err);
    return c.json({ success: false as const, error: '会社の既定配置を保存できませんでした' }, 500);
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
    const selectedAccountId = readAccountId(c);
    if (selectedAccountId && !accountScope.allowedAccountIds.includes(selectedAccountId)) {
      return c.json({ success: false as const, error: 'LINE account not found' }, 404);
    }
    const scope = selectedAccountId
      ? { allowedAccountIds: [selectedAccountId], includeUnassigned: false }
      : {
          allowedAccountIds: accountScope.allowedAccountIds,
          includeUnassigned: accountScope.canSeeUnassigned,
        };
    return c.json({ success: true as const, data: await getListStats(c.env.DB, scope) });
  } catch (err) {
    console.error('GET /api/list-stats error:', err);
    return c.json({ success: false as const, error: '集計を取得できませんでした' }, 500);
  }
});
