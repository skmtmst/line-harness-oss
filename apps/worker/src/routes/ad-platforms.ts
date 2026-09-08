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
import type { AdConversionLog } from '@line-crm/db';
import { sendAdConversions } from '../services/ad-conversion.js';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { listLimit, listPage } from './list-pagination.js';

function serializeLog(log: AdConversionLog) {
  return {
    id: log.id,
    adPlatformId: log.ad_platform_id,
    friendId: log.friend_id,
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

// GET /api/ad-platforms - list all
adPlatforms.get('/api/ad-platforms', async (c) => {
  try {
    const items = await getAdPlatforms(c.env.DB);
    return c.json({
      success: true,
      data: items.map((p) => ({
        id: p.id,
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
      displayName?: string;
      config: Record<string, unknown>;
    }>();

    if (!body.name || !body.config) {
      return c.json({ success: false, error: 'name and config are required' }, 400);
    }

    const validNames = ['meta', 'x', 'google', 'tiktok'];
    if (!validNames.includes(body.name)) {
      return c.json({ success: false, error: `name must be one of: ${validNames.join(', ')}` }, 400);
    }

    const platform = await createAdPlatform(c.env.DB, {
      name: body.name,
      displayName: body.displayName,
      config: body.config,
    });

    return c.json({
      success: true,
      data: {
        id: platform.id,
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
    const body = await c.req.json<{
      name?: string;
      displayName?: string | null;
      config?: Record<string, unknown>;
      isActive?: boolean;
    }>();

    const platform = await updateAdPlatform(c.env.DB, id, body);
    if (!platform) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        id: platform.id,
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
    }>();

    if (!body.platform || !body.eventName) {
      return c.json({ success: false, error: 'platform and eventName are required' }, 400);
    }

    const platform = await getAdPlatformByName(c.env.DB, body.platform);
    if (!platform) {
      return c.json({ success: false, error: `Platform "${body.platform}" not found or inactive` }, 404);
    }

    if (body.friendId) {
      await sendAdConversions(c.env.DB, body.friendId, body.eventName);
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
    await deleteAdPlatform(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/ad-platforms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/ad-platforms/logs — conversion send logs across every platform
adPlatforms.get('/api/ad-platforms/logs', async (c) => {
  try {
    const page = listPage(c.req.query('page'));
    const limit = listLimit(c.req.query('limit'), 50);
    const status = c.req.query('status')?.trim();
    const query = c.req.query('query')?.trim();
    const clauses: string[] = [];
    const bindings: unknown[] = [];

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
adPlatforms.get('/api/ad-platforms/:id/logs', async (c) => {
  try {
    const id = c.req.param('id');
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
