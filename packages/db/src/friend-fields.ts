import { jstNow } from './utils.js';

/** 移行前の情報欄を所属させる既定テナント。既存IDと値は変えない。 */
const LEGACY_TENANT_ID = '00000000-0000-4000-8000-000000000001';

export interface FriendFieldScope {
  tenantId: string;
  lineAccountId: string;
}

/**
 * 友だち情報欄。
 *
 * フォームの回答 → 情報欄 → 友だち詳細 → テンプレートの差し込み、が
 * 1本の線で繋がる。この線の起点で、v0.24.0 で一番影響範囲が広い。
 */

export const FRIEND_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'multi_select',
  'checkbox',
  'url',
  'tel',
  'email',
] as const;

export type FriendFieldType = (typeof FRIEND_FIELD_TYPES)[number];

export interface FriendField {
  id: string;
  folder_id: string | null;
  name: string;
  field_key: string;
  type: string;
  options_json: string | null;
  default_value: string | null;
  source: string;
  ec_field_path: string | null;
  ec_is_master: number;
  is_personal: number;
  is_starred: number;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface ScopedFriendField extends FriendField {
  line_account_id: string | null;
  tenant_id: string;
  is_inherited: number;
}

export interface FriendFieldListSummary {
  total: number;
  inUse: number;
  registeredFriends: number;
  updatedThisMonth: number;
  /** forms 自体にアカウント所属が無いため、誤った全体件数を返さない。 */
  formLinks: null;
}

const SCOPED_FIELD_SELECT = `
  SELECT ff.*,
         ffs.line_account_id,
         COALESCE(ffs.tenant_id, '${LEGACY_TENANT_ID}') AS tenant_id,
         CASE WHEN ffs.field_id IS NULL OR ffs.line_account_id IS NULL THEN 1 ELSE 0 END AS is_inherited
    FROM friend_fields ff
    LEFT JOIN friend_field_scopes ffs ON ffs.field_id = ff.id`;

export interface FriendFieldValue {
  friend_id: string;
  field_id: string;
  value: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface FriendFieldMigrationSourceValue {
  friend_id: string;
  value: string;
}

/**
 * 差し込み変数として使える名前か。
 *
 * テンプレートで {key} として置換するので、日本語や記号を許すと
 * 置換の正規表現が壊れる。長さの上限も置く（32文字）。
 */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * 予約語。既に別の意味で使っている差し込み名と衝突させない。
 *
 * 衝突を許すと「{name} を入れたのに友だちの表示名が出る」といった、
 * 設定と結果が食い違う形で表に出る。
 */
export const RESERVED_FIELD_KEYS = new Set([
  'name',
  'id',
  'tag',
  'tags',
  'url',
  'account',
  'today',
]);

export function validateFieldKey(key: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof key !== 'string' || !FIELD_KEY_PATTERN.test(key)) {
    return {
      ok: false,
      error: '差し込み名は半角英小文字で始まり、英小文字・数字・下線のみ、32文字までです',
    };
  }
  if (RESERVED_FIELD_KEYS.has(key)) {
    return { ok: false, error: `「${key}」は既に別の意味で使われているため指定できません` };
  }
  return { ok: true };
}

export async function getFriendFields(
  db: D1Database,
  opts: { folderId?: string } = {},
): Promise<FriendField[]> {
  if (opts.folderId) {
    const result = await db
      .prepare(
        `SELECT * FROM friend_fields WHERE folder_id = ? ORDER BY display_order ASC, name ASC`,
      )
      .bind(opts.folderId)
      .all<FriendField>();
    return result.results;
  }
  const result = await db
    .prepare(`SELECT * FROM friend_fields ORDER BY display_order ASC, name ASC`)
    .all<FriendField>();
  return result.results;
}

/** 選択中のLINE公式アカウントから見える項目だけを返す。 */
export async function getFriendFieldsForScope(
  db: D1Database,
  scope: FriendFieldScope,
  opts: { folderId?: string } = {},
): Promise<ScopedFriendField[]> {
  const folder = opts.folderId ? ' AND ff.folder_id = ?' : '';
  const binds: unknown[] = [LEGACY_TENANT_ID, scope.tenantId, scope.lineAccountId];
  if (opts.folderId) binds.push(opts.folderId);
  const result = await db
    .prepare(
      `${SCOPED_FIELD_SELECT}
        WHERE COALESCE(ffs.tenant_id, ?) = ?
          AND (ffs.line_account_id = ? OR ffs.line_account_id IS NULL)${folder}
        ORDER BY CASE WHEN ffs.line_account_id = ? THEN 0 ELSE 1 END,
                 ff.display_order ASC, ff.name ASC`,
    )
    .bind(...binds, scope.lineAccountId)
    .all<ScopedFriendField>();
  return result.results;
}

/** ID直指定でも、担当外アカウントの項目を返さない。 */
export async function getFriendFieldByIdForScope(
  db: D1Database,
  id: string,
  scope: FriendFieldScope,
): Promise<ScopedFriendField | null> {
  return db
    .prepare(
      `${SCOPED_FIELD_SELECT}
        WHERE ff.id = ?
          AND COALESCE(ffs.tenant_id, ?) = ?
          AND (ffs.line_account_id = ? OR ffs.line_account_id IS NULL)`,
    )
    .bind(id, LEGACY_TENANT_ID, scope.tenantId, scope.lineAccountId)
    .first<ScopedFriendField>();
}

export async function getFriendFieldById(
  db: D1Database,
  id: string,
): Promise<FriendField | null> {
  return db.prepare(`SELECT * FROM friend_fields WHERE id = ?`).bind(id).first<FriendField>();
}

export interface CreateFriendFieldInput {
  name: string;
  fieldKey: string;
  type: FriendFieldType;
  folderId?: string | null;
  optionsJson?: string | null;
  defaultValue?: string | null;
  source?: 'manual' | 'form' | 'ec' | 'automation';
  ecFieldPath?: string | null;
  ecIsMaster?: boolean;
  isPersonal?: boolean;
  isStarred?: boolean;
  displayOrder?: number;
}

export async function createFriendField(
  db: D1Database,
  input: CreateFriendFieldInput,
): Promise<FriendField> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO friend_fields
         (id, folder_id, name, field_key, type, options_json, default_value,
          source, ec_field_path, ec_is_master, is_personal, is_starred,
          display_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.folderId ?? null,
      input.name,
      input.fieldKey,
      input.type,
      input.optionsJson ?? null,
      input.defaultValue ?? null,
      input.source ?? 'manual',
      input.ecFieldPath ?? null,
      input.ecIsMaster ? 1 : 0,
      input.isPersonal ? 1 : 0,
      input.isStarred ? 1 : 0,
      input.displayOrder ?? 0,
      now,
      now,
    )
    .run();
  return (await getFriendFieldById(db, id))!;
}

