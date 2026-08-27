import { recordOperation } from './operation-audit.js';
import { jstNow } from './utils.js';

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
}

export interface SupportMarkWithUsage extends SupportMark {
  friend_count: number;
  broadcasts: number;
  scenarios: number;
  auto_replies: number;
  saved_searches: number;
  automations: number;
}

/**
 * 初期の3マークを用意する。
 *
 * マイグレーション 100 にも同じ INSERT があるが、それだけでは足りない。
 * bootstrap.sql は sqlite_master から DDL だけを取り出して作るので、
 * マイグレーションに書いた行は新規インストールに届かない。
 * 「既存環境は更新で入るが、新しく入れた環境だけマークが1つも無い」
 * という形の壊れ方になる。
 *
 * INSERT OR IGNORE と固定の id なので、何度呼んでも増えない。
 */
export async function ensureDefaultSupportMarks(db: D1Database): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO support_marks
         (id, name, color, is_default, auto_on_inbound, display_order, created_at)
       VALUES
         ('mark_untouched','未対応','#F59E0B',1,1,0,?),
         ('mark_working','対応中','#3B82F6',0,0,1,?),
         ('mark_done','解決済','#10B981',0,0,2,?)`,
    )
    .bind(jstNow(), jstNow(), jstNow())
    .run();
}

export async function getSupportMarks(db: D1Database): Promise<SupportMark[]> {
  await ensureDefaultSupportMarks(db);
  const result = await db
    .prepare(`SELECT * FROM support_marks ORDER BY display_order ASC, created_at ASC`)
    .all<SupportMark>();
  return result.results;
}

/**
 * 一覧用の対応マークと参照数を1回で読む。
 *
 * 画面で「配信・自動応答」と固定表示すると、実際には使っていないマークまで
 * 使用中に見える。逆に1件ずつ数えるとN+1になるため、JSON条件も含めて
 * 相関サブクエリでまとめて返す。実行履歴は現在の使用先ではないため数えない。
 */
export async function getSupportMarksWithUsage(db: D1Database): Promise<SupportMarkWithUsage[]> {
  await ensureDefaultSupportMarks(db);
  const result = await db.prepare(
    `SELECT sm.*,
       (SELECT COUNT(*) FROM friends f WHERE f.support_mark_id = sm.id) AS friend_count,
       (SELECT COUNT(*) FROM broadcasts b WHERE EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(b.segment_conditions)
                                       THEN b.segment_conditions ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
        )) AS broadcasts,
       (SELECT COUNT(DISTINCT a.scenario_id) FROM scenario_actions a WHERE
          (a.action_type = 'support_mark' AND EXISTS (
            SELECT 1 FROM json_tree(CASE WHEN json_valid(a.config_json)
                                         THEN a.config_json ELSE 'null' END) j
             WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
          )) OR EXISTS (
            SELECT 1 FROM json_tree(CASE WHEN json_valid(a.condition_json)
                                         THEN a.condition_json ELSE 'null' END) j
             WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
          )
        ) AS scenarios,
       (SELECT COUNT(*) FROM auto_replies a WHERE EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(a.actions_json)
                                       THEN a.actions_json ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
        ) OR EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(a.friend_conditions_json)
                                       THEN a.friend_conditions_json ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
        )) AS auto_replies,
       (SELECT COUNT(*) FROM saved_searches s WHERE EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(s.conditions_json)
                                       THEN s.conditions_json ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
        )) AS saved_searches,
       ((SELECT COUNT(*) FROM automations a WHERE EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(a.conditions)
                                       THEN a.conditions ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
        ) OR EXISTS (
          SELECT 1 FROM json_tree(CASE WHEN json_valid(a.actions)
                                       THEN a.actions ELSE 'null' END) j
           WHERE j.type = 'text' AND CAST(j.value AS TEXT) = sm.id
        )) +
        (SELECT COUNT(DISTINCT v.automation_id) FROM automation_versions v WHERE v.status = 'published' AND (
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
     FROM support_marks sm
    ORDER BY sm.display_order ASC, sm.created_at ASC`,
  ).all<SupportMarkWithUsage>();
  return result.results;
}

export async function getSupportMarkById(
  db: D1Database,
  id: string,
): Promise<SupportMark | null> {
  return db.prepare(`SELECT * FROM support_marks WHERE id = ?`).bind(id).first<SupportMark>();
}

/**
 * 既定のマーク。新しい友だちに最初に付く。
 *
 * is_default が複数ある場合は並び順の先頭を採る。1行だけにする決まりだが、
 * 壊れていても動きが止まらない方がよい。
 */
export async function getDefaultSupportMark(db: D1Database): Promise<SupportMark | null> {
  await ensureDefaultSupportMarks(db);
  return db
    .prepare(
      `SELECT * FROM support_marks WHERE is_default = 1 ORDER BY display_order ASC LIMIT 1`,
    )
    .first<SupportMark>();
}

export async function createSupportMark(
  db: D1Database,
  input: {
    name: string;
    color?: string;
    isDefault?: boolean;
    autoOnInbound?: boolean;
    displayOrder?: number;
  },
): Promise<SupportMark> {
  const id = crypto.randomUUID();
  // 既定は1つだけ。新しく既定にするなら、先に他を降ろす。
  if (input.isDefault) {
    await db.prepare(`UPDATE support_marks SET is_default = 0 WHERE is_default = 1`).run();
  }
  await db
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
      jstNow(),
    )
    .run();
  return (await getSupportMarkById(db, id))!;
}

export async function updateSupportMark(
  db: D1Database,
  id: string,
  input: {
    name?: string;
    color?: string;
    isDefault?: boolean;
    autoOnInbound?: boolean;
    displayOrder?: number;
  },
): Promise<SupportMark | null> {
  if (input.isDefault === true) {
    await db
      .prepare(`UPDATE support_marks SET is_default = 0 WHERE is_default = 1 AND id != ?`)
      .bind(id)
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
    values.push(id);
    await db
      .prepare(`UPDATE support_marks SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }
  return getSupportMarkById(db, id);
}

