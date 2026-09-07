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
  getFriendFieldUsageForScope,
  getFriendFieldValuesForMigration,
  createFieldMigrationPreview,
  getFieldMigrationRun,
  getFieldMigrationRunByToken,
  getFieldMigrationRunByIdempotencyKey,
  getFieldMigrationItems,
  queueFieldMigration,
  markFieldMigrationStale,
  executeFieldMigration,
  getFriendFieldsWithValues,
  setFriendFieldValue,
  validateFieldKey,
  FRIEND_FIELD_TYPES,
  getFolderById,
  type FriendField,
  type FriendFieldScope,
  type FriendFieldType,
} from '@line-crm/db';
import { recordLoginAudit } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { requireVisibleFriend } from './friends.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

const friendFields = new Hono<Env>();

function serialize(row: FriendField & { value?: string | null; updated_by?: string | null; is_inherited?: number }) {
  let rawOptions: unknown[] | null = null;
  try {
    const parsed = row.options_json ? JSON.parse(row.options_json) as unknown : null;
    rawOptions = Array.isArray(parsed) ? parsed : null;
  } catch { rawOptions = null; }
  const optionDefinitions = rawOptions?.map((option, index) => typeof option === 'string'
    ? { id: option, label: option, color: null, status: 'active', displayOrder: index }
    : option);
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    fieldKey: row.field_key,
    type: row.type,
    options: rawOptions?.map((option) => typeof option === 'string'
      ? option
      : option && typeof option === 'object' && typeof (option as { label?: unknown }).label === 'string'
        ? String((option as { label: string }).label)
        : '').filter(Boolean) ?? null,
    optionDefinitions: optionDefinitions ?? null,
    defaultValue: row.default_value,
    source: row.source,
    ecFieldPath: row.ec_field_path,
    ecIsMaster: Boolean(row.ec_is_master),
    isPersonal: Boolean(row.is_personal),
    isStarred: Boolean(row.is_starred),
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status ?? 'active',
    version: row.version ?? 1,
    canInsertText: row.type !== 'image' && row.type !== 'pdf',
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

type FieldOption = {
  id: string;
  label: string;
  color: string | null;
  status: 'active' | 'archived';
  displayOrder: number;
};

/** 表示名とは別に不変IDを持たせ、名称変更で保存済み値を壊さない。 */
function parseOptions(raw: unknown, existingRaw?: string | null): { ok: true; value: string | null; items: FieldOption[] } | { ok: false } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null, items: [] };
  if (!Array.isArray(raw)) return { ok: false };
  let existing: FieldOption[] = [];
  try {
    const parsed = existingRaw ? JSON.parse(existingRaw) as unknown : [];
    if (Array.isArray(parsed)) existing = parsed.filter((item): item is FieldOption =>
      !!item && typeof item === 'object' && typeof (item as FieldOption).id === 'string');
  } catch { existing = []; }
  const items: FieldOption[] = [];
  for (const [index, item] of raw.entries()) {
    const label = typeof item === 'string'
      ? item.trim()
      : item && typeof item === 'object' && typeof (item as { label?: unknown }).label === 'string'
        ? String((item as { label: string }).label).trim()
        : '';
    if (!label || label.length > 100) return { ok: false };
    const requestedId = item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined;
    const retained = existing.find((option) => option.id === requestedId)
      ?? existing.find((option) => option.label === label);
    const status = item && typeof item === 'object' && (item as { status?: unknown }).status === 'archived'
      ? 'archived' as const
      : retained?.status ?? 'active' as const;
    items.push({
      id: retained?.id ?? crypto.randomUUID(),
      label,
      color: item && typeof item === 'object' && typeof (item as { color?: unknown }).color === 'string'
        ? String((item as { color: string }).color)
        : retained?.color ?? null,
      status,
      displayOrder: item && typeof item === 'object' && Number.isInteger((item as { displayOrder?: unknown }).displayOrder)
        ? Number((item as { displayOrder: number }).displayOrder)
        : retained?.displayOrder ?? index,
    });
  }
  if (new Set(items.map((item) => item.label)).size !== items.length) return { ok: false };
  return { ok: true, value: JSON.stringify(items), items };
}