/** 新規項目と所属を同じD1バッチで作る。 */
export async function createFriendFieldForScope(
  db: D1Database,
  scope: FriendFieldScope,
  input: CreateFriendFieldInput,
): Promise<ScopedFriendField> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.batch([
    db
      .prepare(
        `INSERT INTO friend_fields
           (id, folder_id, name, field_key, type, options_json, default_value,
            source, ec_field_path, ec_is_master, is_personal, is_starred,
            display_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.folderId ?? null,
        input.name,
        input.fieldKey,
        input.type,
        input.optionsJson ?? null,
        input.defaultValue ?? null,
        input.source ?? 'manual',
        input.ecFieldPath ?? null,
        input.ecIsMaster ? 1 : 0,
        input.isPersonal ? 1 : 0,
        input.isStarred ? 1 : 0,
        input.displayOrder ?? 0,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO friend_field_scopes
           (field_id, tenant_id, line_account_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(id, scope.tenantId, scope.lineAccountId, now),
  ]);
  return (await getFriendFieldByIdForScope(db, id, scope))!;
}

export interface UpdateFriendFieldInput {
  name?: string;
  folderId?: string | null;
  optionsJson?: string | null;
  defaultValue?: string | null;
  ecFieldPath?: string | null;
  ecIsMaster?: boolean;
  isPersonal?: boolean;
  isStarred?: boolean;
  displayOrder?: number;
}

/**
 * 項目を更新する。
 *
 * type と field_key はここでは変えられない。type を変えると既に入っている
 * 値の意味が変わり（「犬」が数値項目になる等）、field_key を変えると
 * テンプレートの差し込みが黙って空になる。どちらも作り直してもらう。
 */
export async function updateFriendField(
  db: D1Database,
  id: string,
  input: UpdateFriendFieldInput,
): Promise<FriendField | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const put = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    values.push(v);
  };
  if (input.name !== undefined) put('name', input.name);
  if ('folderId' in input) put('folder_id', input.folderId ?? null);
  if ('optionsJson' in input) put('options_json', input.optionsJson ?? null);
  if ('defaultValue' in input) put('default_value', input.defaultValue ?? null);
  if ('ecFieldPath' in input) put('ec_field_path', input.ecFieldPath ?? null);
  if (input.ecIsMaster !== undefined) put('ec_is_master', input.ecIsMaster ? 1 : 0);
  if (input.isPersonal !== undefined) put('is_personal', input.isPersonal ? 1 : 0);
  if (input.isStarred !== undefined) put('is_starred', input.isStarred ? 1 : 0);
  if (input.displayOrder !== undefined) put('display_order', input.displayOrder);
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    values.push(jstNow(), id);
    await db
      .prepare(`UPDATE friend_fields SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }
  return getFriendFieldById(db, id);
}

/** その項目に値が入っている友だちの数。削除前の確認に使う。 */
export async function countFriendFieldValues(db: D1Database, fieldId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM friend_field_values
        WHERE field_id = ? AND value IS NOT NULL AND value != ''`,
    )
    .bind(fieldId)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

/** 選択中アカウントにいる友だちだけを数える。 */
export async function countFriendFieldValuesForScope(
  db: D1Database,
  fieldId: string,
  scope: FriendFieldScope,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM friend_field_values v
         JOIN friends f ON f.id = v.friend_id
        WHERE v.field_id = ? AND f.line_account_id = ?
          AND v.value IS NOT NULL AND v.value != ''`,
    )
    .bind(fieldId, scope.lineAccountId)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

/** dry-run用。選択中アカウントの値だけを読み、値そのものは変更しない。 */
export async function getFriendFieldValuesForMigration(
  db: D1Database,
  fieldId: string,
  scope: FriendFieldScope,
): Promise<FriendFieldMigrationSourceValue[]> {
  const result = await db
    .prepare(
      `SELECT v.friend_id, v.value
         FROM friend_field_values v
         JOIN friends f ON f.id = v.friend_id
        WHERE v.field_id = ? AND f.line_account_id = ?
          AND v.value IS NOT NULL AND v.value != ''
        ORDER BY v.friend_id ASC`,
    )
    .bind(fieldId, scope.lineAccountId)
    .all<FriendFieldMigrationSourceValue>();
  return result.results;
}

/** V6 4-2 上部の4枚に使う、選択中アカウントだけの集計。 */
export async function getFriendFieldListSummary(
  db: D1Database,
  scope: FriendFieldScope,
): Promise<FriendFieldListSummary> {
  const monthStart = `${jstNow().slice(0, 7)}-01`;
  const fields = await getFriendFieldsForScope(db, scope);
  if (fields.length === 0) {
    return { total: 0, inUse: 0, registeredFriends: 0, updatedThisMonth: 0, formLinks: null };
  }
  const ids = fields.map((field) => field.id);
  const placeholders = ids.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT
         COUNT(DISTINCT CASE WHEN v.value IS NOT NULL AND v.value != '' THEN v.field_id END) AS in_use,
         COUNT(DISTINCT CASE WHEN v.value IS NOT NULL AND v.value != '' THEN v.friend_id END) AS friends,
         COUNT(CASE WHEN v.updated_at >= ? THEN 1 END) AS updated_this_month
       FROM friend_field_values v
       JOIN friends f ON f.id = v.friend_id
      WHERE f.line_account_id = ? AND v.field_id IN (${placeholders})`,
    )
    .bind(monthStart, scope.lineAccountId, ...ids)
    .first<{ in_use: number; friends: number; updated_this_month: number }>();
  return {
    total: fields.length,
    inUse: Number(row?.in_use ?? 0),
    registeredFriends: Number(row?.friends ?? 0),
    updatedThisMonth: Number(row?.updated_this_month ?? 0),
    formLinks: null,
  };
}

export async function deleteFriendField(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM friend_fields WHERE id = ?`).bind(id).run();
}

