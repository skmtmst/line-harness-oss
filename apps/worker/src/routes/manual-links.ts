import { Hono, type Context } from 'hono';
import {
  countBroken,
  getManualLink,
  listManualLinks,
  ManualLinkVersionConflictError,
  recordCheck,
  upsertManualLink,
} from '@line-crm/db';
import type { Env } from '../index.js';

/**
 * マニュアルの正本表。設計 ★V6 34-4（`f9oUm`）。台帳 #134。
 *
 * **直せるのは運営（owner）だけ。** お客さまの組織ごとには変えない
 * （要件 v6-34 §8-2）。
 */
const manualLinks = new Hono<Env>();
type AppContext = Context<Env>;

function canOperate(c: AppContext): boolean {
  const staff = c.get('staff');
  return staff?.id === 'env-owner' || staff?.permissionKeys?.includes('manual.link.edit') === true;
}

function forbidden(c: AppContext) {
  return c.json({ success: false, error: 'この操作には運営権限が必要です', code: 'FORBIDDEN' }, 403);
}

function serialize(row: Awaited<ReturnType<typeof getManualLink>>) {
  if (!row) return null;
  return {
    key: row.key,
    keyKind: row.key_kind,
    name: row.name,
    url: row.url,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    lastHttpStatus: row.last_http_status,
    lastError: row.last_error,
    version: row.version,
  };
}

function isSafePublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
    if (
      host === 'localhost'
      || host.endsWith('.localhost')
      || host.endsWith('.local')
      || host.endsWith('.internal')
      || /^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host)
    ) return false;
    const ipv4 = host.split('.').map(Number);
    if (ipv4.length === 4 && ipv4.every(Number.isInteger)) {
      if (ipv4[0] === 172 && ipv4[1]! >= 16 && ipv4[1]! <= 31) return false;
      if (ipv4[0] === 100 && ipv4[1]! >= 64 && ipv4[1]! <= 127) return false;
    }
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function lookup(c: AppContext, key: string | undefined) {
  if (!key) return c.json({ success: false, error: 'screen が要ります', code: 'INVALID_INPUT' }, 400);
  const row = await getManualLink(c.env.DB, key);
  const screenRow = row?.key_kind === 'screen' ? row : null;
  return c.json({
    success: true,
    data: {
      key,
      url: screenRow?.status === 'ok' ? screenRow.url : null,
      status: screenRow?.status ?? 'unset',
      version: screenRow?.version ?? null,
    },
  });
}

/**
 * 画面から URL を1つ引く。**開けないと分かっているリンクは返さない。**
 * 返すと、押しても何も出ないボタンが画面に出る。
 */
manualLinks.get('/api/manual-links/lookup', async (c) => {
  try {
    return lookup(c, c.req.query('screen') ?? c.req.query('key'));
  } catch (err) {
    console.error('GET /api/manual-links/lookup error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** `screen` があれば画面用1件、無ければ運営用の正本表。 */
manualLinks.get('/api/manual-links', async (c) => {
  try {
    const screen = c.req.query('screen');
    if (screen !== undefined) return lookup(c, screen);
    if (!canOperate(c)) return forbidden(c);
    const rows = await listManualLinks(c.env.DB);
    return c.json({
      success: true,
      data: {
        items: rows.map((row) => serialize(row)),
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

type UpdateBody = {
  key?: string;
  name?: string;
  url?: string | null;
  keyKind?: 'screen' | 'task';
  expectedVersion?: number;
};

async function update(c: AppContext, pathKey?: string) {
  try {
    if (!canOperate(c)) return forbidden(c);
    const body = await c.req.json<UpdateBody>();
    const key = pathKey ?? body.key;
    if (!key || !/^[A-Za-z0-9_-]{1,80}$/.test(key)) {
      return c.json({ success: false, error: '画面IDまたは作業IDを確認してください', code: 'INVALID_INPUT' }, 400);
    }
    if (!Number.isInteger(body.expectedVersion) || body.expectedVersion! < 0) {
      return c.json({ success: false, error: 'expectedVersion が要ります', code: 'INVALID_INPUT' }, 400);
    }
    const existing = await getManualLink(c.env.DB, key);
    const name = body.name ?? existing?.name;
    if (!name) return c.json({ success: false, error: '画面名が要ります' }, 400);
    const keyKind = body.keyKind ?? existing?.key_kind ?? 'screen';
    if (body.url !== undefined && body.url !== null && body.url !== '') {
      if (!isSafePublicHttpsUrl(body.url)) {
        return c.json({
          success: false,
          error: '公開された安全な https URL を指定してください',
          code: 'UNSAFE_URL',
        }, 422);
      }
    }
    const row = await upsertManualLink(c.env.DB, {
      key,
      keyKind,
      name,
      url: body.url ?? existing?.url ?? null,
      expectedVersion: body.expectedVersion!,
      updatedBy: c.get('staff')?.id ?? null,
    });
    return c.json({ success: true, data: serialize(row) });
  } catch (err) {
    if (err instanceof ManualLinkVersionConflictError) {
      return c.json({
        success: false,
        error: '別の人が先に変更しました。最新の内容を確認してください。',
        code: 'VERSION_CONFLICT',
      }, 409);
    }
    console.error('PUT /api/manual-links/:key error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
}

manualLinks.put('/api/manual-links', (c) => update(c));
manualLinks.put('/api/manual-links/:key', (c) => update(c, c.req.param('key')));

/**
 * いま全部を確かめる。
 *
 * **開けたかどうかを、確かめて初めて言う。** URL が入っているだけでは
 * 「開けます」と書かない。読めなかったものは `broken` にして手がかりを残す。
 */
manualLinks.post('/api/manual-links/check', async (c) => {
  try {
    if (!canOperate(c)) return forbidden(c);
    const rows = await listManualLinks(c.env.DB);
    const targets = rows.filter((row) => row.url && isSafePublicHttpsUrl(row.url));
    let ok = 0;
    let broken = 0;
    for (const row of targets) {
      try {
        const res = await fetch(row.url!, {
          method: 'HEAD',
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          await recordCheck(c.env.DB, row.key, {
            ok: true,
            httpStatus: res.status,
            checkedBy: c.get('staff')?.id ?? null,
          });
          ok += 1;
        } else {
          await recordCheck(c.env.DB, row.key, {
            ok: false,
            httpStatus: res.status,
            errorCode: `HTTP_${res.status}`,
            checkedBy: c.get('staff')?.id ?? null,
          });
          broken += 1;
        }
      } catch {
        await recordCheck(c.env.DB, row.key, {
          ok: false,
          errorCode: 'NETWORK_ERROR',
          checkedBy: c.get('staff')?.id ?? null,
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
        unset: rows.filter((row) => !row.url).length,
        unsafe: rows.length - targets.length - rows.filter((row) => !row.url).length,
      },
    });
  } catch (err) {
    console.error('POST /api/manual-links/check error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { manualLinks };
