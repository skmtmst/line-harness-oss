import { logger } from '@line-crm/shared/server';
import { jstNow } from '../utils.js';
import { enqueueMileageEvent } from '../mileage/index.js';
import { recordConversionSourceEvent } from '../conversion-event-sources.js';
import { type Tag, type TagRetroactiveMileagePreview } from './types.js';


/**
 * 友だちにタグを1本付ける。新しく付いたときだけ副作用を起こす。
 *
 * **この関数を通らない付け方が2つある(#648)。**どちらも `friend_tags` へ直に
 * INSERT していて、マイルも成果計測も通らない。
 *
 *  - `packages/db/src/tag-definitions.ts` のタグ廃止時の置き換え
 *  - `apps/worker/src/services/nen-column-operations.ts` のコラム読了タグ
 *
 * **タグ廃止の置き換えは、通してはいけない。**あれは「そのタグが付いている
 * 全員へ、置き換え先のタグを一斉に付ける」処理で、成果として数えると
 * **運用者がタグを1本片づけただけで成果が何百件も一気に増える。**業務の
 * 出来事ではなく、台帳の引っ越しだからである。将来この箇所をここ経由へ
 * 書き換えるときは、成果計測を迂回する道を先に用意すること。
 *
 * コラム読了タグの方は「本来数えるべき」に見えるが、ここ経由にすると
 * 成果計測と同時にマイル加算も始まり、利用者の残高が変わる。その扱いは
 * この票の外なので別票で決める(司令塔裁定 2026-09-12)。
 */
export async function addTagToFriend(
  db: D1Database,
  friendId: string,
  tagId: string,
  options?: {
    /**
     * R403: 連動処理の冪等キー。受信Webhookの再試行など、同じ出来事を
     * 繰り返す呼び出し元が安定した値を渡す。同じ値の再実行は二重計上しない。
     * 省略時は従来どおり付与時刻入りの値を使う（単発の手動付与用）。
     */
    sourceEventId?: string;
    /**
     * R403: true のとき連動処理の失敗を握りつぶさず投げる。
     * 受信Webhookの受領は失敗状態で残り、同じ受信の再送で欠けた記録だけを
     * 復旧できる。手動付与など単発の呼び出しは従来どおり false。
     */
    strictSideEffects?: boolean;
  },
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
  const sideEffectKey = options?.sourceEventId ?? `${friendId}:${tagId}:${now}`;
  // 安定キーがある再実行は、タグ行が既にあっても連動処理を試す
  // （冪等キーで二重計上しない）。単発の付け直しは従来どおり何もしない。
  if (added || options?.sourceEventId !== undefined) {
    try {
      await enqueueMileageEvent(db, {
        eventType: 'tag_added',
        source: 'tag',
        sourceEventId: sideEffectKey,
        friendId,
        subjectKey: tagId,
        metadata: { tagId },
        occurredAt: now,
      });
    } catch (error) {
      logger.error("src_tags_failed");
      if (options?.strictSideEffects) throw error;
    }
    // 「タグが付いた」を成果として数える(#648)。
    //
    // マイルの隣に置くのは、**呼び出し元を1つも触らずに全経路へ届かせる**ため。
    // 以前はこの計測を worker の attachTagAndFireSideEffects の中だけに置いて
    // いたので、友だち詳細画面の手動タグ付け・オートメーションのタグ付け
    // アクション(どちらもこの関数を直に呼ぶ)では 0 件のままだった。
    // 画面の起点一覧は「タグが付いた」としか書いておらず、誰が付けたかで
    // 数えたり数えなかったりする境界は運用者に説明できない。
    //
    // 冪等キーは安定キー（受領起点）か付与時刻。単発の付け直しは上の
    // INSERT OR IGNORE が 0 行になり added=false なので、ここへ来ない。
    // 単発では失敗しても握って進む。タグ付与そのものを巻き添えにしない。
    // R403: strict のときは失敗を残す。欠けた記録は同じ安定キーの再送で復旧する。
    try {
      const conversion = await recordConversionSourceEvent(db, {
        sourceType: 'tag_added',
        friendId,
        sourceEventId: sideEffectKey,
        metadata: { tagId },
      });
      if (options?.strictSideEffects && conversion.failed > 0) {
        throw new Error(`tag conversion record failed: ${conversion.failed}`);
      }
    } catch (error) {
      logger.error("src_tags_failed");
      if (options?.strictSideEffects) throw error;
    }
  }
  return added;
}