/**
 * 1人ぶんの全項目と値。値が無い項目も含めて返す。
 *
 * 値がある項目だけを返すと、画面は「何を聞けるのか」が分からない。
 * 空欄も含めて出せてはじめて入力欄として使える。
 */
export async function getFriendFieldsWithValues(
  db: D1Database,
  friendId: string,
): Promise<Array<FriendField & { value: string | null; updated_by: string | null }>> {
  const result = await db
    .prepare(
      `SELECT f.*, v.value, v.updated_by
         FROM friend_fields f
         LEFT JOIN friend_field_values v
           ON v.field_id = f.id AND v.friend_id = ?
        ORDER BY f.display_order ASC, f.name ASC`,
    )
    .bind(friendId)
    .all<FriendField & { value: string | null; updated_by: string | null }>();
  return result.results;
}

/**
 * 値を書き込む。
 *
 * 空文字は行を消す。「空欄にした」と「一度も入れていない」を分けても
 * 画面上は同じ見え方になり、分けた分だけ判定が増えるため。
 */
export async function setFriendFieldValue(
  db: D1Database,
  input: { friendId: string; fieldId: string; value: string | null; updatedBy: string },
): Promise<void> {
  if (input.value === null || input.value === '') {
    await db
      .prepare(`DELETE FROM friend_field_values WHERE friend_id = ? AND field_id = ?`)
      .bind(input.friendId, input.fieldId)
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO friend_field_values (friend_id, field_id, value, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(friend_id, field_id)
       DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by,
                     updated_at = excluded.updated_at`,
    )
    .bind(input.friendId, input.fieldId, input.value, input.updatedBy, jstNow())
    .run();
}

/**
 * テンプレートの差し込み用に、その友だちの値を key => value で返す。
 *
 * 値が無い項目は既定値で埋める。差し込みの結果が空文字になるより、
 * 「未設定」と書いてある方が受け取る側に伝わる、という判断は
 * 呼び出し側（差し込みエンジン）に委ねるので、ここでは既定値までを返す。
 */
export async function getFriendFieldMap(
  db: D1Database,
  friendId: string,
): Promise<Record<string, string>> {
  const result = await db
    .prepare(
      `SELECT f.field_key, COALESCE(v.value, f.default_value) AS value
         FROM friend_fields f
         LEFT JOIN friend_field_values v
           ON v.field_id = f.id AND v.friend_id = ?`,
    )
    .bind(friendId)
    .all<{ field_key: string; value: string | null }>();
  const out: Record<string, string> = {};
  for (const row of result.results) {
    if (row.value != null) out[row.field_key] = row.value;
  }
  return out;
}
