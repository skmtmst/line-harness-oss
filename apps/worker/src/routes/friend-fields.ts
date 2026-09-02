import { Hono, type Context } from 'hono';
import {
  getFriendFields,
  getFriendFieldsForScope,
  getFriendFieldById,
  getFriendFieldByIdForScope,
  createFriendFieldForScope,
  updateFriendField,
  deleteFriendField,
  countFriendFieldValuesForScope,
  getFriendFieldListSummary,
  getFriendFieldValuesForMigration,
  getFriendFieldsWithValues,
  setFriendFieldValue,
  validateFieldKey,
  FRIEND_FIELD_TYPES,
  type FriendField,
  type FriendFieldScope,
  type FriendFieldType,
} from '@line-crm/db';
import { recordLoginAudit } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

const friendFields = new Hono<Env>();

function serialize(row: FriendField & { value?: string | null; updated_by?: string | null; is_inherited?: number }) {
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    fieldKey: row.field_key,
    type: row.type,
    options: row.options_json ? (JSON.parse(row.options_json) as unknown) : null,
    defaultValue: row.default_value,
    source: row.source,
    ecFieldPath: row.ec_field_path,
    ecIsMaster: Boolean(row.ec_is_master),
    isPersonal: Boolean(row.is_personal),
    isStarred: Boolean(row.is_starred),
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.is_inherited !== undefined ? { isInherited: Boolean(row.is_inherited) } : {}),
    ...(row.value !== undefined ? { value: row.value, updatedBy: row.updated_by ?? null } : {}),
  };
}

async function friendFieldAccess(c: Context<Env>): Promise<FriendFieldScope | Response> {
  const lineAccountId = c.req.query('lineAccountId');
  if (!lineAccountId) {
    return c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400);
  }
  const staff = c.get('staff');
  if (!staff.tenantId) {
    return c.json({ success: false, error: '所属を確認できません' }, 403);
  }
  const accountScope = await getVisibleLineAccountScope(c.env.DB, staff);
  if (!accountScope.allowedAccountIds.includes(lineAccountId)) {
    return c.json({ success: false, error: '友だち情報欄が見つかりません' }, 404);
  }
  return { tenantId: staff.tenantId, lineAccountId };
}

/** 選択肢は文字列の配列。空の配列も許す（あとから足す前提で作ることがある）。 */
function parseOptions(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  if (!Array.isArray(raw)) return { ok: false };
  if (raw.some((v) => typeof v !== 'string')) return { ok: false };
  return { ok: true, value: JSON.stringify(raw) };
}

type MigrationPreviewRow = {
  friendId: string;
  sourceValue: string;
  convertedValue: string | null;
  status: 'convertible' | 'review' | 'invalid';
  reason: string | null;
};

function convertMigrationValue(value: string, targetType: FriendFieldType): Omit<MigrationPreviewRow, 'friendId' | 'sourceValue'> {
  const trimmed = value.trim();
  if (!trimmed) return { convertedValue: null, status: 'invalid', reason: '空欄です' };
  if (targetType === 'number') {
    const normalized = trimmed.replace(/,/g, '');
    return Number.isFinite(Number(normalized))
      ? { convertedValue: normalized, status: 'convertible', reason: null }
      : { convertedValue: null, status: 'review', reason: '数値として確認できません' };
  }
  if (targetType === 'date') {
    const normalized = trimmed.replace(/[./年]/g, '-').replace(/月/g, '-').replace(/日/g, '');
    const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return { convertedValue: null, status: 'review', reason: '日付の形を確認してください' };
    const result = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    const date = new Date(`${result}T00:00:00Z`);
    const isExactDate = !Number.isNaN(date.getTime())
      && date.getUTCFullYear() === Number(match[1])
      && date.getUTCMonth() + 1 === Number(match[2])
      && date.getUTCDate() === Number(match[3]);
    return !isExactDate
      ? { convertedValue: null, status: 'review', reason: '存在する日付か確認してください' }
      : { convertedValue: result, status: 'convertible', reason: null };
  }
  if (targetType === 'tel') {
    const normalized = trimmed.replace(/[^0-9+]/g, '');
    return /^\+?\d{10,15}$/.test(normalized)
      ? { convertedValue: normalized, status: 'convertible', reason: null }
      : { convertedValue: null, status: 'review', reason: '電話番号の桁数を確認してください' };
  }
  if (targetType === 'email') {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
      ? { convertedValue: trimmed.toLowerCase(), status: 'convertible', reason: null }
      : { convertedValue: null, status: 'review', reason: 'メールアドレスの形を確認してください' };
  }
  if (targetType === 'url') {
    try {
      const parsed = new URL(trimmed);
      return ['http:', 'https:'].includes(parsed.protocol)
        ? { convertedValue: parsed.toString(), status: 'convertible', reason: null }
        : { convertedValue: null, status: 'review', reason: 'httpまたはhttpsのURLではありません' };
    } catch {
      return { convertedValue: null, status: 'review', reason: 'URLの形を確認してください' };
    }
  }
  if (targetType === 'checkbox') {
    const yes = new Set(['1', 'true', 'yes', 'on', 'はい']);
    const no = new Set(['0', 'false', 'no', 'off', 'いいえ']);
    const lowered = trimmed.toLowerCase();
    if (yes.has(lowered)) return { convertedValue: '1', status: 'convertible', reason: null };
    if (no.has(lowered)) return { convertedValue: '0', status: 'convertible', reason: null };
    return { convertedValue: null, status: 'review', reason: 'はい・いいえを確認してください' };
  }
  if (targetType === 'select' || targetType === 'multi_select') {
    return { convertedValue: trimmed, status: 'review', reason: '新しい選択肢との対応を確認してください' };
  }
  return { convertedValue: trimmed, status: 'convertible', reason: null };
}

