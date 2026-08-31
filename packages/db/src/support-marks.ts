import { recordOperation } from './operation-audit.js';
import { jstNow } from './utils.js';

/** 移行前の対応マークを所属させる既定テナント。既存IDは変えない。 */
const LEGACY_TENANT_ID = '00000000-0000-4000-8000-000000000001';

export interface SupportMarkScope {
  tenantId: string;
  lineAccountId: string;
}

/**
 * 対応マーク。
 *
 * 受信箱の「未対応／対応中／解決済」は chats.status が持っているが、
 * あれは3つ固定でトークにしか付かない。マークは友だちに付き、
 * 名前も色も運用側が決められる。
 */

export interface SupportMark {
  id: string;
  name: string;
  color: string;
  is_default: number;
  auto_on_inbound: number;
  display_order: number;
  created_at: string;
  /** NULL は移行前からあるテナント共通マーク。 */
  line_account_id: string | null;
  tenant_id: string;
  is_inherited: number;
}

export type SupportMarkDeleteBlocker =
  | 'default_mark'
  | 'inherited_mark'
  | 'replacement_missing'
  | 'operational_references';

/** 対応マークを消す直前に、画面と削除処理が共有する影響の正本。 */
export interface SupportMarkDeleteImpact {
  mark: {
    id: string;
    name: string;
    color: string;
    isDefault: boolean;
    isInherited: boolean;
    autoOnInbound: boolean;
  };
  friendCount: number;
  replacementMark: { id: string; name: string; color: string } | null;
  operationalReferenceCount: number;
  automaticRuleStops: boolean;
  blockers: SupportMarkDeleteBlocker[];
  canDelete: boolean;
  /** 削除時に再照合する。画面で見た古い人数のまま実行させない。 */
  revision: string;
}

const SUPPORT_MARK_REFERENCE_COLUMNS = [
  ['broadcasts', 'segment_conditions'],
  ['scenarios', 'audience_condition_json'],
  ['scenario_actions', 'config_json'],
  ['scenario_actions', 'condition_json'],
  ['auto_replies', 'actions_json'],
  ['auto_replies', 'friend_conditions_json'],
  ['saved_searches', 'conditions_json'],
  ['automation_versions', 'trigger_config'],
  ['automation_versions', 'condition_config'],
  ['automation_versions', 'action_config'],
  ['automations', 'conditions'],
  ['automations', 'actions'],
  ['common_action_versions', 'action_config'],
  ['rich_menu_groups', 'targeting_condition'],
] as const;

const SUPPORT_MARK_REFERENCE_SELECTS = SUPPORT_MARK_REFERENCE_COLUMNS.map(
  ([table, column]) => `SELECT 1 AS found FROM ${table} row,
    json_tree(CASE WHEN json_valid(row.${column}) THEN row.${column} ELSE 'null' END) node
    WHERE node.type = 'text' AND CAST(node.value AS TEXT) = ?`,
);

const SUPPORT_MARK_REFERENCE_EXISTS_SQL = `EXISTS (
  SELECT 1 FROM (${SUPPORT_MARK_REFERENCE_SELECTS.join('\nUNION ALL\n')}) references_found
)`;

function referenceBindings(markId: string): string[] {
  return SUPPORT_MARK_REFERENCE_SELECTS.map(() => markId);
}

export function buildSupportMarkDeleteRevision(input: {
  mark: Pick<SupportMark, 'id' | 'name' | 'color' | 'is_default' | 'is_inherited' | 'auto_on_inbound' | 'display_order'>;
  friendCount: number;
  replacementMark: Pick<SupportMark, 'id' | 'name' | 'color'> | null;
  operationalReferenceCount: number;
}): string {
  const parts = [
    input.mark.id,
    input.mark.name,
    input.mark.color,
    input.mark.is_default,
    input.mark.is_inherited,
    input.mark.auto_on_inbound,
    input.mark.display_order,
    input.friendCount,
    input.replacementMark?.id ?? '',
    input.replacementMark?.name ?? '',
    input.replacementMark?.color ?? '',
    input.operationalReferenceCount,
  ];
  return `v1.${parts.map((part) => encodeURIComponent(String(part))).join('.')}`;
}