/**
 * M955: `enqueueRetroactive` が真のとき、マイル設定の更新と遡及キューの
 * 投入を同じD1バッチで確定する。投入だけ落ちたら設定の更新も巻き戻り、
 * 「保存は確定・遡及は消失」にならない。戻り値の `queued` は積んだ件数。
 */
export async function updateTagMileageSettings(
  db: D1Database,
  tagId: string,
  input: {
    rewardMiles: number;
    referralRewardMiles: number;
    multiplierBps: number | null;
    multiplierPriority: number;
  },
  options: { enqueueRetroactive?: boolean } = {},
): Promise<{ tag: Tag | null; queued: number }> {
  const statements: D1PreparedStatement[] = [
    db
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
      ),
  ];
  const enqueueStart = statements.length;
  if (options.enqueueRetroactive) {
    statements.push(...tagRetroactiveEnqueueStatements(db, tagId, jstNow()));
  }
  const results = await db.batch(statements);
  const changes = (index: number) =>
    (results[index] as unknown as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;
  const queued = options.enqueueRetroactive ? changes(enqueueStart + 1) + changes(enqueueStart + 2) : 0;
  const tag = await db.prepare(`SELECT * FROM tags WHERE id = ?`).bind(tagId).first<Tag>();
  return { tag, queued };
}

/**
 * 遡及キューの3文を組み立てる。M955: タグの保存と同じD1バッチへ積むことで、
 * 投入だけ落ちても「保存は確定・遡及は消失」にならない（巻き戻る）。
 * 単独で使うときは `enqueueHistoricTagMileage` を使う（中身は同じ）。
 */
