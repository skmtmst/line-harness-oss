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
  archived_at: string | null;
  /** NULL は移行前からあるテナント共通マーク。 */
  line_account_id: string | null;
  tenant_id: string;
  is_inherited: number;
}

export interface SupportMarkWithUsage extends SupportMark {
  friend_count: number;
  broadcasts: number;
  scenarios: number;
  auto_replies: number;
  saved_searches: number;
  automations: number;
}

const MARK_SELECT = `
  SELECT sm.id, sm.name, sm.color, sm.is_default, sm.auto_on_inbound,
         sm.display_order, sm.created_at, sm.archived_at,
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
        WHERE sm.archived_at IS NULL
          AND COALESCE(sms.tenant_id, ?) = ?
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
        WHERE sm.archived_at IS NULL
          AND COALESCE(sms.tenant_id, ?) = ?
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

/**
 * 一覧用の対応マークと参照数を1回で読む。
 *
 * 画面で「配信・自動応答」と固定表示すると、実際には使っていないマークまで
 * 使用中に見える。逆に1件ずつ数えるとN+1になるため、JSON条件も含めて
 * 相関サブクエリでまとめて返す。実行履歴は現在の使用先ではないため数えない。
 */
export async function getSupportMarksWithUsage(
  db: D1Database,
  scope: SupportMarkScope,
): Promise<SupportMarkWithUsage[]> {
  await ensureDefaultSupportMarks(db, scope);
  const result = await db.prepare(
    `WITH visible_marks AS (
       ${MARK_SELECT}
        WHERE sm.archived_at IS NULL
          AND COALESCE(sms.tenant_id, ?) = ?
          AND (sms.line_account_id = ? OR sms.line_account_id IS NULL)
     )
     SELECT sm.*,
       (SELECT COUNT(*) FROM friends f
         WHERE f.support_mark_id = sm.id AND f.line_account_id = ?) AS friend_count,
       (SELECT COUNT(*) FROM broadcasts b WHERE b.line_account_id = ? AND EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(b.segment_conditions)
                                       THEN b.segment_conditions ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
        )) AS broadcasts,
       (SELECT COUNT(DISTINCT a.scenario_id)
          FROM scenario_actions a
          JOIN scenarios sc ON sc.id = a.scenario_id
         WHERE sc.line_account_id = ? AND (
          (a.action_type = 'support_mark' AND EXISTS (
            SELECT 1 FROM json_tree(CASE WHEN json_valid(a.config_json)
                                         THEN a.config_json ELSE 'null' END) j
             WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
          )) OR EXISTS (
            SELECT 1 FROM json_tree(CASE WHEN json_valid(a.condition_json)
                                         THEN a.condition_json ELSE 'null' END) j
             WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
          )
        )) AS scenarios,
       (SELECT COUNT(*) FROM auto_replies a WHERE a.line_account_id = ? AND (EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(a.actions_json)
                                       THEN a.actions_json ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
        ) OR EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(a.friend_conditions_json)
                                       THEN a.friend_conditions_json ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
        ))) AS auto_replies,
       (SELECT COUNT(*) FROM saved_searches s WHERE s.line_account_id = ? AND EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(s.conditions_json)
                                       THEN s.conditions_json ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
        )) AS saved_searches,
       ((SELECT COUNT(*) FROM automations a WHERE a.line_account_id = ? AND (EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(a.conditions)
                                       THEN a.conditions ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
        ) OR EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(a.actions)
                                       THEN a.actions ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
        ))) +
        (SELECT COUNT(DISTINCT v.automation_id)
           FROM automation_versions v
           JOIN automation_definitions d ON d.id = v.automation_id
          WHERE v.status = 'published' AND d.line_account_id = ? AND (
          EXISTS (
            SELECT 1 FROM json_tree(CASE WHEN json_valid(v.condition_config)
                                         THEN v.condition_config ELSE 'null' END) j
             WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
          ) OR EXISTS (
            SELECT 1 FROM json_tree(CASE WHEN json_valid(v.action_config)
                                         THEN v.action_config ELSE 'null' END) j
             WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
          )
        ))) AS automations
       FROM visible_marks sm
      ORDER BY CASE WHEN sm.line_account_id = ? THEN 0 ELSE 1 END,
               sm.display_order ASC, sm.created_at ASC`,
  )
    .bind(
      LEGACY_TENANT_ID,
      scope.tenantId,
      scope.lineAccountId,
      scope.lineAccountId,
      scope.lineAccountId,
      scope.lineAccountId,
      scope.lineAccountId,
      scope.lineAccountId,
      scope.lineAccountId,
      scope.lineAccountId,
      scope.lineAccountId,
    )
    .all<SupportMarkWithUsage>();

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
          AND sm.archived_at IS NULL
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
          AND sm.archived_at IS NULL
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

/**
 * 対応マークを置換してから保管する。
 *
 * 公開済みの配信条件などは古いマークIDを参照し続けるため、物理削除しない。
 * 友だちの置換・友だちごとの履歴・保管記録を D1 の1バッチにまとめる。
 */
export async function replaceAndArchiveSupportMark(
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
  const usage = (await getSupportMarksWithUsage(db, scope)).find((row) => row.id === markId);
  const referenceCount = usage
    ? Number(usage.broadcasts)
      + Number(usage.scenarios)
      + Number(usage.auto_replies)
      + Number(usage.saved_searches)
      + Number(usage.automations)
    : 0;
  if (referenceCount > 0) {
    throw new Error('Referenced support mark cannot be archived');
  }

  const detail = JSON.stringify({
    previousMarkId: markId,
    replacementMarkId,
    reason: 'deleted_mark_replacement',
  });
  const archivedAt = jstNow();
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
        `UPDATE support_marks
            SET archived_at = ?, is_default = 0, auto_on_inbound = 0
          WHERE id = ? AND archived_at IS NULL`,
      )
      .bind(archivedAt, markId),
    db
      .prepare(
        `INSERT INTO operation_audit
           (id, target_kind, target_id, action, actor_id, friend_id, detail_json)
         VALUES (lower(hex(randomblob(16))), 'support_mark', ?, 'archived', ?, NULL, ?)`,
      )
      .bind(
        markId,
        actorId ?? null,
        JSON.stringify({ replacementMarkId, reason: 'stop_new_use' }),
      ),
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

export async function setFriendSupportMark(
  db: D1Database,
  friendId: string,
  markId: string | null,
  scope: SupportMarkScope,
  actorId?: string | null,
  detail?: Record<string, unknown> | null,
): Promise<boolean> {
  if (markId && !(await getSupportMarkById(db, markId, scope))) return false;
  const before = await db
    .prepare(`SELECT support_mark_id FROM friends WHERE id = ? AND line_account_id = ?`)
    .bind(friendId, scope.lineAccountId)
    .first<{ support_mark_id: string | null }>();
  if (!before) return false;
  if (before.support_mark_id === markId) return true;
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
    detail: {
      beforeMarkId: before.support_mark_id,
      afterMarkId: markId,
      ...(detail ?? {}),
    },
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
          AND sm.archived_at IS NULL
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
