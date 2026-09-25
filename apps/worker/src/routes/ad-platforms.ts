import { Hono } from 'hono';
import {
  AD_PLATFORM_SECRET_KEYS,
  getAdPlatforms,
  getAdPlatformById,
  getAdPlatformForVerify,
  createAdPlatform,
  updateAdPlatformCAS,
  deleteAdPlatformCAS,
  getAdConversionLogs,
  markAdPlatformVerified,
  resolveAdPlatformConfig,
  splitAdPlatformSecrets,
  encryptAdPlatformSecrets,
  validateAdPlatformConfig,
  decryptCredential,
  type AdPlatform,
  type AdPlatformWriteScope,
} from '@line-crm/db';
import type { AdConversionLog } from '@line-crm/db';
import { sendAdConversions } from '../services/ad-conversion.js';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { listLimit, listPage } from './list-pagination.js';

/**
 * 画面へ返す形。秘密の値は出さず、設定済みの鍵名だけ出す。
 * つながっている表示は、疎通確認が済んだ行だけにする。
 */
async function serializePlatform(p: AdPlatform, encryptionKey: string | undefined) {
  const { values, secretKeys } = await readDisplayConfig(p, encryptionKey);
  return {
    id: p.id,
    name: p.name,
    displayName: p.display_name,
    config: values,
    secretKeys,
    isActive: p.is_active === 1 && p.verified_at != null,
    verifiedAt: p.verified_at,
    lineAccountId: p.line_account_id,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

/** 平文の値はいつでも返せる。秘密の鍵名は復号できたときだけ分かる。 */
async function readDisplayConfig(
  p: AdPlatform,
  encryptionKey: string | undefined,
): Promise<{ values: Record<string, unknown>; secretKeys: string[] }> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(p.config) as Record<string, unknown>;
  } catch {
    return { values: {}, secretKeys: [] };
  }
  if (!p.config_encrypted) {
    // 旧行：秘密も平文で混ざっている。値は伏せて鍵名だけ返す。
    const values: Record<string, unknown> = {};
    const secretKeys: string[] = [];
    for (const [key, value] of Object.entries(parsed)) {
      if (AD_PLATFORM_SECRET_KEYS.has(key)) secretKeys.push(key);
      else values[key] = value;
    }
    return { values, secretKeys };
  }
  try {
    const secrets = JSON.parse(await decryptCredential(p.config_encrypted, encryptionKey));
    return { values: parsed, secretKeys: Object.keys(secrets) };
  } catch (err) {
    console.error('[ad-platforms] cannot decrypt platform secrets:', err);
    return { values: parsed, secretKeys: [] };
  }
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
    const key = c.env.LINE_CREDENTIAL_ENCRYPTION_KEY;
    return c.json({
      success: true,
      data: await Promise.all(visible.map((item) => serializePlatform(item, key))),
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

    // 決められていない設定キーは受け付けない。秘密は暗号化して別保管にする。
    const configError = validateAdPlatformConfig(body.name, body.config);
    if (configError) {
      return c.json({ success: false, error: configError }, 400);
    }
    const { publicConfig, secrets } = splitAdPlatformSecrets(body.config);
    let configEncrypted: string | null = null;
    if (Object.keys(secrets).length > 0) {
      try {
        configEncrypted = await encryptAdPlatformSecrets(secrets, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY);
      } catch {
        return c.json({ success: false, error: 'つなぐための鍵を安全に保存できませんでした' }, 503);
      }
    }

    try {
      // 作っただけでは「つながった」と出さない。疎通確認の後に有効化する。
      const platform = await createAdPlatform(c.env.DB, {
        name: body.name,
        displayName: body.displayName,
        config: publicConfig,
        configEncrypted,
        isActive: false,
        lineAccountId: body.lineAccountId,
      });
      return c.json(
        { success: true, data: await serializePlatform(platform, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY) },
        201,
      );
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

    // 疎通確認が済むまで有効化はできない。
    if (body.isActive === true && !existing.verified_at) {
      return c.json(
        { success: false, error: '接続確認（テスト送信）が済んでいません。先に接続確認をしてください' },
        422,
      );
    }

    // 設定の書き換え。秘密の指定がない鍵は今の値を残し、決められていない
    // キーは落とす（旧行の名残もここで直る）。秘密は暗号化し直す。
    let configInput: Record<string, unknown> | undefined;
    let configEncryptedInput: string | null | undefined;
    if (body.config !== undefined) {
      const targetName = body.name ?? existing.name;
      const configError = validateAdPlatformConfig(targetName, body.config);
      if (configError) {
        return c.json({ success: false, error: configError }, 400);
      }
      const stored = await resolveAdPlatformConfig(existing, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY);
      if (!stored && existing.config_encrypted) {
        return c.json({ success: false, error: '保存済みの設定を読み直せませんでした' }, 500);
      }
      const merged: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body.config)) {
        if (AD_PLATFORM_SECRET_KEYS.has(key) && (value === null || value === undefined)) continue;
        merged[key] = value;
      }
      for (const [key, value] of Object.entries(stored ?? {})) {
        if (AD_PLATFORM_SECRET_KEYS.has(key) && !(key in merged)) merged[key] = value;
      }
      const { publicConfig, secrets } = splitAdPlatformSecrets(merged);
      configInput = publicConfig;
      try {
        configEncryptedInput = await encryptAdPlatformSecrets(secrets, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY);
      } catch {
        return c.json({ success: false, error: 'つなぐための鍵を安全に保存できませんでした' }, 503);
      }
    }

    // 読み取り後の帰属変更に当たらないよう、認可済み所属を条件に含めて1文で書く。
    const writeScope = await adPlatformWriteScope(c.env.DB, c.get('staff'));
    try {
      const { applied, platform } = await updateAdPlatformCAS(c.env.DB, id, writeScope, {
        ...body,
        config: configInput,
        configEncrypted: configEncryptedInput,
      });
      if (!applied || !platform) {
        const current = await getAdPlatformById(c.env.DB, id);
        if (!current) {
          return c.json({ success: false, error: 'Not found' }, 404);
        }
        return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
      }
      return c.json({
        success: true,
        data: await serializePlatform(platform, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY),
      });
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
      lineAccountId?: string;
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
        return c.json({ success: false, error: `Platform "${body.platform}" not found` }, 404);
      }
      // 疎通確認のために、止まっている行も指名できる。
      const platform = await getAdPlatformForVerify(c.env.DB, body.platform, friend.line_account_id);
      if (!platform) {
        return c.json({ success: false, error: `Platform "${body.platform}" not found` }, 404);
      }
      if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [platform.line_account_id])) {
        return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
      }
      // 本物の管を通して1件送り、届いたことが分かった行だけ確認済みにする。
      const idempotencyKey = crypto.randomUUID();
      await sendAdConversions(c.env.DB, body.friendId, body.eventName, undefined, {
        platformId: platform.id,
        idempotencyKey,
        credentialKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
      });
      const outcome = await c.env.DB.prepare(
        `SELECT status, last_error FROM ad_conversion_outbox WHERE idempotency_key = ?`,
      ).bind(idempotencyKey).first<{ status: string; last_error: string | null }>();
      if (outcome?.status === 'sent') {
        await markAdPlatformVerified(c.env.DB, platform.id);
        return c.json({
          success: true,
          data: { verified: true, message: '接続確認ができました。このまま有効化できます' },
        });
      }
      return c.json({
        success: true,
        data: {
          verified: false,
          status: outcome?.status ?? 'unknown',
          message: '接続確認の送信ができませんでした。設定と送信枠を確かめてください',
          reason: outcome?.last_error ?? null,
        },
      });
    }

    // 友だち指定なしの確認でも所属なしでは探さない。同名の設定が複数所属に
    // あるときの取り違えと、認可対象・実送信対象のずれを防ぐため。
    const lineAccountId = body.lineAccountId?.trim();
    if (!lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    const platform = await getAdPlatformForVerify(c.env.DB, body.platform, lineAccountId);
    if (!platform) {
      return c.json({ success: false, error: `Platform "${body.platform}" not found` }, 404);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [platform.line_account_id])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }

    return c.json({
      success: true,
      data: {
        message: `Platform "${body.platform}" is configured. Provide friendId to send a test conversion.`,
        verified: platform.verified_at != null,
        isActive: platform.is_active === 1 && platform.verified_at != null,
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