const MARK_SELECT = `
  SELECT sm.id, sm.name, sm.color, sm.is_default, sm.auto_on_inbound,
         sm.display_order, sm.created_at,
         sms.line_account_id,
         COALESCE(sms.tenant_id, '${LEGACY_TENANT_ID}') AS tenant_id,
         CASE WHEN sms.mark_id IS NULL OR sms.line_account_id IS NULL THEN 1 ELSE 0 END AS is_inherited
    FROM support_marks sm
    LEFT JOIN support_mark_scopes sms ON sms.mark_id = sm.id`;

/**
 * 初期の3マークを用意する。
 *
 * マイグレーション100の固定3件は既存環境にだけ残る。新規環境では
 * 選択中アカウント専用の3件を作り、別アカウントとIDも設定も共有しない。
 * INSERT OR IGNORE とアカウントを含む固定IDなので、何度呼んでも増えない。
 */
export async function ensureDefaultSupportMarks(
  db: D1Database,
  scope: SupportMarkScope,
): Promise<void> {
  const visible = await db
    .prepare(
      `${MARK_SELECT}
        WHERE COALESCE(sms.tenant_id, ?) = ?
          AND (sms.line_account_id = ? OR sms.line_account_id IS NULL)
        LIMIT 1`,
    )
    .bind(LEGACY_TENANT_ID, scope.tenantId, scope.lineAccountId)
    .first<SupportMark>();
  if (visible) return;

  const rows = [
    { suffix: 'untouched', name: '未対応', color: '#F59E0B', default: 1, inbound: 1, order: 0 },
    { suffix: 'working', name: '対応中', color: '#3B82F6', default: 0, inbound: 0, order: 1 },
    { suffix: 'done', name: '解決済', color: '#10B981', default: 0, inbound: 0, order: 2 },
  ];
  const statements = [];
  for (const row of rows) {
    const id = `mark_${row.suffix}_${scope.lineAccountId}`;
    const now = jstNow();
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO support_marks
             (id, name, color, is_default, auto_on_inbound, display_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, row.name, row.color, row.default, row.inbound, row.order, now),
      db
        .prepare(
          `INSERT OR IGNORE INTO support_mark_scopes
             (mark_id, tenant_id, line_account_id, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(id, scope.tenantId, scope.lineAccountId, now),
    );
  }
  await db.batch(statements);
}

export async function getSupportMarks(
  db: D1Database,
  scope: SupportMarkScope,
): Promise<SupportMark[]> {
  await ensureDefaultSupportMarks(db, scope);
  const result = await db
    .prepare(
      `${MARK_SELECT}
        WHERE COALESCE(sms.tenant_id, ?) = ?
          AND (sms.line_account_id = ? OR sms.line_account_id IS NULL)
        ORDER BY CASE WHEN sms.line_account_id = ? THEN 0 ELSE 1 END,
                 sm.display_order ASC, sm.created_at ASC`,
    )
    .bind(LEGACY_TENANT_ID, scope.tenantId, scope.lineAccountId, scope.lineAccountId)
    .all<SupportMark>();
  const hasAccountDefault = result.results.some(
    (mark) => mark.line_account_id === scope.lineAccountId && mark.is_default === 1,
  );
  return result.results.map((mark) =>
    hasAccountDefault && mark.line_account_id === null && mark.is_default === 1
      ? { ...mark, is_default: 0 }
      : mark,
  );
}

export async function getSupportMarkById(
  db: D1Database,
  id: string,
  scope: SupportMarkScope,
): Promise<SupportMark | null> {
  return db
    .prepare(
      `${MARK_SELECT}
        WHERE sm.id = ?
          AND COALESCE(sms.tenant_id, ?) = ?
          AND (sms.line_account_id = ? OR sms.line_account_id IS NULL)`,
    )
    .bind(id, LEGACY_TENANT_ID, scope.tenantId, scope.lineAccountId)
    .first<SupportMark>();
}

/**
 * 既定のマーク。新しい友だちに最初に付く。
 *
 * is_default が複数ある場合は並び順の先頭を採る。1行だけにする決まりだが、
 * 壊れていても動きが止まらない方がよい。
 */
export async function getDefaultSupportMark(
  db: D1Database,
  scope: SupportMarkScope,
): Promise<SupportMark | null> {
  await ensureDefaultSupportMarks(db, scope);
  return db
    .prepare(
      `${MARK_SELECT}
        WHERE sm.is_default = 1
          AND COALESCE(sms.tenant_id, ?) = ?
          AND (sms.line_account_id = ? OR sms.line_account_id IS NULL)
        ORDER BY CASE WHEN sms.line_account_id = ? THEN 0 ELSE 1 END,
                 sm.display_order ASC
        LIMIT 1`,
    )
    .bind(LEGACY_TENANT_ID, scope.tenantId, scope.lineAccountId, scope.lineAccountId)
    .first<SupportMark>();
}

export async function createSupportMark(
  db: D1Database,
  scope: SupportMarkScope,
  input: {
    name: string;
    color?: string;
    isDefault?: boolean;
    autoOnInbound?: boolean;
    displayOrder?: number;
  },
): Promise<SupportMark> {
  const id = crypto.randomUUID();
  if (input.isDefault) {
    await db
      .prepare(
        `UPDATE support_marks SET is_default = 0
          WHERE id IN (
            SELECT mark_id FROM support_mark_scopes
             WHERE tenant_id = ? AND line_account_id = ?
          )`,
      )
      .bind(scope.tenantId, scope.lineAccountId)
      .run();
  }
  const now = jstNow();
  await db.batch([
    db
      .prepare(
        `INSERT INTO support_marks
           (id, name, color, is_default, auto_on_inbound, display_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.name,
        input.color ?? '#94A3B8',
        input.isDefault ? 1 : 0,
        input.autoOnInbound ? 1 : 0,
        input.displayOrder ?? 0,
        now,
      ),
    db
      .prepare(
        `INSERT INTO support_mark_scopes (mark_id, tenant_id, line_account_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(id, scope.tenantId, scope.lineAccountId, now),
  ]);
  return (await getSupportMarkById(db, id, scope))!;
}

export async function updateSupportMark(
  db: D1Database,
  id: string,
  scope: SupportMarkScope,
  input: {
    name?: string;
    color?: string;
    isDefault?: boolean;
    autoOnInbound?: boolean;
    displayOrder?: number;
  },
): Promise<SupportMark | null> {
  const existing = await getSupportMarkById(db, id, scope);
  if (!existing) return null;

  // 移行前の共通マークは選択中アカウントへ複製し、そのアカウントの
  // 友だちだけを付け替える。他アカウントの表示や設定は変えない。
  if (existing.is_inherited === 1) {
    const cloned = await createSupportMark(db, scope, {
      name: input.name ?? existing.name,
      color: input.color ?? existing.color,
      isDefault: input.isDefault ?? Boolean(existing.is_default),
      autoOnInbound: input.autoOnInbound ?? Boolean(existing.auto_on_inbound),
      displayOrder: input.displayOrder ?? existing.display_order,
    });
    await db
      .prepare(
        `UPDATE friends SET support_mark_id = ?
          WHERE support_mark_id = ? AND line_account_id = ?`,
      )
      .bind(cloned.id, existing.id, scope.lineAccountId)
      .run();
    return cloned;
  }

  if (input.isDefault === true) {
    await db
      .prepare(
        `UPDATE support_marks SET is_default = 0
          WHERE id != ? AND id IN (
            SELECT mark_id FROM support_mark_scopes
             WHERE tenant_id = ? AND line_account_id = ?
          )`,
      )
      .bind(id, scope.tenantId, scope.lineAccountId)
      .run();
  }
  const sets: string[] = [];
  const values: unknown[] = [];
  const put = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    values.push(v);
  };
  if (input.name !== undefined) put('name', input.name);
  if (input.color !== undefined) put('color', input.color);
  if (input.isDefault !== undefined) put('is_default', input.isDefault ? 1 : 0);
  if (input.autoOnInbound !== undefined) put('auto_on_inbound', input.autoOnInbound ? 1 : 0);
  if (input.displayOrder !== undefined) put('display_order', input.displayOrder);
  if (sets.length > 0) {
    values.push(id, scope.tenantId, scope.lineAccountId);
    await db
      .prepare(
        `UPDATE support_marks SET ${sets.join(', ')}
          WHERE id = ? AND id IN (
            SELECT mark_id FROM support_mark_scopes
             WHERE tenant_id = ? AND line_account_id = ?
          )`,
      )
      .bind(...values)
      .run();
  }
  return getSupportMarkById(db, id, scope);
}

export async function deleteSupportMark(
  db: D1Database,
  id: string,
  scope: SupportMarkScope,
): Promise<boolean> {
  const result = await db.batch([
    db
      .prepare(
        `DELETE FROM support_mark_scopes
          WHERE mark_id = ? AND tenant_id = ? AND line_account_id = ?`,
      )
      .bind(id, scope.tenantId, scope.lineAccountId),
    db
      .prepare(
        `DELETE FROM support_marks WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM support_mark_scopes WHERE mark_id = ?)`,
      )
      .bind(id, id),
  ]);
  return Number(result[1]?.meta?.changes ?? 0) > 0;
}

/**
 * 使用中の対応マークを初期値へ置き換えてから削除する。
 *
 * 先に削除すると外部キーの ON DELETE SET NULL で絞り込みから漏れるため、
 * 変更履歴・置換・削除を D1 の1バッチ（1トランザクション）にまとめる。
 */
export async function replaceAndDeleteSupportMark(
  db: D1Database,
  markId: string,
  replacementMarkId: string,
  scope: SupportMarkScope,
  actorId?: string | null,
): Promise<number> {
  if (markId === replacementMarkId) {
    throw new Error('Replacement support mark must be different');
  }
  const [mark, replacement] = await Promise.all([
    getSupportMarkById(db, markId, scope),
    getSupportMarkById(db, replacementMarkId, scope),
  ]);
  // 削除対象は選択中アカウント専用だけ。置換先も同じアカウントから
  // 見えるマークに限定し、別アカウントのIDを直接指定しても更新しない。
  if (!mark || mark.is_inherited === 1 || !replacement) return 0;

  const detail = JSON.stringify({
    previousMarkId: markId,
    replacementMarkId,
    reason: 'deleted_mark_replacement',
  });
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO operation_audit
           (id, target_kind, target_id, action, actor_id, friend_id, detail_json)
         SELECT lower(hex(randomblob(16))), 'support_mark', ?, 'changed', ?, id, ?
           FROM friends
          WHERE support_mark_id = ? AND line_account_id = ?`,
      )
      .bind(replacementMarkId, actorId ?? null, detail, markId, scope.lineAccountId),
    db
      .prepare(
        `UPDATE friends SET support_mark_id = ?
          WHERE support_mark_id = ? AND line_account_id = ?`,
      )
      .bind(replacementMarkId, markId, scope.lineAccountId),
    db
      .prepare(
        `DELETE FROM support_mark_scopes
          WHERE mark_id = ? AND tenant_id = ? AND line_account_id = ?`,
      )
      .bind(markId, scope.tenantId, scope.lineAccountId),
    db.prepare(`DELETE FROM support_marks WHERE id = ?`).bind(markId),
  ]);

  return Number(results[1]?.meta?.changes ?? 0);
}

