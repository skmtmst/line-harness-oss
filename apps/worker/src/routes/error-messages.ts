import { Hono } from 'hono';
import { listErrorMessages } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';

/**
 * エラー文面の対応表。設計 ★V6 34（要件 v6-34 §9）。台帳 #134。
 *
 * **画面は起動時に一度取って版ごとキャッシュする**（§12）。
 * 表に無いコードは画面側で汎用文面と追跡番号に落とす——
 * ここでは表をそのまま返すだけで、判定は持たない。
 */
const errorMessages = new Hono<Env>();

errorMessages.get('/api/error-messages', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const rows = await listErrorMessages(c.env.DB);
    return c.json({
      success: true,
      data: rows.map((row) => ({
        code: row.code,
        message: row.message,
        nextAction: {
          kind: row.next_action_kind,
          target: row.next_action_target,
        },
        source: row.source,
        version: row.version,
      })),
    });
  } catch (err) {
    console.error('GET /api/error-messages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { errorMessages };