export function tagRetroactiveEnqueueStatements(
  db: D1Database,
  tagId: string,
  now: string,
): D1PreparedStatement[] {
  return [
    db.prepare(
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
    ).bind(now, tagId),
    db.prepare(
      `INSERT OR IGNORE INTO mileage_event_queue
         (engagement_event_id, status, attempts, available_at,
          applied_published_snapshot, created_at, updated_at)
       SELECT ee.id, 'pending', 0, ?,
              -- N-231 案1: 受付(補完実行)時点で適用版の集合を固定する。
              (SELECT json_group_object(r.id, COALESCE(r.published_version_number, 0))
                 FROM friends f
                 JOIN mileage_rules r ON r.line_account_id = f.line_account_id
                WHERE f.id = ee.actor_friend_id),
              ?, ?
         FROM engagement_events ee
        WHERE ee.event_type = 'tag_added'
          AND ee.source = 'tag'
          AND json_extract(ee.metadata, '$.tagId') = ?`,
    ).bind(now, now, now, tagId),
    db.prepare(
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
    ).bind(now, now, tagId),
  ];
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
  const results = await db.batch(tagRetroactiveEnqueueStatements(db, tagId, now));
  const changes = (index: number) =>
    (results[index] as unknown as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;
  return changes(1) + changes(2);
}

export async function getTagRetroactiveMileagePreview(
  db: D1Database,
  tagId: string,
): Promise<TagRetroactiveMileagePreview | null> {
  const tag = await db
    .prepare('SELECT line_account_id FROM tags WHERE id = ?')
    .bind(tagId)
    .first<{ line_account_id: string | null }>();
  if (!tag) return null;

  const tagged = await db
    .prepare(
      `SELECT ft.friend_id
       FROM friend_tags ft
       JOIN friends f ON f.id = ft.friend_id
       WHERE ft.tag_id = ?`,
    )
    .bind(tagId)
    .all<{ friend_id: string }>();
  const friendIds = tagged.results.map((row) => row.friend_id);

  // 本人分: 実行側と同じ冪等キー(tag-reward:identity:...)で既付与を除く
  const selfRows = await db
    .prepare(
      `SELECT t.friend_id, EXISTS (
         SELECT 1 FROM mileage_ledger ml
         WHERE ml.entry_type = 'grant' AND ml.status != 'void' AND ml.source = 'tag'
           AND ml.idempotency_key = 'tag-reward:identity:'
             || CASE WHEN t.user_id IS NOT NULL THEN 'user:' || t.user_id ELSE 'friend:' || t.friend_id END
             || ':tag:' || ?
       ) AS already_granted
       FROM (
         SELECT ft.friend_id, f.user_id
         FROM friend_tags ft JOIN friends f ON f.id = ft.friend_id
         WHERE ft.tag_id = ?
       ) t`,
    )
    .bind(tagId, tagId)
    .all<{ friend_id: string; already_granted: number }>();
  const selfTargetIds = selfRows.results
    .filter((row) => row.already_granted === 0)
    .map((row) => row.friend_id);
  const selfExcludedIds = selfRows.results
    .filter((row) => row.already_granted !== 0)
    .map((row) => row.friend_id);

  // 紹介者分: 実行側(resolveReferralMileageBeneficiary)と同じ解決をSQLで再現。
  // 同一人物(user_id)を持つ行もまとめて紹介追跡を探し、±1日以内に
  // 同一人物でないアフィリエイター行が見つかった友だちだけを対象にする。
  const referralRows = await db
    .prepare(
      `SELECT t.friend_id, EXISTS (
         SELECT 1 FROM mileage_ledger ml
         WHERE ml.entry_type = 'grant' AND ml.status != 'void' AND ml.source = 'tag_referral'
           AND ml.idempotency_key LIKE 'tag-referral:referrer:%:referred:'
             || CASE WHEN t.actor_user_id IS NOT NULL THEN 'user:' || t.actor_user_id ELSE 'friend:' || t.friend_id END
             || ':tag:' || ?
       ) AS already_granted
       FROM (
         SELECT DISTINCT t0.friend_id
         FROM (
           SELECT ft.friend_id, f.user_id AS actor_user_id
           FROM friend_tags ft JOIN friends f ON f.id = ft.friend_id
           WHERE ft.tag_id = ?
         ) t0
         JOIN friends rf ON rf.id = t0.friend_id
            OR (t0.actor_user_id IS NOT NULL AND rf.user_id = t0.actor_user_id)
         JOIN ref_tracking rt ON rt.friend_id = rf.id
         JOIN affiliate_links al ON al.ref_code = rt.ref_code
         JOIN affiliates a ON a.id = al.affiliate_id
         JOIN friends referrer ON referrer.id = a.friend_id
         WHERE julianday(rt.created_at) >= julianday(rf.created_at) - 1
           AND julianday(rt.created_at) <= julianday(rf.created_at) + 1
           AND a.friend_id != rf.id
           AND (rf.user_id IS NULL OR referrer.user_id IS NULL
                OR referrer.user_id != rf.user_id)
       ) matched
       JOIN (
         SELECT ft.friend_id, f.user_id AS actor_user_id
         FROM friend_tags ft JOIN friends f ON f.id = ft.friend_id
         WHERE ft.tag_id = ?
       ) t ON t.friend_id = matched.friend_id`,
    )
    .bind(tagId, tagId, tagId)
    .all<{ friend_id: string; already_granted: number }>();
  const referralTargetIds = referralRows.results
    .filter((row) => row.already_granted === 0)
    .map((row) => row.friend_id);
  const referralExcludedIds = referralRows.results
    .filter((row) => row.already_granted !== 0)
    .map((row) => row.friend_id);

  return {
    tagId,
    lineAccountId: tag.line_account_id,
    friendIds,
    selfTargetIds,
    selfExcludedIds,
    referralTargetIds,
    referralExcludedIds,
  };
}
