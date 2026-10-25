import { jstCalendar as japanCalendar } from '@line-crm/shared';
import { logger } from '@line-crm/shared/server';
/** LINE 画像 URL の中央の本人固有部分はチャネルをまたいで一致するため、抽出して別アカウントの同じ本人を探し、重複タグを付ける。 */

import { URL_TOKEN_SQL } from '../lib/url-token.js';
import {
  addTagToFriend,
  findTagByNormalizedName,
  normalizeTagNameForCleanup,
} from '@line-crm/db';

interface DuplicateTagConfig {
  /** アカウントごとに付ける重複タグの ID。 */
  tagIds: Record<string, string>;
  /** タグの作成確認で使う名前と色。 */
  tagNames: Record<string, { name: string; color: string }>;
}

/** 対応表とタグ名を同じ SELECT で読み、同時更新で異なる版を混ぜて外部キーを壊さない。再配備なしで反映できるよう毎回読み直す。 */
async function getDuplicateTagConfig(db: D1Database): Promise<DuplicateTagConfig> {
  const result = await db.prepare(
    `SELECT key, value FROM account_settings
     WHERE line_account_id = 'system'
       AND key IN ('duplicate_tag_mapping', 'duplicate_tag_names')`
  ).all<{ key: string; value: string }>();

  const config: DuplicateTagConfig = { tagIds: {}, tagNames: {} };
  for (const row of result.results ?? []) {
    if (row.key === 'duplicate_tag_mapping') {
      config.tagIds = JSON.parse(row.value);
    } else if (row.key === 'duplicate_tag_names') {
      config.tagNames = JSON.parse(row.value);
    }
  }
  return config;
}

async function ensureTags(
  db: D1Database,
  tagNames: Record<string, { name: string; color: string }>
): Promise<void> {
  if (Object.keys(tagNames).length === 0) return;
  const now = japanCalendar().toISOString().replace('Z', '+09:00');
  for (const [id, { name, color }] of Object.entries(tagNames)) {
    const existing = await findTagByNormalizedName(db, name, null);
    if (existing && existing.id !== id) {
      throw new Error('duplicate tag configuration conflicts with an existing normalized name');
    }
    if (existing) continue;
    await db.prepare(
      `INSERT OR IGNORE INTO tags
         (id, name, normalized_name, color, line_account_id, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    ).bind(id, name, normalizeTagNameForCleanup(name), color, now).run();
    const resolved = await findTagByNormalizedName(db, name, null);
    if (!resolved || resolved.id !== id) {
      throw new Error('duplicate tag configuration could not claim its normalized name');
    }
  }
}

/** 前回から更新された友だちだけを増分で調べ、全アカウントの重複を判定する。 */
export async function processDuplicateDetection(db: D1Database): Promise<void> {
  // 対応表と名前が食い違わないよう、一度の SELECT で同時に読む。
  const { tagIds, tagNames } = await getDuplicateTagConfig(db);
  if (Object.keys(tagIds).length === 0) {
    // 対応表がなければ検出を省くが、設定の欠落に気付けるようログへ残す。
    logger.warn("duplicate_detect_account_settings_duplicate_tag_mapping_is_empty_feature_disabled");
    return;
  }


  await ensureTags(db, tagNames);


  const lastRunRow = await db.prepare(
    `SELECT value FROM account_settings WHERE line_account_id = 'system' AND key = 'duplicate_detect_last_run'`
  ).first<{ value: string }>();
  const lastRun = lastRunRow?.value ?? '2020-01-01T00:00:00';


  const candidates = await db.prepare(`
    SELECT id, line_account_id, (${URL_TOKEN_SQL}) as url_token
    FROM friends
    WHERE is_following = 1
      AND picture_url IS NOT NULL
      AND LENGTH(picture_url) > 50
      AND (created_at > ? OR updated_at > ?)
  `).bind(lastRun, lastRun).all<{ id: string; line_account_id: string; url_token: string | null }>();

  if (!candidates.results || candidates.results.length === 0) {
    return;
  }

  const newFriends = candidates.results.filter(f => f.url_token);
  if (newFriends.length === 0) return;

  logger.log("services_duplicate_detect_log");


  let taggedCount = 0;
  for (const friend of newFriends) {
    if (!friend.url_token || !friend.line_account_id) continue;

    // 別アカウントの友だちだけを照合する。
    const matches = await db.prepare(`
      SELECT id, line_account_id
      FROM friends
      WHERE is_following = 1
        AND id != ?
        AND line_account_id != ?
        AND (${URL_TOKEN_SQL}) = ?
        AND picture_url IS NOT NULL
        AND LENGTH(picture_url) > 50
    `).bind(friend.id, friend.line_account_id, friend.url_token)
      .all<{ id: string; line_account_id: string }>();

    if (!matches.results || matches.results.length === 0) continue;

    for (const match of matches.results) {
      const matchTagId = tagIds[match.line_account_id];
      const friendTagId = tagIds[friend.line_account_id];

      // Tag friend with the match's account tag (e.g., "重複:①")
      if (matchTagId) {
        await addTagToFriend(db, friend.id, matchTagId);
      }

      // Tag match with the friend's account tag (e.g., "重複:XH1")
      if (friendTagId) {
        await addTagToFriend(db, match.id, friendTagId);
      }

      taggedCount++;
    }
  }


  const now = japanCalendar().toISOString().replace('Z', '+09:00');
  await db.prepare(
    `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
     VALUES (?, 'system', 'duplicate_detect_last_run', ?, ?, ?)
     ON CONFLICT (line_account_id, key) DO UPDATE SET value = ?, updated_at = ?`
  ).bind(crypto.randomUUID(), now, now, now, now, now).run();

  if (taggedCount > 0) {
    logger.log("services_duplicate_detect_log");
  }
}