function validateDefaultValue(
  raw: unknown,
  type: FriendFieldType,
  options: FieldOption[],
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  if (type === 'image' || type === 'pdf') return { ok: false, error: '画像・PDFには既定値を設定できません' };
  if (type === 'checkbox') {
    if (raw === true || raw === '1' || raw === 'true') return { ok: true, value: '1' };
    if (raw === false || raw === '0' || raw === 'false') return { ok: true, value: '0' };
    return { ok: false, error: 'チェック項目の既定値はtrueまたはfalseで指定してください' };
  }
  if (type === 'multi_select') {
    const values = Array.isArray(raw) ? raw.map(String) : null;
    if (!values) return { ok: false, error: '複数選択の既定値は選択肢IDの配列で指定してください' };
    const ids = values.map((value) => options.find((item) => item.id === value || item.label === value)?.id);
    if (ids.some((id) => !id)) return { ok: false, error: '存在しない選択肢が既定値に含まれています' };
    return { ok: true, value: JSON.stringify(ids) };
  }
  const value = String(raw).trim();
  if (type === 'select') {
    const option = options.find((item) => item.id === value || item.label === value);
    return option ? { ok: true, value: option.id } : { ok: false, error: '既定値は登録済みの選択肢から指定してください' };
  }
  if (type === 'number' && !Number.isFinite(Number(value))) return { ok: false, error: '既定値を数値で指定してください' };
  if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, error: '既定値をYYYY-MM-DDで指定してください' };
  if (type === 'datetime' && Number.isNaN(Date.parse(value))) return { ok: false, error: '既定値を日時形式で指定してください' };
  if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok: false, error: '既定値をメールアドレス形式で指定してください' };
  if (type === 'tel' && !/^\+?[0-9() -]{8,20}$/.test(value)) return { ok: false, error: '既定値を電話番号形式で指定してください' };
  if (type === 'url') {
    try { if (!['http:', 'https:'].includes(new URL(value).protocol)) throw new Error(); }
    catch { return { ok: false, error: '既定値をhttpまたはhttpsのURLで指定してください' }; }
  }
  const limit = type === 'textarea' ? 2000 : 200;
  return value.length <= limit
    ? { ok: true, value }
    : { ok: false, error: `既定値は${limit}文字以内で指定してください` };
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function migrationSnapshot(
  source: FriendField,
  target: FriendField,
  values: Array<{ friend_id: string; value: string }>,
  usages: Array<{ kind: string; id: string; switchable: boolean }>,
): string {
  return JSON.stringify({
    source: [source.id, source.version ?? 1, source.updated_at],
    target: [target.id, target.version ?? 1, target.updated_at],
    values: values.map((item) => [item.friend_id, item.value]),
    usages: usages.map((item) => [item.kind, item.id, item.switchable]),
  });
}

