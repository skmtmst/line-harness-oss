import { jstNow } from './utils.js';
import { enqueueMileageEvent } from './mileage.js';
export interface Tag {
  id: string;
  name: string;
  color: string;
  /**
   * @deprecated 099 で folders へ移送済み。folder_id を見ること。
   * 追加のみポリシーで列を落とせないため残っているだけで、読み書きしない。
   */
  group_id: string | null;
  /** 所属する分類。folders(kind='tag') の id */
  folder_id: string | null;
  mileage_reward: number;
  referral_mileage_reward: number;
  mileage_multiplier_bps: number | null;
  mileage_multiplier_priority: number;
  /** 友だち一覧の「★つきタグ」列に出すか。0 / 1（111 で追加） */
  is_starred: number;
  /** 一覧での並び順。小さいほど上（112 で追加） */
  display_order: number;
  created_at: string;
  /**
   * 属するフォルダの色（#RRGGBB）。folders.color を読んだもので、tags 側に
   * 保存はしない。
   *
   * 画面に出す印の色はこれ。タグ1つずつに色を持たせると、100枚あるタグで
   * 色がばらけて一覧での区別に使えなくなる。色はフォルダに1つだけ付けて、
   * 中のタグはそれを写す。JOIN していない読み方では undefined になる。
   */
  folder_color?: string | null;
}

/**
 * タグの分類。
 *
 * 099 で folders(kind='tag') へ移送した。形は変えずに、中で見るテーブルだけ
 * 差し替えている（画面とAPIの経路はそのまま）。sort_order は
 * folders.display_order を写したもの。
 */
export interface TagGroup {
  id: string;
  name: string;
  sort_order: number;
  /** #RRGGBB。未設定は null。115 で folders.color を足した。 */
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface FriendTag {
  friend_id: string;
  tag_id: string;
  assigned_at: string;
}

export async function getTags(db: D1Database): Promise<Tag[]> {
  const result = await db
    .prepare(
      `SELECT t.*, fo.color AS folder_color
       FROM tags t
       LEFT JOIN folders fo ON fo.id = t.folder_id
       ORDER BY t.name ASC`,
    )
    .all<Tag>();
  return result.results;
}

export interface TagWithCount extends Tag {
  friend_count: number;
}

export async function getTagsWithCounts(
  db: D1Database,
): Promise<TagWithCount[]> {
  const result = await db
    .prepare(
      `SELECT t.*, fo.color AS folder_color, COUNT(ft.friend_id) AS friend_count
       FROM tags t
       LEFT JOIN friend_tags ft ON ft.tag_id = t.id
       LEFT JOIN folders fo ON fo.id = t.folder_id
       GROUP BY t.id
       -- 入れ替えたものが先。触っていないものは全部 0 なので、
       -- そのあとの付与人数と名前で並ぶ（設計の既定は付与人数が多い順）。
       ORDER BY t.display_order ASC, friend_count DESC, t.name ASC`,
    )
    .all<TagWithCount>();
  return result.results;
}

export interface CreateTagInput {
  name: string;
  color?: string;
  groupId?: string | null;
}

export async function createTag(
  db: D1Database,
  input: CreateTagInput,
): Promise<Tag> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const color = input.color ?? '#3B82F6';