export async function deleteSupportMark(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM support_marks WHERE id = ?`).bind(id).run();
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
  actorId?: string | null,
): Promise<number> {
  if (markId === replacementMarkId) {
    throw new Error('Replacement support mark must be different');
  }

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
          WHERE support_mark_id = ?`,
      )
      .bind(replacementMarkId, actorId ?? null, detail, markId),
    db
      .prepare(`UPDATE friends SET support_mark_id = ? WHERE support_mark_id = ?`)
      .bind(replacementMarkId, markId),
    db.prepare(`DELETE FROM support_marks WHERE id = ?`).bind(markId),
  ]);

  return Number(results[1]?.meta?.changes ?? 0);
}

/** そのマークが付いている友だちの数。削除前の確認に使う。 */
export async function countFriendsWithMark(db: D1Database, markId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM friends WHERE support_mark_id = ?`)
    .bind(markId)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

export async function setFriendSupportMark(
  db: D1Database,
  friendId: string,
  markId: string | null,
  actorId?: string | null,
): Promise<void> {
  await db
    .prepare(`UPDATE friends SET support_mark_id = ? WHERE id = ?`)
    .bind(markId, friendId)
    .run();

  // いつ変わったかを残す（110）。friends.support_mark_id は現在値しか
  // 持たないので、これが無いと設計の「過去7日で対応済にした人数」が出せない。
  await recordOperation(db, {
    targetKind: 'support_mark',
    targetId: markId,
    action: 'changed',
    actorId: actorId ?? null,
    friendId,
  });
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
): Promise<number> {
  if (friendIds.length === 0) return 0;
  let changes = 0;
  for (let offset = 0; offset < friendIds.length; offset += 90) {
    const chunk = friendIds.slice(offset, offset + 90);
    const placeholders = chunk.map(() => '?').join(',');
    const result = await db
      .prepare(`UPDATE friends SET support_mark_id = ? WHERE id IN (${placeholders})`)
      .bind(markId, ...chunk)
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
  await ensureDefaultSupportMarks(db);
  const mark = await db
    .prepare(
      `SELECT id FROM support_marks WHERE auto_on_inbound = 1 ORDER BY display_order ASC LIMIT 1`,
    )
    .first<{ id: string }>();
  if (!mark) return false;
  await setFriendSupportMark(db, friendId, mark.id);
  return true;
}