function serializeMigrationRun(run: Awaited<ReturnType<typeof getFieldMigrationRun>>, rows: Awaited<ReturnType<typeof getFieldMigrationItems>>) {
  if (!run) return null;
  return {
    runId: run.id,
    sourceFieldId: run.source_field_id,
    targetFieldId: run.target_field_id,
    status: run.status,
    summary: {
      total: Number(run.total_count),
      convertible: Number(run.convertible_count),
      review: Number(run.review_count),
      invalid: Number(run.invalid_count),
      processed: Number(run.processed_count),
      succeeded: Number(run.succeeded_count),
      failed: Number(run.failed_count),
    },
    usageTargets: JSON.parse(run.usage_targets_json) as unknown,
    rows: rows.map((row) => ({
      friendId: row.friend_id,
      sourceValue: row.source_value,
      convertedValue: row.converted_value,
      status: row.status,
      reason: row.reason,
    })),
    previewExpiresAt: run.preview_expires_at,
    rollbackDeadline: run.rollback_deadline,
    error: run.error_message,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
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
  if (targetType === 'datetime') {
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime())
      ? { convertedValue: null, status: 'review', reason: '日時の形を確認してください' }
      : { convertedValue: date.toISOString(), status: 'convertible', reason: null };
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
  if (targetType === 'image' || targetType === 'pdf') {
    return { convertedValue: null, status: 'review', reason: '登録メディアを選び直してください' };
  }
  return { convertedValue: trimmed, status: 'convertible', reason: null };
}

// GET /api/friend-fields
friendFields.get('/api/friend-fields', async (c) => {
  try {
    const scope = await friendFieldAccess(c);
    if (scope instanceof Response) return scope;
    const folderId = c.req.query('folderId') || undefined;
    const status = c.req.query('status') || undefined;
    if (status && !['active', 'read_only', 'archived'].includes(status)) {
      return c.json({ success: false, error: '状態の指定が正しくありません' }, 422);
    }
    const items = await getFriendFieldsForScope(c.env.DB, scope, {
      folderId,
      status: status as 'active' | 'read_only' | 'archived' | undefined,
    });

    // ?withUsage=1 で「何人に値が入っているか」を付ける。削除の前に見る画面用。
    // 項目ごとに1クエリなので、既定では引かない。
    if (c.req.query('withUsage') === '1') {
      const usageTargets = await getFriendFieldUsageForScope(c.env.DB, items.map((item) => item.id), scope);
      const withUsage = await Promise.all(items.map(async (item) => {
        const ownTargets = usageTargets.filter((target) => target.fieldId === item.id);
        return {
          ...serialize(item),
          usageCount: await countFriendFieldValuesForScope(c.env.DB, item.id, scope),
          formUsageCount: ownTargets.filter((target) => target.kind === 'form').length,
          displayTargets: ownTargets.map((target) => target.name),
        };
      }));
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
    const body = await c.req.json<{ targetType?: unknown; targetFieldId?: unknown }>();
    const target = body.targetFieldId
      ? await getFriendFieldByIdForScope(c.env.DB, String(body.targetFieldId), scope)
      : null;
    if (body.targetFieldId && !target) {
      return c.json({ success: false, code: 'TARGET_NOT_FOUND', error: '移行先の項目が見つかりません' }, 404);
    }
    if (target?.id === source.id) {
      return c.json({ success: false, code: 'SAME_FIELD', error: '移行元と移行先には別の項目を指定してください' }, 422);
    }
    const targetType = target?.type ?? String(body.targetType ?? '');
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
    const usageTargets = await getFriendFieldUsageForScope(c.env.DB, [source.id], scope);
    let previewToken: string | null = null;
    let runId: string | null = null;
    let previewExpiresAt: string | null = null;
    if (target) {
      previewToken = crypto.randomUUID();
      runId = crypto.randomUUID();
      previewExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const snapshotHash = await sha256(migrationSnapshot(source, target, values, usageTargets));
      await createFieldMigrationPreview(c.env.DB, {
        runId,
        scope,
        sourceFieldId: source.id,
        targetFieldId: target.id,
        sourceVersion: source.version ?? 1,
        targetVersion: target.version ?? 1,
        previewTokenHash: await sha256(previewToken),
        snapshotHash,
        expiresAt: previewExpiresAt,
        usageTargets,
        items: rows,
        createdBy: c.get('staff').id,
      });
    }
    return c.json({ success: true, data: {
      source: serialize(source),
      ...(target ? { target: serialize(target) } : {}),
      summary: { total: rows.length, convertible: count('convertible'), review: count('review'), invalid: count('invalid') },
      rows: rows.filter((row) => row.status !== 'convertible').slice(0, 100),
      usageTargets,
      runId,
      previewToken,
      previewExpiresAt,
    } });
  } catch (err) {
    console.error('POST /api/friend-fields/:id/migration-preview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/friend-fields/:id/migrations
friendFields.post('/api/friend-fields/:id/migrations', requireRole('owner', 'admin'), async (c) => {
  try {
    const scope = await friendFieldAccess(c);
    if (scope instanceof Response) return scope;
    const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return c.json({ success: false, code: 'IDEMPOTENCY_KEY_REQUIRED', error: 'Idempotency-Keyを指定してください' }, 422);
    }
    const duplicate = await getFieldMigrationRunByIdempotencyKey(c.env.DB, idempotencyKey, scope);
    if (duplicate) return c.json({ success: true, data: { runId: duplicate.id } }, 202);

    const body = await c.req.json<{ previewToken?: unknown }>();
    const previewToken = typeof body.previewToken === 'string' ? body.previewToken : '';
    if (!previewToken) {
      return c.json({ success: false, code: 'PREVIEW_TOKEN_REQUIRED', error: '事前確認をやり直してください' }, 422);
    }
    const run = await getFieldMigrationRunByToken(c.env.DB, await sha256(previewToken), scope);
    if (!run || run.source_field_id !== c.req.param('id')) {
      return c.json({ success: false, code: 'PREVIEW_NOT_FOUND', error: '事前確認が見つかりません。やり直してください' }, 404);
    }
    if (Date.parse(run.preview_expires_at) <= Date.now()) {
      return c.json({ success: false, code: 'PREVIEW_EXPIRED', error: '事前確認の有効期限が切れました。やり直してください' }, 409);
    }
    const source = await getFriendFieldByIdForScope(c.env.DB, run.source_field_id, scope);
    const target = await getFriendFieldByIdForScope(c.env.DB, run.target_field_id, scope);
    if (!source || !target) {
      return c.json({ success: false, code: 'FIELD_CHANGED', error: '項目が変更されたため事前確認をやり直してください' }, 409);
    }
    const values = await getFriendFieldValuesForMigration(c.env.DB, source.id, scope);
    const usageTargets = await getFriendFieldUsageForScope(c.env.DB, [source.id], scope);
    const currentHash = await sha256(migrationSnapshot(source, target, values, usageTargets));
    if (currentHash !== run.preview_snapshot_hash
      || (source.version ?? 1) !== Number(run.source_version)
      || (target.version ?? 1) !== Number(run.target_version)) {
      await markFieldMigrationStale(c.env.DB, run.id);
      return c.json({ success: false, code: 'PREVIEW_STALE', error: '事前確認後に値または使用先が変わりました。やり直してください' }, 409);
    }
    if (!await queueFieldMigration(c.env.DB, run.id, idempotencyKey)) {
      return c.json({ success: false, code: 'RUN_STATE_CHANGED', error: '移行状態が変わりました。実行状況を確認してください' }, 409);
    }
    const execution = executeFieldMigration(c.env.DB, run.id, target.type as FriendFieldType, c.get('staff').id);
    try { c.executionCtx.waitUntil(execution); } catch { await execution; }
    return c.json({ success: true, data: { runId: run.id } }, 202);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
      return c.json({ success: false, code: 'IDEMPOTENCY_CONFLICT', error: '同じ操作はすでに受け付けています' }, 409);
    }
    console.error('POST /api/friend-fields/:id/migrations error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/field-migrations/:runId
friendFields.get('/api/field-migrations/:runId', async (c) => {
  try {
    const scope = await friendFieldAccess(c);
    if (scope instanceof Response) return scope;
    const run = await getFieldMigrationRun(c.env.DB, c.req.param('runId'), scope);
    if (!run) return c.json({ success: false, error: '移行履歴が見つかりません' }, 404);
    const rows = await getFieldMigrationItems(c.env.DB, run.id);
    return c.json({ success: true, data: serializeMigrationRun(run, rows) });
  } catch (err) {
    console.error('GET /api/field-migrations/:runId error:', err);
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
    const type = String(body.type) as FriendFieldType;
    const source = body.source ?? 'manual';
    if (!['manual', 'form', 'ec', 'automation'].includes(String(source))) {
      return c.json({ success: false, error: '登録元が正しくありません' }, 422);
    }
    const folderId = body.folderId ? String(body.folderId) : null;
    if (folderId) {
      const folder = await getFolderById(c.env.DB, folderId);
      if (!folder || folder.kind !== 'friend_field') {
        return c.json({ success: false, error: '友だち情報欄のフォルダが見つかりません' }, 422);
      }
    }

    const options = parseOptions(body.options);
    if (!options.ok) {
      return c.json({ success: false, error: '選択肢の名前・色・状態を確認してください' }, 422);
    }
    if (type !== 'select' && type !== 'multi_select' && options.items.length > 0) {
      return c.json({ success: false, error: '選択肢は選択式の項目だけに設定できます' }, 422);
    }
    if ((type === 'image' || type === 'pdf') && (body.mediaId != null || body.allowTextInsertion === true)) {
      return c.json({ success: false, error: '画像・PDFは既定値や本文差し込みに使えません' }, 422);
    }
    const defaultValue = validateDefaultValue(body.defaultValue, type, options.items);
    if (!defaultValue.ok) return c.json({ success: false, error: defaultValue.error }, 422);

    const field = await createFriendFieldForScope(c.env.DB, scope, {
      name,
      fieldKey: String(body.fieldKey),
      type,
      folderId,
      optionsJson: options.value,
      defaultValue: defaultValue.value,
      source: source as 'manual' | 'form' | 'ec' | 'automation',
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
    if (body.version !== undefined) {
      const version = Number(body.version);
      if (!Number.isInteger(version) || version < 1) {
        return c.json({ success: false, error: 'versionを正しく指定してください' }, 422);
      }
      patch.expectedVersion = version;
    }
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return c.json({ success: false, error: '項目名を入力してください' }, 400);
      patch.name = name;
    }
    if ('folderId' in body) {
      const folderId = body.folderId ? String(body.folderId) : null;
      if (folderId) {
        const folder = await getFolderById(c.env.DB, folderId);
        if (!folder || folder.kind !== 'friend_field') {
          return c.json({ success: false, error: '友だち情報欄のフォルダが見つかりません' }, 422);
        }
      }
      patch.folderId = folderId;
    }
    if ('options' in body) {
      const options = parseOptions(body.options, existing.options_json);
      if (!options.ok) {
        return c.json({ success: false, error: '選択肢の名前・色・状態を確認してください' }, 422);
      }
      if (existing.type !== 'select' && existing.type !== 'multi_select' && options.items.length > 0) {
        return c.json({ success: false, error: '選択肢は選択式の項目だけに設定できます' }, 422);
      }
      patch.optionsJson = options.value;
    }
    if ('defaultValue' in body) {
      const parsedOptions = parseOptions('options' in body ? body.options :
        (existing.options_json ? JSON.parse(existing.options_json) : []), existing.options_json);
      const checked = validateDefaultValue(body.defaultValue, existing.type as FriendFieldType,
        parsedOptions.ok ? parsedOptions.items : []);
      if (!checked.ok) return c.json({ success: false, error: checked.error }, 422);
      patch.defaultValue = checked.value;
    }
    if ('ecFieldPath' in body) {
      patch.ecFieldPath = body.ecFieldPath ? String(body.ecFieldPath) : null;
    }
    if (body.ecIsMaster !== undefined) patch.ecIsMaster = body.ecIsMaster === true;
    if (body.isPersonal !== undefined) patch.isPersonal = body.isPersonal === true;
    if (body.isStarred !== undefined) patch.isStarred = body.isStarred === true;
    if (body.displayOrder !== undefined) patch.displayOrder = Number(body.displayOrder);

    const field = await updateFriendField(c.env.DB, id, patch);
    if (!field) {
      return c.json({ success: false, code: 'VERSION_CONFLICT', error: 'ほかの変更が先に保存されました。再読み込みしてください' }, 409);
    }
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
friendFields.get(
  '/api/friends/:id/fields',
  requireRole('owner', 'admin', 'staff'),
  requireVisibleFriend,
  async (c) => {
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
  },
);

// PUT /api/friends/:id/fields
//
// まとめて更新する。EC を正としている項目は書き換えず、理由を warnings で返す。
// 黙って無視すると「保存したのに戻る」という形で表に出る。
friendFields.put('/api/friends/:id/fields', requireRole('owner', 'admin'), requireVisibleFriend, async (c) => {
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