  await db
    .prepare(
      // group_id は書かない。folders が正で、group_id は移送前の名残。
      `INSERT INTO tags (id, name, color, folder_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, input.name, color, input.groupId ?? null, now)
    .run();

  return (await db
    .prepare(`SELECT * FROM tags WHERE id = ?`)
    .bind(id)
    .first<Tag>())!;
}

/**
 * タグの所属分類を変える。null で「未分類」に戻す。
 *
 * 名前や色の変更と分けているのは、分類の付け替えが一覧の画面から
 * 一括で行われる操作で、名前の編集とは使われ方が違うため。
 */
export async function assignTagToGroup(
  db: D1Database,
  id: string,
  groupId: string | null,
): Promise<Tag | null> {
  await db
    .prepare(`UPDATE tags SET folder_id = ? WHERE id = ?`)
    .bind(groupId, id)
    .run();
  return (
    (await db.prepare(`SELECT * FROM tags WHERE id = ?`).bind(id).first<Tag>()) ??
    null
  );
}

/**
 * タグの名前と色を変える。
 *
 * 一覧の表からマイルの列を外して編集画面へ移したときに要るようになった。
 * それまでは作るときにしか決められず、打ち間違えたタグは消して作り直す
 * しかなかった。作り直すと、付いていた友だちの分がすべて外れる。
 *
 * 渡されたものだけ当てる。色だけ変えたいときに名前を送らせると、
 * 呼ぶ側が現在値を読んでから書くことになり、その間に別の人が変えた
 * 名前を上書きしてしまう。
 */
export async function updateTag(
  db: D1Database,
  id: string,
  input: { name?: string; color?: string; isStarred?: boolean },
): Promise<Tag | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    binds.push(input.name);
  }
  if (input.color !== undefined) {
    sets.push('color = ?');
    binds.push(input.color);
  }
  if (input.isStarred !== undefined) {
    sets.push('is_starred = ?');
    binds.push(input.isStarred ? 1 : 0);
  }
  if (sets.length > 0) {
    await db
      .prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds, id)
      .run();
  }
  return (
    (await db.prepare(`SELECT * FROM tags WHERE id = ?`).bind(id).first<Tag>()) ?? null
  );
}

/**
 * 並び順をまとめて書く。
 *
 * 1件ずつ当てると、10件動かしたときに10往復する。その途中で誰かが
 * 一覧を開くと、半分だけ入れ替わった並びが見える。まとめて送る。
 *
 * 渡された順に 0,1,2… を振る。画面で見えている並びをそのまま写す形なので、
 * 抜けや重複を気にしなくてよい。
 */
export async function reorderTags(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(
    ids.map((id, i) =>
      db.prepare(`UPDATE tags SET display_order = ? WHERE id = ?`).bind(i, id),
    ),
  );
}

export async function deleteTag(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM tags WHERE id = ?`).bind(id).run();
}

// --- タグの親分類 -----------------------------------------------------------
//
// 「お悩み」「ペット」のような分類でタグをまとめる。分類は入れ子にしない。
// 二段で足りることが分かっているし、階層を許すと画面もクエリも一気に複雑になる。

export async function getTagGroups(db: D1Database): Promise<TagGroup[]> {
  const result = await db
    .prepare(
      `SELECT id, name, display_order AS sort_order, color, created_at, updated_at
         FROM folders WHERE kind = 'tag'
        ORDER BY display_order ASC, name ASC`,
    )
    .all<TagGroup>();
  return result.results;
}

export async function createTagGroup(
  db: D1Database,
  input: { name: string; sortOrder?: number; color?: string | null },
): Promise<TagGroup> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO folders (id, kind, name, display_order, color, created_at, updated_at)
       VALUES (?, 'tag', ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.name, input.sortOrder ?? 0, input.color ?? null, now, now)
    .run();
  return (await db
    .prepare(
      `SELECT id, name, display_order AS sort_order, color, created_at, updated_at
         FROM folders WHERE id = ?`,
    )
    .bind(id)
    .first<TagGroup>())!;
}

export async function updateTagGroup(
  db: D1Database,
  id: string,
  input: { name?: string; sortOrder?: number; color?: string | null },
): Promise<TagGroup | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    values.push(input.name);
  }
  if (input.sortOrder !== undefined) {
    sets.push('display_order = ?');
    values.push(input.sortOrder);
  }
  if (input.color !== undefined) {
    sets.push('color = ?');
    values.push(input.color);
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    values.push(jstNow(), id);
    await db
      .prepare(`UPDATE folders SET ${sets.join(', ')} WHERE id = ? AND kind = 'tag'`)
      .bind(...values)
      .run();
  }
  return (
    (await db
      .prepare(
        `SELECT id, name, display_order AS sort_order, color, created_at, updated_at
           FROM folders WHERE id = ? AND kind = 'tag'`,
      )
      .bind(id)
      .first<TagGroup>()) ?? null
  );
}

/**
 * 分類を消す。属していたタグは消さず「未分類」に戻る
 * （tags.folder_id は ON DELETE SET NULL）。
 *
 * 分類は入れ物であって、タグそのものではない。入れ物を捨てたら中身も
 * 捨てる、では友だちに付いたタグまで巻き込まれる。
 */
export async function deleteTagGroup(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM folders WHERE id = ? AND kind = 'tag'`).bind(id).run();
}

export async function addTagToFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<boolean> {
  const now = jstNow();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at)
       VALUES (?, ?, ?)`,
    )
    .bind(friendId, tagId, now)
    .run();
  const added = (result.meta?.changes ?? 0) > 0;
  if (added) {
    try {
      await enqueueMileageEvent(db, {
        eventType: 'tag_added',
        source: 'tag',
        sourceEventId: `${friendId}:${tagId}:${now}`,
        friendId,
        subjectKey: tagId,
        metadata: { tagId },
        occurredAt: now,
      });
    } catch (error) {
      console.error('tag mileage enqueue failed:', error);
    }
  }
  return added;
}

