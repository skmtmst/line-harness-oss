import { Hono } from 'hono';
import {
  getAdPlatforms,
  getAdPlatformById,
  createAdPlatform,
  updateAdPlatformCAS,
  deleteAdPlatformCAS,
  getAdConversionLogs,
  getAdPlatformByName,
  type AdPlatformWriteScope,
} from '@line-crm/db';
import type { AdConversionLog } from '@line-crm/db';
import { sendAdConversions } from '../services/ad-conversion.js';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { listLimit, listPage } from './list-pagination.js';

function serializePlatform(p: { id: string; name: string; display_name: string | null; config: string; is_active: number; line_account_id: string | null; created_at: string; updated_at: string }) {
  return {
    id: p.id,
    name: p.name,
    displayName: p.display_name,
    config: maskConfig(JSON.parse(p.config)),
    isActive: !!p.is_active,
    lineAccountId: p.line_account_id,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

function serializeLog(log: AdConversionLog) {
  return {
    id: log.id,
    adPlatformId: log.ad_platform_id,
    friendId: log.friend_id,
    lineAccountId: log.line_account_id,
    eventName: log.event_name,
    clickId: log.click_id,
    clickIdType: log.click_id_type,
    status: log.status,
    errorMessage: log.error_message,
    createdAt: log.created_at,
  };
}

function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && value.length > 8) {
      masked[key] = value.slice(0, 4) + '****' + value.slice(-4);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

const adPlatforms = new Hono<Env>();

// GET /api/ad-platforms - list visible accounts only
adPlatforms.get('/api/ad-platforms', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (lineAccountId && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const scope = lineAccountId ? null : await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const items = await getAdPlatforms(c.env.DB);
    const visible = items.filter((p) => lineAccountId
      ? p.line_account_id === lineAccountId
      : scope!.allowedAccountIds.includes(p.line_account_id ?? '')
        || (p.line_account_id == null && scope!.canSeeUnassigned));
    return c.json({ success: true, data: visible.map(serializePlatform) });
  } catch (err) {
    console.error('GET /api/ad-platforms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/ad-platforms - create
adPlatforms.post('/api/ad-platforms', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      displayName?: string;
      config: Record<string, unknown>;
      lineAccountId?: string;
    }>();

    if (!body.name || !body.config) {
      return c.json({ success: false, error: 'name and config are required' }, 400);
    }
    // 帰属のない設定は送信対象にならないため、作成時に必須にする。
    if (!body.lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }

    const validNames = ['meta', 'x', 'google', 'tiktok'];
    if (!validNames.includes(body.name)) {
      return c.json({ success: false, error: `name must be one of: ${validNames.join(', ')}` }, 400);
    }

    try {
      const platform = await createAdPlatform(c.env.DB, {
        name: body.name,
        displayName: body.displayName,
        config: body.config,
        lineAccountId: body.lineAccountId,
      });
      return c.json({ success: true, data: serializePlatform(platform) }, 201);
    } catch (err) {
      // 同一アカウント・同一媒体の重複は409で返す。
      if (err instanceof Error && /unique/i.test(`${err.name} ${err.message}`)) {
        return c.json({ success: false, error: '同じLINEアカウントに同じ媒体の設定が既にあります' }, 409);
      }
      throw err;
    }
  } catch (err) {
    console.error('POST /api/ad-platforms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** 呼び出しの認可済み所属を、書き込み1文の条件にする。 */
async function adPlatformWriteScope(
  db: D1Database,
  staff: Parameters<typeof getVisibleLineAccountScope>[1],
): Promise<AdPlatformWriteScope> {
  const scope = await getVisibleLineAccountScope(db, staff);
  return { accountIds: scope.allowedAccountIds, includeUnassigned: scope.canSeeUnassigned };
}

// PUT /api/ad-platforms/:id - update
adPlatforms.put('/api/ad-platforms/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      displayName?: string | null;
      config?: Record<string, unknown>;
      isActive?: boolean;
      lineAccountId?: string | null;
    }>();

    // 帰属を空に戻す変更は受け付けない。
    if (body.lineAccountId !== undefined && !body.lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    const existing = await getAdPlatformById(c.env.DB, id);
    if (!existing) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [existing.line_account_id])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    if (body.lineAccountId !== undefined
      && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }

    // 読み取り後の帰属変更に当たらないよう、認可済み所属を条件に含めて1文で書く。
    const writeScope = await adPlatformWriteScope(c.env.DB, c.get('staff'));
    try {
      const { applied, platform } = await updateAdPlatformCAS(c.env.DB, id, writeScope, body);
      if (!applied || !platform) {
        const current = await getAdPlatformById(c.env.DB, id);
        if (!current) {
          return c.json({ success: false, error: 'Not found' }, 404);
        }
        return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
      }
      return c.json({ success: true, data: serializePlatform(platform) });
    } catch (err) {
      if (err instanceof Error && /unique/i.test(`${err.name} ${err.message}`)) {
        return c.json({ success: false, error: '同じLINEアカウントに同じ媒体の設定が既にあります' }, 409);
      }
      throw err;
    }
  } catch (err) {
    console.error('PUT /api/ad-platforms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/ad-platforms/test - test conversion send (must be before :id routes)
adPlatforms.post('/api/ad-platforms/test', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{
      platform: string;
      eventName: string;
      friendId?: string;
    }>();

    if (!body.platform || !body.eventName) {
      return c.json({ success: false, error: 'platform and eventName are required' }, 400);
    }

    if (body.friendId) {
      // 友だちの所属が呼び出しに見える範囲か確かめてから、その所属の設定だけで送る。
      // 認可対象と実送信対象がずれないよう、設定も友だちの所属で選ぶ。
      const friend = await c.env.DB.prepare(`SELECT line_account_id FROM friends WHERE id = ?`)
        .bind(body.friendId)
        .first<{ line_account_id: string | null }>();
      if (!friend) {
        return c.json({ success: false, error: 'Friend not found' }, 404);
      }
      if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [friend.line_account_id])) {
        return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
      }
      if (!friend.line_account_id) {
        return c.json({ success: false, error: `Platform "${body.platform}" not found or inactive` }, 404);
      }
      const platform = await getAdPlatformByName(c.env.DB, body.platform, friend.line_account_id);
      if (!platform) {
        return c.json({ success: false, error: `Platform "${body.platform}" not found or inactive` }, 404);
      }
      if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [platform.line_account_id])) {
        return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
      }
      await sendAdConversions(c.env.DB, body.friendId, body.eventName, undefined, { platformId: platform.id });
      return c.json({ success: true, data: { message: 'Test conversion sent via full pipeline' } });
    }

    const platform = await getAdPlatformByName(c.env.DB, body.platform);
    if (!platform) {
      return c.json({ success: false, error: `Platform "${body.platform}" not found or inactive` }, 404);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [platform.line_account_id])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }

    return c.json({
      success: true,
      data: {
        message: `Platform "${body.platform}" is configured and active. Provide friendId to send a test conversion.`,
      },
    });
  } catch (err) {
    console.error('POST /api/ad-platforms/test error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/ad-platforms/:id - delete
adPlatforms.delete('/api/ad-platforms/:id', requireRole('owner'), async (c) => {
  try {
    const existing = await getAdPlatformById(c.env.DB, c.req.param('id'));
    if (!existing) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [existing.line_account_id])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    // 読み取り後の帰属変更に当たらないよう、認可済み所属を条件に含めて1文で消す。
    const writeScope = await adPlatformWriteScope(c.env.DB, c.get('staff'));
    const deleted = await deleteAdPlatformCAS(c.env.DB, c.req.param('id'), writeScope);
    if (!deleted) {
      const current = await getAdPlatformById(c.env.DB, c.req.param('id'));
      if (!current) {
        return c.json({ success: false, error: 'Not found' }, 404);
      }
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/ad-platforms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/ad-platforms/logs — conversion send logs across visible platforms
adPlatforms.get('/api/ad-platforms/logs', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const page = listPage(c.req.query('page'));
    const limit = listLimit(c.req.query('limit'), 50);
    const status = c.req.query('status')?.trim();
    const query = c.req.query('query')?.trim();
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (lineAccountId && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const scope = lineAccountId ? null : await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const clauses: string[] = [];
    const bindings: unknown[] = [];

    if (lineAccountId) {
      clauses.push('line_account_id = ?');
      bindings.push(lineAccountId);
    } else if (scope!.allowedAccountIds.length) {
      clauses.push(scope!.canSeeUnassigned
        ? `(line_account_id IN (${scope!.allowedAccountIds.map(() => '?').join(',')}) OR line_account_id IS NULL)`
        : `line_account_id IN (${scope!.allowedAccountIds.map(() => '?').join(',')})`);
      bindings.push(...scope!.allowedAccountIds);
    } else {
      clauses.push(scope!.canSeeUnassigned ? 'line_account_id IS NULL' : '1 = 0');
    }

    if (status && status !== 'all') {
      if (!['sent', 'pending', 'failed'].includes(status)) {
        return c.json({ success: false, error: 'status is invalid' }, 400);
      }
      if (status === 'sent') {
        clauses.push("status IN ('sent', 'success')");
      } else {
        clauses.push('status = ?');
        bindings.push(status);
      }
    }
    if (query) {
      clauses.push("(event_name LIKE ? ESCAPE '\\' OR COALESCE(click_id_type, '') LIKE ? ESCAPE '\\')");
      const escaped = query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
      bindings.push(`%${escaped}%`, `%${escaped}%`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const count = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total FROM ad_conversion_logs ${where}`,
    ).bind(...bindings).first<{ total: number }>();
    const logs = await c.env.DB.prepare(
      `SELECT * FROM ad_conversion_logs ${where}
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    ).bind(...bindings, limit, (page - 1) * limit).all<AdConversionLog>();

    return c.json({
      success: true,
      data: {
        items: logs.results.map(serializeLog),
        total: Number(count?.total ?? 0),
        page,
        limit,
        sort: [
          { field: 'createdAt', direction: 'desc' },
          { field: 'id', direction: 'desc' },
        ],
      },
    });
  } catch (err) {
    console.error('GET /api/ad-platforms/logs error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/ad-platforms/:id/logs - conversion send logs
adPlatforms.get('/api/ad-platforms/:id/logs', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const id = c.req.param('id');
    const platform = await getAdPlatformById(c.env.DB, id);
    if (!platform) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [platform.line_account_id])) {
      return c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403);
    }
    const limit = listLimit(c.req.query('limit'), 50);
    const logs = await getAdConversionLogs(c.env.DB, id, limit);

    return c.json({
      success: true,
      data: logs.map(serializeLog),
    });
  } catch (err) {
    console.error('GET /api/ad-platforms/:id/logs error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { adPlatforms };
