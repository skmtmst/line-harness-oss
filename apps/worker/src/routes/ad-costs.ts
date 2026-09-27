import { Hono, type Context } from 'hono';
import {
  getAdCostImportStatus,
  getAdCostSummary,
  getAdPlatforms,
  getAdPlatformById,
  isValidCostDay,
  normalizeCostCurrency,
  upsertAdCostEntry,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { importAdCostNow } from '../services/ad-cost-import.js';
import { auditLog } from '../lib/audit-log.js';

/**
 * 流入の広告費の台帳 (#818)。
 *
 * 費用は外部連携の暗号化された秘密で媒体から毎日取り込む分と、
 * 管理画面から手入力する分を同じ口で見せる。取り込めなかった日は
 * 行が無いだけなので、画面側は最終取込日時と一緒に「—」を出す。
 */
const adCosts = new Hono<Env>();

const DEFAULT_RANGE_DAYS = 30;

function jstDay(date: Date): string {
  return new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** accountId 省略時は可視アカウントが1つのときだけ補う。 */
async function resolveAccountId(
  c: Context<Env>,
  requested: string | undefined,
): Promise<string | Response> {
  if (requested) {
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [requested])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    return requested;
  }
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  return scope.allowedAccountIds.length === 1
    ? scope.allowedAccountIds[0]
    : c.json({ success: false, error: 'accountId required' }, 400);
}

// GET /api/ad-costs — 流入元ごとの費用と取込状況
adCosts.get('/api/ad-costs', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = await resolveAccountId(c, c.req.query('accountId')?.trim());
    if (typeof accountId !== 'string') return accountId;

    const today = new Date();
    const to = c.req.query('to') ?? jstDay(today);
    const from = c.req.query('from')
      ?? jstDay(new Date(today.getTime() - DEFAULT_RANGE_DAYS * 24 * 3600_000));
    if (!isValidCostDay(from) || !isValidCostDay(to)) {
      return c.json({ success: false, error: '期間は 2026-08-01 の形で指定してください' }, 400);
    }

    const [rows, platforms] = await Promise.all([
      getAdCostSummary(c.env.DB, { lineAccountId: accountId, from, to }),
      getAdPlatforms(c.env.DB),
    ]);
    const ownPlatforms = platforms.filter((p) => p.line_account_id === accountId && p.is_active === 1);
    const statusByPlatform = await getAdCostImportStatus(
      c.env.DB,
      ownPlatforms.map((p) => p.id),
    );

    return c.json({
      success: true,
      data: {
        rows: rows.map((row) => ({
          sourceLabel: row.sourceLabel,
          adPlatformId: row.adPlatformId,
          entryRouteId: row.entryRouteId,
          source: row.source,
          totals: row.totals,
          friendAdds: row.friendAdds,
          // 1人あたり = 費用 ÷ 友だち追加。人数が取れない・0人の行は null。
          costPerFriendMinor: row.friendAdds && row.friendAdds > 0 && row.totals.length === 1
            ? Math.round(row.totals[0].amountMinor / row.friendAdds)
            : null,
          lastImportedAt: row.lastImportedAt,
        })),
        platforms: ownPlatforms.map((p) => {
          const status = statusByPlatform.get(p.id);
          return {
            id: p.id,
            name: p.name,
            displayName: p.display_name,
            lastSuccessAt: status?.lastSuccessAt ?? null,
            lastRunStatus: status?.lastRunStatus ?? null,
            lastRunAt: status?.lastRunAt ?? null,
            lastError: status?.lastError ?? null,
          };
        }),
      },
    });
  } catch (err) {
    console.error('GET /api/ad-costs error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/ad-costs — 手入力の費用
//
// 媒体から取り込めない分(チラシ・看板など)を日ごとに足す。
// 同じ流入元・同じ日が来たら上書きになる。
adCosts.post('/api/ad-costs', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      lineAccountId?: unknown;
      sourceLabel?: unknown;
      entryRouteId?: unknown;
      day?: unknown;
      amountMinor?: unknown;
      currency?: unknown;
    }>();

    const accountId = await resolveAccountId(
      c,
      typeof body.lineAccountId === 'string' ? body.lineAccountId.trim() : undefined,
    );
    if (typeof accountId !== 'string') return accountId;

    const sourceLabel = typeof body.sourceLabel === 'string' ? body.sourceLabel.trim() : '';
    if (!sourceLabel || sourceLabel.length > 100) {
      return c.json({ success: false, error: '流入元の名前を100字以内で入れてください' }, 400);
    }
    if (!isValidCostDay(body.day)) {
      return c.json({ success: false, error: '日付は 2026-08-01 の形で指定してください' }, 400);
    }
    const amountMinor = Number(body.amountMinor);
    if (!Number.isInteger(amountMinor) || amountMinor < 0) {
      return c.json({ success: false, error: '費用は0以上の整数で入れてください' }, 400);
    }
    const currency = body.currency == null ? 'JPY' : normalizeCostCurrency(body.currency);
    if (!currency) {
      return c.json({ success: false, error: '通貨は JPY のような3文字のコードで指定してください' }, 400);
    }

    let entryRouteId: string | null = null;
    if (typeof body.entryRouteId === 'string' && body.entryRouteId) {
      const route = await c.env.DB
        .prepare('SELECT id FROM entry_routes WHERE id = ? AND line_account_id = ?')
        .bind(body.entryRouteId, accountId)
        .first<{ id: string }>();
      if (!route) {
        return c.json({ success: false, error: '指定した流入元が見つかりません' }, 404);
      }
      entryRouteId = route.id;
    }

    const entry = await upsertAdCostEntry(c.env.DB, {
      lineAccountId: accountId,
      entryRouteId,
      sourceLabel,
      day: body.day,
      amountMinor,
      currency,
      source: 'manual',
      createdBy: c.get('staff')?.id ?? null,
    });
    auditLog(c, 'ad_cost.manual_entry', { id: entry.id, kind: 'ad_cost' }, { lineAccountId: accountId });
    return c.json({ success: true, data: entry }, 201);
  } catch (err) {
    console.error('POST /api/ad-costs error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/ad-platforms/:id/cost-import — その連携の前日分をいま取り直す
adCosts.post('/api/ad-platforms/:id/cost-import', requireRole('owner', 'admin'), async (c) => {
  try {
    const platform = await getAdPlatformById(c.env.DB, c.req.param('id'));
    if (!platform || !platform.line_account_id
      || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [platform.line_account_id])) {
      return c.json({ success: false, error: '対象が見つかりません' }, 404);
    }
    // 媒体の数字は前日分までしか確定しないので、対象は常に「昨日(JST)」。
    const day = jstDay(new Date(Date.now() - 24 * 3600_000));
    const result = await importAdCostNow(c.env.DB, platform.id, {
      day,
      credentialKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
    });
    auditLog(c, 'ad_cost.import', { id: platform.id, kind: 'ad_platform' }, {
      result: result.status === 'failed' ? 'failed' : 'success',
      lineAccountId: platform.line_account_id,
    });
    if (result.status === 'failed') {
      return c.json({ success: false, error: `取り込めませんでした: ${result.error}` }, 502);
    }
    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('POST /api/ad-platforms/:id/cost-import error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { adCosts };