// GET /api/friend-fields
friendFields.get('/api/friend-fields', async (c) => {
  try {
    const scope = await friendFieldAccess(c);
    if (scope instanceof Response) return scope;
    const folderId = c.req.query('folderId') || undefined;
    const items = await getFriendFieldsForScope(c.env.DB, scope, { folderId });

    // ?withUsage=1 で「何人に値が入っているか」を付ける。削除の前に見る画面用。
    // 項目ごとに1クエリなので、既定では引かない。
    if (c.req.query('withUsage') === '1') {
      const withUsage = [];
      for (const item of items) {
        withUsage.push({
          ...serialize(item),
          usageCount: await countFriendFieldValuesForScope(c.env.DB, item.id, scope),
        });
      }
      return c.json({ success: true, data: withUsage });
    }
    return c.json({ success: true, data: items.map(serialize) });
  } catch (err) {
    console.error('GET /api/friend-fields error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/friend-fields-stats
//
// 一覧上部の数を選択中アカウントだけで返す。フォーム定義はまだアカウント
// 所属を持たないため、その件数だけは null（未取得）として返す。
friendFields.get('/api/friend-fields-stats', async (c) => {
  try {
    const scope = await friendFieldAccess(c);
    if (scope instanceof Response) return scope;
    return c.json({ success: true, data: await getFriendFieldListSummary(c.env.DB, scope) });
  } catch (err) {
    console.error('GET /api/friend-fields-stats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/friend-fields/:id/migration-preview
//
// 値を1件も変更せず、変換可能・要確認・変換不可を返す。型の違う自由入力を
// 黙って捨てないため、確認が要る行は友だちIDと理由まで残す。
friendFields.post('/api/friend-fields/:id/migration-preview', requireRole('owner', 'admin'), async (c) => {
  try {
    const scope = await friendFieldAccess(c);
    if (scope instanceof Response) return scope;
    const source = await getFriendFieldByIdForScope(c.env.DB, c.req.param('id'), scope);
    if (!source) return c.json({ success: false, error: '項目が見つかりません' }, 404);
    const body = await c.req.json<{ targetType?: unknown }>();
    const targetType = String(body.targetType ?? '');
    if (!(FRIEND_FIELD_TYPES as readonly string[]).includes(targetType)) {
      return c.json({ success: false, error: '移行先の種類が正しくありません' }, 422);
    }
    const values = await getFriendFieldValuesForMigration(c.env.DB, source.id, scope);
    const rows: MigrationPreviewRow[] = values.map((item) => ({
      friendId: item.friend_id,
      sourceValue: item.value,
      ...convertMigrationValue(item.value, targetType as FriendFieldType),
    }));
    const count = (status: MigrationPreviewRow['status']) => rows.filter((row) => row.status === status).length;
    return c.json({ success: true, data: {
      source: serialize(source),
      summary: { total: rows.length, convertible: count('convertible'), review: count('review'), invalid: count('invalid') },
      rows: rows.filter((row) => row.status !== 'convertible').slice(0, 100),
    } });
  } catch (err) {
    console.error('POST /api/friend-fields/:id/migration-preview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/friend-fields
friendFields.post('/api/friend-fields', requireRole('owner', 'admin'), async (c) => {
  try {
    const scope = await friendFieldAccess(c);
    if (scope instanceof Response) return scope;
    const body = await c.req.json<Record<string, unknown>>();

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: '項目名を入力してください' }, 400);

    const keyCheck = validateFieldKey(body.fieldKey);
    if (!keyCheck.ok) return c.json({ success: false, error: keyCheck.error }, 422);

    if (!(FRIEND_FIELD_TYPES as readonly string[]).includes(String(body.type))) {
      return c.json({ success: false, error: '項目の種類が正しくありません' }, 422);
    }

    const options = parseOptions(body.options);
    if (!options.ok) {
      return c.json({ success: false, error: '選択肢は文字列の配列で指定してください' }, 422);
    }

    const field = await createFriendFieldForScope(c.env.DB, scope, {
      name,
      fieldKey: String(body.fieldKey),
      type: String(body.type) as FriendFieldType,
      folderId: body.folderId ? String(body.folderId) : null,
      optionsJson: options.value,
      defaultValue: body.defaultValue == null ? null : String(body.defaultValue),
      source: (body.source as 'manual' | 'form' | 'ec' | 'automation') ?? 'manual',
      ecFieldPath: body.ecFieldPath ? String(body.ecFieldPath) : null,
      ecIsMaster: body.ecIsMaster === true,
      isPersonal: body.isPersonal === true,
      isStarred: body.isStarred === true,
      displayOrder: Number(body.displayOrder ?? 0),
    });
    return c.json({ success: true, data: serialize(field) }, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: 'その差し込み名は既に使われています' }, 409);
    }
    console.error('POST /api/friend-fields error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/friend-fields/:id
//
// 種類と差し込み名はここでは変えられない。種類を変えると既に入っている値の
// 意味が変わり（「犬」が数値項目になる等）、差し込み名を変えると
// テンプレートの差し込みが黙って空になる。どちらも作り直してもらう。
friendFields.patch('/api/friend-fields/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const scope = await friendFieldAccess(c);
    if (scope instanceof Response) return scope;
    const id = c.req.param('id');
    const existing = await getFriendFieldByIdForScope(c.env.DB, id, scope);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    if (existing.is_inherited === 1) {
      return c.json({
        success: false,
        error: '共通項目は直接変更できません。新しい項目へ安全に移行してください。',
      }, 409);
    }

    const body = await c.req.json<Record<string, unknown>>();

    if (body.type !== undefined && body.type !== existing.type) {
      return c.json(
        {
          success: false,
          error:
            '項目の種類は後から変えられません。すでに入っている値の意味が変わるためです。新しい項目を作ってください。',
        },
        422,
      );
    }
    if (body.fieldKey !== undefined && body.fieldKey !== existing.field_key) {
      return c.json(
        {
          success: false,
          error:
            '差し込み名は後から変えられません。テンプレートの差し込みが空になるためです。新しい項目を作ってください。',
        },
        422,
      );
    }

    const patch: Parameters<typeof updateFriendField>[2] = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return c.json({ success: false, error: '項目名を入力してください' }, 400);
      patch.name = name;
    }
    if ('folderId' in body) patch.folderId = body.folderId ? String(body.folderId) : null;
    if ('options' in body) {
      const options = parseOptions(body.options);
      if (!options.ok) {
        return c.json({ success: false, error: '選択肢は文字列の配列で指定してください' }, 422);
      }
      patch.optionsJson = options.value;
    }
    if ('defaultValue' in body) {
      patch.defaultValue = body.defaultValue == null ? null : String(body.defaultValue);
    }
    if ('ecFieldPath' in body) {
      patch.ecFieldPath = body.ecFieldPath ? String(body.ecFieldPath) : null;
    }
    if (body.ecIsMaster !== undefined) patch.ecIsMaster = body.ecIsMaster === true;
    if (body.isPersonal !== undefined) patch.isPersonal = body.isPersonal === true;
    if (body.isStarred !== undefined) patch.isStarred = body.isStarred === true;
    if (body.displayOrder !== undefined) patch.displayOrder = Number(body.displayOrder);

    const field = await updateFriendField(c.env.DB, id, patch);
    return c.json({ success: true, data: serialize(field!) });
  } catch (err) {
    console.error('PATCH /api/friend-fields/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/friend-fields/:id
//
// 値が入っていれば人数を返して止める。項目を消すと入っていた値も消えるので、
// 何人ぶん消えるのかを見てから決めてもらう。
friendFields.delete('/api/friend-fields/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const scope = await friendFieldAccess(c);
    if (scope instanceof Response) return scope;
    const id = c.req.param('id');
    const existing = await getFriendFieldByIdForScope(c.env.DB, id, scope);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    if (existing.is_inherited === 1) {
      return c.json({ success: false, error: '共通項目は削除できません' }, 409);
    }

    const usage = await countFriendFieldValuesForScope(c.env.DB, id, scope);
    if (usage > 0) {
      return c.json(
        {
          success: false,
          error: `この項目は ${usage} 人に値が入っています。削除せず、新しい項目へ移行してください。`,
          code: 'IN_USE',
          usageCount: usage,
        },
        409,
      );
    }
    await deleteFriendField(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/friend-fields/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/friends/:id/fields
//
// 個人情報の項目は役割で絞る。閲覧できる人が開いたときは記録を残す。
friendFields.get('/api/friends/:id/fields', async (c) => {
  try {
    const friendId = c.req.param('id');
    const staff = c.get('staff');
    const canSeePersonal = !!staff && (staff.role === 'owner' || staff.role === 'admin');

    const rows = await getFriendFieldsWithValues(c.env.DB, friendId);
    const visible = rows.filter((r) => r.is_personal === 0 || canSeePersonal);
    const hiddenCount = rows.length - visible.length;

    if (canSeePersonal && rows.some((r) => r.is_personal === 1 && r.value)) {
      // 個人情報保護法上の利用記録。値が入っている項目を実際に見たときだけ残す。
      // 「項目があること」を見ただけでは閲覧にあたらない。
      const audit = recordLoginAudit(c.env.DB, {
        adminUserId: staff?.id ?? null,
        action: 'view_personal',
        screen: `/friends/${friendId}`,
      });
      // 応答を待たせずに書きたいが、記録が消えては意味がない。
      // waitUntil が使える場面ではそれに任せ、無ければ待つ。
      // c.executionCtx は無いときに例外を投げるので、参照自体を守る。
      let deferred = false;
      try {
        c.executionCtx.waitUntil(audit);
        deferred = true;
      } catch {
        deferred = false;
      }
      if (!deferred) await audit;
    }

    return c.json({
      success: true,
      data: {
        items: visible.map(serialize),
        // 「見えない項目がある」ことは伝える。何があるかは伝えない。
        hiddenPersonalCount: hiddenCount,
      },
    });
  } catch (err) {
    console.error('GET /api/friends/:id/fields error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/friends/:id/fields
//
// まとめて更新する。EC を正としている項目は書き換えず、理由を warnings で返す。
// 黙って無視すると「保存したのに戻る」という形で表に出る。
friendFields.put('/api/friends/:id/fields', requireRole('owner', 'admin'), async (c) => {
  try {
    const friendId = c.req.param('id');
    const staff = c.get('staff');
    const body = await c.req.json<{ values?: Record<string, unknown> }>();
    const values = body.values ?? {};

    const fields = await getFriendFields(c.env.DB);
    const byId = new Map(fields.map((f) => [f.id, f]));
    const warnings: string[] = [];
    let updated = 0;

    for (const [fieldId, raw] of Object.entries(values)) {
      const field = byId.get(fieldId);
      if (!field) {
        warnings.push(`知らない項目が含まれていたため無視しました（${fieldId}）`);
        continue;
      }
      if (field.ec_is_master === 1) {
        warnings.push(`「${field.name}」はEC側が正のため、管理画面からは変更できません`);
        continue;
      }
      await setFriendFieldValue(c.env.DB, {
        friendId,
        fieldId,
        value: raw == null ? null : String(raw),
        updatedBy: staff?.id ?? 'unknown',
      });
      updated++;
    }

    return c.json({ success: true, data: { updated }, warnings });
  } catch (err) {
    console.error('PUT /api/friends/:id/fields error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/friend-fields/bulk
//
// 選んだ友だち全員に同じ値を入れる。人数が多いので、上限を置く。
friendFields.post('/api/friend-fields/bulk', requireRole('owner', 'admin'), async (c) => {
  try {
    const staff = c.get('staff');
    const body = await c.req.json<{ friendIds?: unknown; fieldId?: unknown; value?: unknown }>();
    const friendIds = Array.isArray(body.friendIds) ? body.friendIds.map(String) : [];
    if (friendIds.length === 0) {
      return c.json({ success: false, error: '対象の友だちが選ばれていません' }, 400);
    }
    if (friendIds.length > 1000) {
      return c.json(
        { success: false, error: '一度に変更できるのは1000人までです' },
        422,
      );
    }
    const field = await getFriendFieldById(c.env.DB, String(body.fieldId));
    if (!field) return c.json({ success: false, error: '項目が見つかりません' }, 404);
    if (field.ec_is_master === 1) {
      return c.json(
        { success: false, error: `「${field.name}」はEC側が正のため変更できません` },
        409,
      );
    }

    for (const friendId of friendIds) {
      await setFriendFieldValue(c.env.DB, {
        friendId,
        fieldId: field.id,
        value: body.value == null ? null : String(body.value),
        updatedBy: staff?.id ?? 'unknown',
      });
    }
    return c.json({ success: true, data: { updated: friendIds.length } });
  } catch (err) {
    console.error('POST /api/friend-fields/bulk error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { friendFields };