export async function updateTagMileageSettings(
  db: D1Database,
  tagId: string,
  input: {
    rewardMiles: number;
    referralRewardMiles: number;
    multiplierBps: number | null;
    multiplierPriority: number;
  },
): Promise<Tag | null> {
  await db
    .prepare(
      `UPDATE tags
          SET mileage_reward = ?, referral_mileage_reward = ?,
              mileage_multiplier_bps = ?, mileage_multiplier_priority = ?
        WHERE id = ?`,
    )
    .bind(
      input.rewardMiles,
      input.referralRewardMiles,
      input.multiplierBps,
      input.multiplierPriority,
      tagId,
    )
    .run();
  return db.prepare(`SELECT * FROM tags WHERE id = ?`).bind(tagId).first<Tag>();
}

/**
 * When an administrator enables a reward on an existing tag, normalize its
 * historic assignments into the same queue. INSERT OR IGNORE plus ledger
 * idempotency makes repeated saves safe.
 */
export async function enqueueHistoricTagMileage(
  db: D1Database,
  tagId: string,
): Promise<number> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT OR IGNORE INTO engagement_events
         (id, program_id, idempotency_key, event_type, source, source_event_id,
          actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
       SELECT 'tag-event:' || ft.friend_id || ':' || ft.tag_id,
              'default', 'tag:' || ft.friend_id || ':' || ft.tag_id || ':' || ft.assigned_at,
              'tag_added', 'tag', ft.friend_id || ':' || ft.tag_id || ':' || ft.assigned_at,
              f.user_id, ft.friend_id,
              json_object('tagId', ft.tag_id, 'subjectKey', ft.tag_id, 'backfilled', 1),
              ft.assigned_at, ?
         FROM friend_tags ft
         JOIN friends f ON f.id = ft.friend_id
        WHERE ft.tag_id = ?`,
    )
    .bind(now, tagId)
    .run();

  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO mileage_event_queue
         (engagement_event_id, status, attempts, available_at, created_at, updated_at)
       SELECT ee.id, 'pending', 0, ?, ?, ?
         FROM engagement_events ee
        WHERE ee.event_type = 'tag_added'
          AND ee.source = 'tag'
          AND json_extract(ee.metadata, '$.tagId') = ?`,
    )
    .bind(now, now, now, tagId)
    .run();

  const reset = await db
    .prepare(
      `UPDATE mileage_event_queue
          SET status = 'pending', attempts = 0, available_at = ?,
              processing_started_at = NULL, processed_at = NULL,
              last_error = NULL, updated_at = ?
        WHERE engagement_event_id IN (
          SELECT ee.id
            FROM engagement_events ee
            JOIN tags t ON t.id = json_extract(ee.metadata, '$.tagId')
           WHERE ee.event_type = 'tag_added'
             AND ee.source = 'tag'
             AND t.id = ?
             AND (
               (t.mileage_reward > 0 AND NOT EXISTS (
                 SELECT 1 FROM mileage_ledger ml
                  WHERE ml.engagement_event_id = ee.id AND ml.source = 'tag'
               ))
               OR
               (t.referral_mileage_reward > 0 AND NOT EXISTS (
                 SELECT 1 FROM mileage_ledger ml
                  WHERE ml.engagement_event_id = ee.id AND ml.source = 'tag_referral'
               ))
             )
        )
          AND status IN ('processed', 'failed')`,
    )
    .bind(now, now, tagId)
    .run();
  return (inserted.meta?.changes ?? 0) + (reset.meta?.changes ?? 0);
}

export async function removeTagFromFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM friend_tags WHERE friend_id = ? AND tag_id = ?`,
    )
    .bind(friendId, tagId)
    .run();
}

export async function getFriendTags(
  db: D1Database,
  friendId: string,
): Promise<Tag[]> {
  const result = await db
    .prepare(
      `SELECT t.*, fo.color AS folder_color
       FROM tags t
       INNER JOIN friend_tags ft ON ft.tag_id = t.id
       LEFT JOIN folders fo ON fo.id = t.folder_id
       WHERE ft.friend_id = ?
       ORDER BY t.name ASC`,
    )
    .bind(friendId)
    .all<Tag>();
  return result.results;
}

import type { Friend } from './friends';

export async function getFriendsByTag(
  db: D1Database,
  tagId: string,
): Promise<Friend[]> {
  const result = await db
    .prepare(
      `SELECT f.*
       FROM friends f
       INNER JOIN friend_tags ft ON ft.friend_id = f.id
       WHERE ft.tag_id = ?
       ORDER BY f.created_at DESC`,
    )
    .bind(tagId)
    .all<Friend>();
  return result.results;
}