/** そのマークが付いている友だちの数。削除前の確認に使う。 */
export async function countFriendsWithMark(
  db: D1Database,
  markId: string,
  scope: SupportMarkScope,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM friends
        WHERE support_mark_id = ? AND line_account_id = ?`,
    )
    .bind(markId, scope.lineAccountId)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

export async function countSupportMarkOperationalReferences(
  db: D1Database,
  markId: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM (
      ${SUPPORT_MARK_REFERENCE_SELECTS.join('\nUNION ALL\n')}
    ) references_found`)
    .bind(...referenceBindings(markId))
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

export async function getSupportMarkDeleteImpact(
  db: D1Database,
  markId: string,
  scope: SupportMarkScope,
): Promise<SupportMarkDeleteImpact | null> {
  const mark = await getSupportMarkById(db, markId, scope);
  if (!mark) return null;

  const [friendCount, replacementMark, operationalReferenceCount] = await Promise.all([
    countFriendsWithMark(db, markId, scope),
    getDefaultSupportMark(db, scope),
    countSupportMarkOperationalReferences(db, markId),
  ]);
  const usableReplacement = replacementMark?.id === markId ? null : replacementMark;
  const blockers: SupportMarkDeleteBlocker[] = [];
  if (mark.is_default === 1) blockers.push('default_mark');
  if (mark.is_inherited === 1) blockers.push('inherited_mark');
  if (!usableReplacement) blockers.push('replacement_missing');
  if (operationalReferenceCount > 0) blockers.push('operational_references');

  return {
    mark: {
      id: mark.id,
      name: mark.name,
      color: mark.color,
      isDefault: mark.is_default === 1,
      isInherited: mark.is_inherited === 1,
      autoOnInbound: mark.auto_on_inbound === 1,
    },
    friendCount,
    replacementMark: usableReplacement
      ? { id: usableReplacement.id, name: usableReplacement.name, color: usableReplacement.color }
      : null,
    operationalReferenceCount,
    automaticRuleStops: mark.auto_on_inbound === 1,
    blockers,
    canDelete: blockers.length === 0,
    revision: buildSupportMarkDeleteRevision({
      mark,
      friendCount,
      replacementMark: usableReplacement,
      operationalReferenceCount,
    }),
  };
}

