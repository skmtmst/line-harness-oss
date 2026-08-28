import { Hono } from 'hono';
import {
  getAdPlatforms,
  getAdPlatformById,
  createAdPlatform,
  updateAdPlatform,
  deleteAdPlatform,
  getAdConversionLogs,
  getAdPlatformByName,
} from '@line-crm/db';
import { sendAdConversions } from '../services/ad-conversion.js';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';

export function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (/(?:token|secret|api_key|developer_key|password)/i.test(key)) {
      masked[key] = value ? '設定済み' : '';
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

const adPlatforms = new Hono<Env>();

// GET /api/ad-platforms - list all
adPlatforms.get('/api/ad-platforms', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
    const items = await getAdPlatforms(c.env.DB, lineAccountId);
    return c.json({
      success: true,
      data: items.map((p) => ({
        id: p.id,
        lineAccountId: p.line_account_id,
        name: p.name,
        displayName: p.display_name,
        config: maskConfig(JSON.parse(p.config)),
        isActive: !!p.is_active,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
    });
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
      lineAccountId: string;
      displayName?: string;
      config: Record<string, unknown>;
    }>();

    if (!body.name || !body.lineAccountId || !body.config) {
      return c.json({ success: false, error: 'lineAccountId, name and config are required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId])) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }

    const validNames = ['meta', 'x', 'google', 'tiktok'];
    if (!validNames.includes(body.name)) {
      return c.json({ success: false, error: `name must be one of: ${validNames.join(', ')}` }, 400);
    }

    const platform = await createAdPlatform(c.env.DB, {
      name: body.name,
      lineAccountId: body.lineAccountId,
      displayName: body.displayName,
      config: body.config,
    });

    return c.json({
      success: true,
      data: {
        id: platform.id,
        lineAccountId: platform.line_account_id,
        name: platform.name,
        displayName: platform.display_name,
        config: maskConfig(JSON.parse(platform.config)),
        isActive: !!platform.is_active,
        createdAt: platform.created_at,
        updatedAt: platform.updated_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/ad-platforms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/ad-platforms/:id - update
adPlatforms.put('/api/ad-platforms/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
    const body = await c.req.json<{
      name?: string;
      displayName?: string | null;
      config?: Record<string, unknown>;
      isActive?: boolean;
    }>();

    const platform = await updateAdPlatform(c.env.DB, id, lineAccountId, body);
    if (!platform) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        id: platform.id,
        lineAccountId: platform.line_account_id,
        name: platform.name,
        displayName: platform.display_name,
        config: maskConfig(JSON.parse(platform.config)),
        isActive: !!platform.is_active,
        createdAt: platform.created_at,
        updatedAt: platform.updated_at,
      },
    });
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
      lineAccountId: string;
    }>();

    if (!body.platform || !body.eventName || !body.lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId, platform and eventName are required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId])) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }

    const platform = await getAdPlatformByName(c.env.DB, body.platform, body.lineAccountId);
    if (!platform) {
      return c.json({ success: false, error: `Platform "${body.platform}" not found or inactive` }, 404);
    }

    if (body.friendId) {
      const friend = await c.env.DB
        .prepare(`SELECT id FROM friends WHERE id = ? AND line_account_id = ?`)
        .bind(body.friendId, body.lineAccountId)
        .first<{ id: string }>();
      if (!friend) {
        return c.json({ success: false, error: 'Friend not found' }, 404);
      }
      await sendAdConversions(c.env.DB, body.friendId, body.eventName, undefined, body.lineAccountId);
      return c.json({ success: true, data: { message: 'Test conversion sent via full pipeline' } });
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
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
    const existing = await getAdPlatformById(c.env.DB, c.req.param('id'), lineAccountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    await deleteAdPlatform(c.env.DB, c.req.param('id'), lineAccountId);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/ad-platforms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/ad-platforms/:id/logs - conversion send logs
adPlatforms.get('/api/ad-platforms/:id/logs', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const id = c.req.param('id');
    const lineAccountId = c.req.query('lineAccountId')?.trim();
    if (!lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'Forbidden' }, 403);
    }
    const platform = await getAdPlatformById(c.env.DB, id, lineAccountId);
    if (!platform) return c.json({ success: false, error: 'Not found' }, 404);
    const limit = Number(c.req.query('limit') ?? '50');
    const logs = await getAdConversionLogs(c.env.DB, id, lineAccountId, limit);

    return c.json({
      success: true,
      data: logs.map((l) => ({
        id: l.id,
        lineAccountId: l.line_account_id,
        adPlatformId: l.ad_platform_id,
        friendId: l.friend_id,
        eventName: l.event_name,
        clickId: l.click_id,
        clickIdType: l.click_id_type,
        status: l.status,
        attemptCount: l.attempt_count,
        nextRetryAt: l.next_retry_at,
        errorMessage: l.error_message,
        createdAt: l.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/ad-platforms/:id/logs error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { adPlatforms };
