import { Hono } from 'hono';
import {
  countBroken,
  getManualLink,
  listManualLinks,
  recordCheck,
  upsertManualLink,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';

/**
 * マニュアルの正本表。設計 ★V6 34-4（`f9oUm`）。台帳 #134。
 *
 * **直せるのは運営（owner）だけ。** お客さまの組織ごとには変えない
 * （要件 v6-34 §8-2）。
 */
const manualLinks = new Hono<Env>();

/**
 * 画面から URL を1つ引く。**開けないと分かっているリンクは返さない。**
 * 返すと、押しても何も出ないボタンが画面に出る。
 */
manualLinks.get('/api/manual-links/lookup', async (c) => {
  try {
    const key = c.req.query('screen') ?? c.req.query('key');
    if (!key) return c.json({ success: false, error: 'screen が要ります' }, 400);
    const row = await getManualLink(c.env.DB, key);
    return c.json({
      success: true,
      data: {
        key,
        url: row && row.status === 'ok' ? row.url : null,
        status: row?.status ?? 'unset',
      },
    });
  } catch (err) {
    console.error('GET /api/manual-links/lookup error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** 正本表。運営だけが見られる。 */
manualLinks.get('/api/manual-links', requireRole('owner'), async (c) => {
  try {
    const rows = await listManualLinks(c.env.DB);
    return c.json({
      success: true,
      data: {
        items: rows.map((row) => ({
          key: row.key,
          keyKind: row.key_kind,
          name: row.name,
          url: row.url,
          status: row.status,
          lastCheckedAt: row.last_checked_at,
          lastError: row.last_error,
        })),
        total: rows.length,
        /** 開けないリンクの数。**0 件のときは画面で何も言わない。** */
        brokenCount: await countBroken(c.env.DB),
      },
    });
  } catch (err) {
    console.error('GET /api/manual-links error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

manualLinks.put('/api/manual-links/:key', requireRole('owner'), async (c) => {
  try {
    const key = c.req.param('key');
    const body = await c.req.json<{ name?: string; url?: string | null; keyKind?: 'screen' | 'task' }>();
    const existing = await getManualLink(c.env.DB, key);
    const name = body.name ?? existing?.name;
    if (!name) return c.json({ success: false, error: '画面名が要ります' }, 400);
    const keyKind = body.keyKind ?? existing?.key_kind ?? 'screen';
    if (body.url !== undefined && body.url !== null && body.url !== '') {
      try {
        const parsed = new URL(body.url);
        if (parsed.protocol !== 'https:') {
          return c.json({ success: false, error: 'URL は https で始めてください' }, 422);
        }
      } catch {
        return c.json({ success: false, error: 'URL の形を確認してください' }, 422);
      }
    }
    await upsertManualLink(c.env.DB, {
      key,
      keyKind,
      name,
      url: body.url ?? existing?.url ?? null,
      updatedBy: c.get('staff')?.id ?? null,
    });
    const row = await getManualLink(c.env.DB, key);
    return c.json({
      success: true,
      data: {
        key,
        keyKind: row?.key_kind,
        name: row?.name,
        url: row?.url,
        /*
          **URL を変えたら状態は unset に戻る。** 前の URL を確かめた結果が
          新しい URL にも当てはまるとは限らない。
        */
        status: row?.status,
        lastCheckedAt: row?.last_checked_at,
      },
    });
  } catch (err) {
    console.error('PUT /api/manual-links/:key error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * いま全部を確かめる。
 *
 * **開けたかどうかを、確かめて初めて言う。** URL が入っているだけでは
 * 「開けます」と書かない。読めなかったものは `broken` にして手がかりを残す。
 */
manualLinks.post('/api/manual-links/check', requireRole('owner'), async (c) => {
  try {
    const rows = await listManualLinks(c.env.DB);
    const targets = rows.filter((row) => row.url);
    let ok = 0;
    let broken = 0;
    for (const row of targets) {
      try {
        const res = await fetch(row.url!, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
        if (res.ok) {
          await recordCheck(c.env.DB, row.key, { ok: true });
          ok += 1;
        } else {
          await recordCheck(c.env.DB, row.key, { ok: false, error: `HTTP ${res.status}` });
          broken += 1;
        }
      } catch (err) {
        await recordCheck(c.env.DB, row.key, {
          ok: false,
          error: err instanceof Error ? err.message : '開けませんでした',
        });
        broken += 1;
      }
    }
    return c.json({
      success: true,
      data: {
        checked: targets.length,
        ok,
        broken,
        /** URL が決まっていないものは確かめようがない。**broken に混ぜない。** */
        unset: rows.length - targets.length,
      },
    });
  } catch (err) {
    console.error('POST /api/manual-links/check error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { manualLinks };