export type DeleteSupportMarkAtImpactResult =
  | { status: 'deleted'; replacedFriendCount: number }
  | { status: 'stale' };

/**
 * 画面で確認した影響が変わっていないときだけ、付け替えと削除を1バッチで行う。
 * 最初の監査行が条件付きのゲートになり、人数・設定・参照のどれかが変われば
 * 後続の UPDATE / DELETE は1件も実行されない。
 */
export async function deleteSupportMarkAtImpact(
  db: D1Database,
  impact: SupportMarkDeleteImpact,
  scope: SupportMarkScope,
  actorId?: string | null,
): Promise<DeleteSupportMarkAtImpactResult> {
  const replacement = impact.replacementMark;
  if (!impact.canDelete || !replacement) return { status: 'stale' };

  const auditId = crypto.randomUUID();
  const detail = JSON.stringify({
    previousMarkId: impact.mark.id,
    replacementMarkId: replacement.id,
    friendCount: impact.friendCount,
    reason: 'deleted_mark_replacement',
    revision: impact.revision,
  });
  const gateSql = `
    EXISTS (
      SELECT 1
        FROM support_marks sm
        JOIN support_mark_scopes sms ON sms.mark_id = sm.id
       WHERE sm.id = ?
         AND sms.tenant_id = ? AND sms.line_account_id = ?
         AND sm.name = ? AND sm.color = ?
         AND sm.is_default = 0 AND sm.auto_on_inbound = ?
    )
    AND (SELECT COUNT(*) FROM support_mark_scopes WHERE mark_id = ?) = 1
    AND EXISTS (
      SELECT 1
        FROM support_marks sm
        LEFT JOIN support_mark_scopes sms ON sms.mark_id = sm.id
       WHERE sm.id = ? AND sm.is_default = 1
         AND COALESCE(sms.tenant_id, ?) = ?
         AND (sms.line_account_id = ? OR sms.line_account_id IS NULL)
    )
    AND (SELECT COUNT(*) FROM friends
          WHERE support_mark_id = ? AND line_account_id = ?) = ?
    AND NOT ${SUPPORT_MARK_REFERENCE_EXISTS_SQL}`;
  const gateBindings = [
    impact.mark.id,
    scope.tenantId,
    scope.lineAccountId,
    impact.mark.name,
    impact.mark.color,
    impact.mark.autoOnInbound ? 1 : 0,
    impact.mark.id,
    replacement.id,
    LEGACY_TENANT_ID,
    scope.tenantId,
    scope.lineAccountId,
    impact.mark.id,
    scope.lineAccountId,
    impact.friendCount,
    ...referenceBindings(impact.mark.id),
  ];

  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO operation_audit
           (id, target_kind, target_id, action, actor_id, detail_json)
         SELECT ?, 'support_mark', ?, 'deleted', ?, ? WHERE ${gateSql}`,
      )
      .bind(auditId, impact.mark.id, actorId ?? null, detail, ...gateBindings),
    db
      .prepare(
        `INSERT INTO operation_audit
           (id, target_kind, target_id, action, actor_id, friend_id, detail_json)
         SELECT lower(hex(randomblob(16))), 'support_mark', ?, 'changed', ?, id, ?
           FROM friends
          WHERE support_mark_id = ? AND line_account_id = ?
            AND EXISTS (SELECT 1 FROM operation_audit WHERE id = ?)`,
      )
      .bind(replacement.id, actorId ?? null, detail, impact.mark.id, scope.lineAccountId, auditId),
    db
      .prepare(
        `UPDATE friends SET support_mark_id = ?
          WHERE support_mark_id = ? AND line_account_id = ?
            AND EXISTS (SELECT 1 FROM operation_audit WHERE id = ?)`,
      )
      .bind(replacement.id, impact.mark.id, scope.lineAccountId, auditId),
    db
      .prepare(
        `DELETE FROM support_mark_scopes
          WHERE mark_id = ? AND tenant_id = ? AND line_account_id = ?
            AND EXISTS (SELECT 1 FROM operation_audit WHERE id = ?)`,
      )
      .bind(impact.mark.id, scope.tenantId, scope.lineAccountId, auditId),
    db
      .prepare(
        `DELETE FROM support_marks WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM support_mark_scopes WHERE mark_id = ?)
          AND EXISTS (SELECT 1 FROM operation_audit WHERE id = ?)`,
      )
      .bind(impact.mark.id, impact.mark.id, auditId),
  ]);

  if (Number(results[0]?.meta?.changes ?? 0) === 0) return { status: 'stale' };
  return { status: 'deleted', replacedFriendCount: Number(results[2]?.meta?.changes ?? 0) };
}

export async function setFriendSupportMark(
  db: D1Database,
  friendId: string,
  markId: string | null,
  scope: SupportMarkScope,
  actorId?: string | null,
): Promise<boolean> {
  if (markId && !(await getSupportMarkById(db, markId, scope))) return false;
  const result = await db
    .prepare(
      `UPDATE friends SET support_mark_id = ?
        WHERE id = ? AND line_account_id = ?`,
    )
    .bind(markId, friendId, scope.lineAccountId)
    .run();
  if (Number(result.meta?.changes ?? 0) === 0) return false;

  // いつ変わったかを残す（110）。friends.support_mark_id は現在値しか
  // 持たないので、これが無いと設計の「過去7日で対応済にした人数」が出せない。
  await recordOperation(db, {
    targetKind: 'support_mark',
    targetId: markId,
    action: 'changed',
    actorId: actorId ?? null,
    friendId,
  });
  return true;
}

/**
 * 複数人にまとめて付ける。
 *
 * 1件ずつ UPDATE を投げると人数ぶん往復する。D1 は IN 句で1回に収まる。
 */
export async function setFriendSupportMarkBulk(
  db: D1Database,
  friendIds: string[],
  markId: string | null,
  scope: SupportMarkScope,
): Promise<number> {
  if (friendIds.length === 0) return 0;
  if (markId && !(await getSupportMarkById(db, markId, scope))) return 0;
  let changes = 0;
  for (let offset = 0; offset < friendIds.length; offset += 90) {
    const chunk = friendIds.slice(offset, offset + 90);
    const placeholders = chunk.map(() => '?').join(',');
    const result = await db
      .prepare(
        `UPDATE friends SET support_mark_id = ?
          WHERE line_account_id = ? AND id IN (${placeholders})`,
      )
      .bind(markId, scope.lineAccountId, ...chunk)
      .run();
    changes += result.meta?.changes ?? 0;
  }
  return changes;
}

/**
 * 受信したときに自動で付けるマークへ寄せる。
 *
 * 設定が無ければ何もしない。「受信したら必ず未対応に戻す」を既定に
 * すると、解決済みにしたそばから戻ってしまう運用もあるため、
 * auto_on_inbound を立てたマークがあるときだけ動かす。
 */
export async function applyInboundSupportMark(
  db: D1Database,
  friendId: string,
): Promise<boolean> {
  const friendScope = await db
    .prepare(
      `SELECT f.line_account_id AS lineAccountId, la.tenant_id AS tenantId
         FROM friends f
         JOIN line_accounts la ON la.id = f.line_account_id
        WHERE f.id = ?`,
    )
    .bind(friendId)
    .first<{ lineAccountId: string; tenantId: string }>();
  if (!friendScope) return false;
  const scope = { tenantId: friendScope.tenantId, lineAccountId: friendScope.lineAccountId };
  await ensureDefaultSupportMarks(db, scope);
  const mark = await db
    .prepare(
      `${MARK_SELECT}
        WHERE sm.auto_on_inbound = 1
          AND COALESCE(sms.tenant_id, ?) = ?
          AND (sms.line_account_id = ? OR sms.line_account_id IS NULL)
        ORDER BY CASE WHEN sms.line_account_id = ? THEN 0 ELSE 1 END,
                 sm.display_order ASC
        LIMIT 1`,
    )
    .bind(LEGACY_TENANT_ID, scope.tenantId, scope.lineAccountId, scope.lineAccountId)
    .first<SupportMark>();
  if (!mark) return false;
  return setFriendSupportMark(db, friendId, mark.id, scope);
}
