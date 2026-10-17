import { sqlIdSet } from './id-queries.js';
import { type MileageRewardSummary, type RewardRow, type MileageRewardAdminOverview, type MileageRewardDraftInput } from './mileage-rewards-types.js';
import { rewardSelect, mapReward, MileageRewardError, validateMileageRewardDraft } from './mileage-rewards-validation.js';
import { collectBeneficiaryKeysForLimit } from './mileage-rewards-redemptions.js';


export async function listMileageRewards(
  db: D1Database,
  input: { lineAccountId: string; customerVisible?: boolean },
): Promise<MileageRewardSummary[]> {
  const now = new Date().toISOString();
  const visibleClause = input.customerVisible
    ? `AND r.status = 'published' AND v.status = 'published'
       AND (v.starts_at IS NULL OR v.starts_at <= ?)
       AND (v.ends_at IS NULL OR v.ends_at > ?)`
    : '';
  const binds: unknown[] = [input.lineAccountId];
  if (input.customerVisible) binds.push(now, now);
  const result = await db.prepare(
    `${rewardSelect(input.customerVisible
      ? 'r.current_published_version_id'
      : 'COALESCE(r.current_draft_version_id, r.current_published_version_id)')}
      WHERE r.line_account_id = ? ${visibleClause}
      ORDER BY r.sort_order, r.updated_at DESC, r.id`,
  ).bind(...binds).all<RewardRow>();
  return result.results.map(mapReward);
}

export async function getMileageReward(
  db: D1Database,
  input: { id: string; lineAccountId: string },
): Promise<MileageRewardSummary | null> {
  const row = await db.prepare(
    `${rewardSelect('COALESCE(r.current_draft_version_id, r.current_published_version_id)')}
      WHERE r.id = ? AND r.line_account_id = ?`,
  ).bind(input.id, input.lineAccountId).first<RewardRow>();
  return row ? mapReward(row) : null;
}

export async function getMileageRewardAdminOverview(
  db: D1Database,
  lineAccountId: string,
): Promise<MileageRewardAdminOverview> {
  const rewards = await listMileageRewards(db, { lineAccountId });
  const summary = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM mileage_rewards
         WHERE line_account_id = ? AND status = 'published') AS published_count,
       COALESCE((SELECT SUM(v.required_miles)
         FROM mileage_redemptions mr
         JOIN mileage_reward_versions v ON v.id = mr.reward_version_id
        WHERE mr.line_account_id = ? AND mr.status = 'succeeded'
          AND mr.delivered_at >= datetime('now', 'start of month')), 0) AS redeemed_miles_this_month,
       (SELECT COUNT(*) FROM friends f
         WHERE f.line_account_id = ? AND f.is_following = 1
           AND NOT EXISTS (
             SELECT 1 FROM mileage_redemptions mr
              WHERE mr.line_account_id = ? AND mr.status != 'refunded'
                AND ((f.user_id IS NOT NULL AND mr.beneficiary_key = 'user:' || f.user_id)
                  OR (f.user_id IS NULL AND mr.beneficiary_key = 'friend:' || f.id))
           )) AS never_redeemed_friend_count,
       (SELECT r.name FROM mileage_rewards r
         JOIN mileage_redemptions mr ON mr.reward_id = r.id AND mr.status = 'succeeded'
       WHERE r.line_account_id = ?
        GROUP BY r.id ORDER BY COUNT(*) DESC, r.name LIMIT 1) AS most_redeemed_reward_name,
       (SELECT COUNT(*) FROM mileage_redemptions mr
         JOIN mileage_rewards r ON r.id = mr.reward_id
        WHERE r.line_account_id = ? AND mr.status = 'succeeded'
        GROUP BY r.id ORDER BY COUNT(*) DESC, r.name LIMIT 1) AS most_redeemed_reward_count`,
  ).bind(lineAccountId, lineAccountId, lineAccountId, lineAccountId, lineAccountId, lineAccountId).first<{
    published_count: number;
    redeemed_miles_this_month: number;
    never_redeemed_friend_count: number;
    most_redeemed_reward_name: string | null;
    most_redeemed_reward_count: number | null;
  }>();
  return {
    rewards,
    summary: {
      publishedCount: summary?.published_count ?? 0,
      redeemedMilesThisMonth: summary?.redeemed_miles_this_month ?? 0,
      neverRedeemedFriendCount: Number(summary?.never_redeemed_friend_count ?? 0),
      mostRedeemedRewardName: summary?.most_redeemed_reward_name ?? null,
      mostRedeemedRewardCount: summary?.most_redeemed_reward_count ?? null,
    },
  };
}

/**
 * 顧客向け一覧で「交換できる」と言い切る前に、実際の交換回数をまとめて確認する。
 * 0件と未取得を混ぜないため、友だちが存在しない場合は空のMapではなく例外にする。
 */
export async function getMileageRewardRedemptionCounts(
  db: D1Database,
  input: { lineAccountId: string; friendId: string },
): Promise<{
  beneficiaryKey: string;
  byRewardId: Map<string, number>;
  byVersionId: Map<string, number>;
}> {
  const friend = await db.prepare(
    `SELECT id, user_id FROM friends WHERE id = ? AND line_account_id = ?`,
  ).bind(input.friendId, input.lineAccountId).first<{ id: string; user_id: string | null }>();
  if (!friend) throw new MileageRewardError('friend_not_found', '友だち情報を確認できませんでした', 404);
  const beneficiaryKey = friend.user_id ? `user:${friend.user_id}` : `friend:${friend.id}`;
  /*
   * R388: 交換済みの表示も上限と同じ本人キー集合で数える。統合後に
   * 「交換できる」と出して上限で止める食い違いを出さない。
   */
  const limitKeys = await collectBeneficiaryKeysForLimit(db, input.friendId, friend.user_id, beneficiaryKey);
  const limitPlaceholders = sqlIdSet(limitKeys).sql;
  const rows = await db.prepare(
    `SELECT reward_id, reward_version_id, COUNT(*) AS count
       FROM mileage_redemptions
      WHERE line_account_id = ? AND beneficiary_key IN (${limitPlaceholders}) AND status != 'refunded'
      GROUP BY reward_id, reward_version_id`,
  ).bind(input.lineAccountId, ...(limitKeys.length ? sqlIdSet(limitKeys).binds : [])).all<{
    reward_id: string;
    reward_version_id: string;
    count: number;
  }>();
  const byRewardId = new Map<string, number>();
  const byVersionId = new Map<string, number>();
  for (const row of rows.results) {
    byRewardId.set(row.reward_id, (byRewardId.get(row.reward_id) ?? 0) + row.count);
    byVersionId.set(row.reward_version_id, row.count);
  }
  return { beneficiaryKey, byRewardId, byVersionId };
}

export async function requirePublishedActionVersion(
  db: D1Database,
  lineAccountId: string,
  versionId: string | null,
): Promise<void> {
  if (!versionId) return;
  const row = await db.prepare(
    `SELECT cav.action_config
       FROM common_action_versions cav
       JOIN common_actions ca ON ca.id = cav.common_action_id
      WHERE cav.id = ? AND cav.status = 'published' AND ca.line_account_id = ?`,
  ).bind(versionId, lineAccountId).first<{ action_config: string }>();
  if (!row) throw new MileageRewardError('action_not_published', '公開済みの交換後アクションを選んでください');
  let actions: unknown;
  try { actions = JSON.parse(row.action_config); } catch { actions = null; }
  if (!Array.isArray(actions) || actions.some((action) => {
    if (!action || typeof action !== 'object') return true;
    const type = (action as { type?: unknown }).type;
    return type === 'wait' || type === 'common_action';
  })) {
    throw new MileageRewardError(
      'action_not_immediate',
      '待ち時間または別の共通アクションを含む処理は、交換後の動きに使えません',
    );
  }
}

export async function createMileageRewardDraft(
  db: D1Database,
  input: { lineAccountId: string; programId?: string; createdBy?: string | null; draft: MileageRewardDraftInput },
): Promise<MileageRewardSummary> {
  const draft = validateMileageRewardDraft(input.draft);
  await requirePublishedActionVersion(db, input.lineAccountId, draft.commonActionVersionId);
  const rewardId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO mileage_rewards
         (id, line_account_id, program_id, name, description, image_url, reward_kind,
          status, current_draft_version_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    ).bind(
      rewardId, input.lineAccountId, input.programId ?? 'default', draft.name,
      draft.description, draft.imageUrl, draft.rewardKind, versionId,
      input.createdBy ?? null, now, now,
    ),
    db.prepare(
      `INSERT INTO mileage_reward_versions
         (id, reward_id, version_number, status, required_miles, stock_limit,
          per_friend_limit, starts_at, ends_at, benefit_expires_days,
          common_action_version_id, target_conditions, failure_policy, customer_message, created_by, created_at)
       VALUES (?, ?, 1, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      versionId, rewardId, draft.requiredMiles, draft.stockLimit, draft.perFriendLimit,
      draft.startsAt, draft.endsAt, draft.benefitExpiresDays, draft.commonActionVersionId,
      draft.targetConditions ? JSON.stringify(draft.targetConditions) : null,
      draft.failurePolicy, draft.customerMessage, input.createdBy ?? null, now,
    ),
  ]);
  const created = await getMileageReward(db, { id: rewardId, lineAccountId: input.lineAccountId });
  if (!created) throw new MileageRewardError('create_failed', '使い道を作成できませんでした', 500);
  return created;
}

export async function updateMileageRewardDraft(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    expectedVersionId: string;
    expectedRevision?: number | null;
    updatedBy?: string | null;
    draft: MileageRewardDraftInput;
  },
): Promise<MileageRewardSummary> {
  const draft = validateMileageRewardDraft(input.draft);
  await requirePublishedActionVersion(db, input.lineAccountId, draft.commonActionVersionId);
  // R375: 書く前に所属と版IDを照合する。版のUPDATEだけ所属を見ない形にしない。
  // R374: 読み込んだ更新番号と一致する保存だけ通す。
  const current = await db.prepare(
    `SELECT r.current_draft_version_id AS draft_version_id, v.revision AS revision
       FROM mileage_rewards r
       LEFT JOIN mileage_reward_versions v ON v.id = r.current_draft_version_id
      WHERE r.id = ? AND r.line_account_id = ?`,
  ).bind(input.id, input.lineAccountId).first<{ draft_version_id: string | null; revision: number | null }>();
  if (!current || current.draft_version_id !== input.expectedVersionId) {
    if (!current) throw new MileageRewardError('not_found', '使い道が見つかりません', 404);
    throw new MileageRewardError('version_conflict', 'ほかの人が先に変更しました。読み直してください', 409);
  }
  if (input.expectedRevision != null && current.revision !== input.expectedRevision) {
    throw new MileageRewardError('version_conflict', 'ほかの人が先に変更しました。読み直してください', 409);
  }
  const now = new Date().toISOString();
  // 両方のUPDATEに同じ所属・版・更新番号の条件を付け、片方だけ
  // 書き換わる部分更新を残さない。通るたびに更新番号を1つ増やす。
  const revisionGuard = input.expectedRevision != null ? ' AND v.revision = ?' : '';
  const revisionBinds: unknown[] = input.expectedRevision != null ? [input.expectedRevision] : [];
  const results = await db.batch([
    db.prepare(
      `UPDATE mileage_rewards
          SET name = ?, description = ?, image_url = ?, reward_kind = ?, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND current_draft_version_id = ?
          AND EXISTS (
            SELECT 1 FROM mileage_reward_versions v
             WHERE v.id = ? AND v.reward_id = mileage_rewards.id AND v.status = 'draft'
             ${revisionGuard}
          )`,
    ).bind(
      draft.name, draft.description, draft.imageUrl, draft.rewardKind, now,
      input.id, input.lineAccountId, input.expectedVersionId,
      input.expectedVersionId, ...revisionBinds,
    ),
    db.prepare(
      `UPDATE mileage_reward_versions
          SET required_miles = ?, stock_limit = ?, per_friend_limit = ?, starts_at = ?,
              ends_at = ?, benefit_expires_days = ?, common_action_version_id = ?,
              target_conditions = ?, failure_policy = ?, customer_message = ?, created_by = ?,
              revision = revision + 1
        WHERE id = ? AND reward_id = ? AND status = 'draft'
          ${input.expectedRevision != null ? ' AND revision = ?' : ''}
          AND EXISTS (
            SELECT 1 FROM mileage_rewards r
             WHERE r.id = mileage_reward_versions.reward_id AND r.line_account_id = ?
          )`,
    ).bind(
      draft.requiredMiles, draft.stockLimit, draft.perFriendLimit, draft.startsAt,
      draft.endsAt, draft.benefitExpiresDays, draft.commonActionVersionId,
      draft.targetConditions ? JSON.stringify(draft.targetConditions) : null,
      draft.failurePolicy, draft.customerMessage, input.updatedBy ?? null,
      input.expectedVersionId, input.id, ...revisionBinds, input.lineAccountId,
    ),
  ]);
  if ((results[0]?.meta?.changes ?? 0) !== 1 || (results[1]?.meta?.changes ?? 0) !== 1) {
    throw new MileageRewardError('version_conflict', 'ほかの人が先に変更しました。読み直してください', 409);
  }
  const updated = await getMileageReward(db, { id: input.id, lineAccountId: input.lineAccountId });
  if (!updated) throw new MileageRewardError('not_found', '使い道が見つかりません', 404);
  return updated;
}

export async function createMileageRewardDraftFromPublished(
  db: D1Database,
  input: { id: string; lineAccountId: string; createdBy?: string | null },
): Promise<MileageRewardSummary> {
  const reward = await getMileageReward(db, input);
  if (!reward?.currentPublishedVersionId) throw new MileageRewardError('not_found', '公開中の使い道が見つかりません', 404);
  if (reward.currentDraftVersionId) return reward;
  const published = await db.prepare(
    `SELECT * FROM mileage_reward_versions WHERE id = ? AND status = 'published'`,
  ).bind(reward.currentPublishedVersionId).first<Record<string, unknown>>();
  if (!published) throw new MileageRewardError('published_version_missing', '公開中の版を読み込めませんでした', 409);
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO mileage_reward_versions
           (id, reward_id, version_number, status, required_miles, stock_limit,
            per_friend_limit, starts_at, ends_at, benefit_expires_days,
            common_action_version_id, target_conditions, failure_policy, customer_message, created_by, created_at)
         SELECT ?, reward_id, version_number + 1, 'draft', required_miles, stock_limit,
                per_friend_limit, starts_at, ends_at, benefit_expires_days,
                common_action_version_id, target_conditions, failure_policy, customer_message, ?, ?
           FROM mileage_reward_versions WHERE id = ? AND status = 'published'`,
      ).bind(versionId, input.createdBy ?? null, now, reward.currentPublishedVersionId),
      db.prepare(
        `UPDATE mileage_rewards SET current_draft_version_id = ?, updated_at = ?
          WHERE id = ? AND line_account_id = ? AND current_draft_version_id IS NULL`,
      ).bind(versionId, now, input.id, input.lineAccountId),
    ]);
  } catch (error) {
    // R377: 同時に作った片方は版番号の一意制約に当たる。共同編集の正常な
    // 競合なので、一般的なサーバーエラーにせず読み直しを案内する。
    if (error instanceof Error && /unique|UNIQUE/i.test(error.message)) {
      throw new MileageRewardError('draft_exists', 'ほかの担当者が下書きを作成済みです。読み直してください', 409);
    }
    throw error;
  }
  const created = await getMileageReward(db, input);
  if (!created) throw new MileageRewardError('not_found', '使い道が見つかりません', 404);
  if (created.currentDraftVersionId !== versionId) {
    // 競合に勝った相手の下書きが付いた。作り直さず読み直しを案内する。
    throw new MileageRewardError('draft_exists', 'ほかの担当者が下書きを作成済みです。読み直してください', 409);
  }
  return created;
}

export async function publishMileageReward(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    publishedBy?: string | null;
    expectedVersionId?: string | null;
    expectedRevision?: number | null;
  },
): Promise<MileageRewardSummary> {
  const reward = await getMileageReward(db, input);
  const draft = reward?.currentVersion?.status === 'draft' ? reward.currentVersion : null;
  if (!reward || !draft || !reward.currentDraftVersionId) {
    throw new MileageRewardError('draft_missing', '公開する下書きがありません', 409);
  }
  // R376: 公開者が確認した版と更新番号を要求に含め、検証から確定まで
  // 同じ内容を保証する。途中で保存されたら公開を止めて確認し直す。
  if (input.expectedVersionId != null && input.expectedVersionId !== draft.id) {
    throw new MileageRewardError('version_conflict', '公開前に内容が変わりました。読み直してください', 409);
  }
  if (input.expectedRevision != null && draft.revision !== input.expectedRevision) {
    throw new MileageRewardError('version_conflict', '公開前に内容が変わりました。読み直してください', 409);
  }
  await requirePublishedActionVersion(db, input.lineAccountId, draft.commonActionVersionId);
  if (reward.rewardKind === 'coupon') {
    const inventory = await db.prepare(
      `SELECT COUNT(*) AS count FROM mileage_reward_codes
        WHERE reward_version_id = ? AND status = 'available'`,
    ).bind(draft.id).first<{ count: number }>();
    if ((inventory?.count ?? 0) < 1) {
      throw new MileageRewardError('coupon_inventory_empty', '交換コードを1件以上登録してから公開してください');
    }
  }
  const now = new Date().toISOString();
  const revisionGuard = input.expectedRevision != null ? ' AND revision = ?' : '';
  const revisionBinds: unknown[] = input.expectedRevision != null ? [input.expectedRevision] : [];
  const results = await db.batch([
    db.prepare(
      `UPDATE mileage_reward_versions
          SET status = 'published', published_at = ?, created_by = COALESCE(?, created_by)
        WHERE id = ? AND reward_id = ? AND status = 'draft'${revisionGuard}`,
    ).bind(now, input.publishedBy ?? null, draft.id, reward.id, ...revisionBinds),
    db.prepare(
      `UPDATE mileage_rewards
          SET status = 'published', current_published_version_id = current_draft_version_id,
              current_draft_version_id = NULL, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND current_draft_version_id = ?
          AND EXISTS (
            SELECT 1 FROM mileage_reward_versions v
             WHERE v.id = ? AND v.reward_id = mileage_rewards.id
             ${revisionGuard.replaceAll('revision', 'v.revision')}
          )`,
    ).bind(now, reward.id, input.lineAccountId, draft.id, draft.id, ...revisionBinds),
  ]);
  if ((results[0]?.meta?.changes ?? 0) !== 1 || (results[1]?.meta?.changes ?? 0) !== 1) {
    throw new MileageRewardError('version_conflict', '公開前に内容が変わりました。読み直してください', 409);
  }
  const published = await getMileageReward(db, input);
  if (!published) throw new MileageRewardError('not_found', '使い道が見つかりません', 404);
  return published;
}

export async function setMileageRewardStatus(
  db: D1Database,
  input: { id: string; lineAccountId: string; status: 'published' | 'stopped' | 'archived' },
): Promise<MileageRewardSummary> {
  const result = await db.prepare(
    `UPDATE mileage_rewards SET status = ?, updated_at = ?
      WHERE id = ? AND line_account_id = ? AND current_published_version_id IS NOT NULL`,
  ).bind(input.status, new Date().toISOString(), input.id, input.lineAccountId).run();
  if ((result.meta?.changes ?? 0) !== 1) throw new MileageRewardError('not_found', '使い道が見つかりません', 404);
  return (await getMileageReward(db, input))!;
}

export async function reorderMileageRewards(
  db: D1Database,
  input: { lineAccountId: string; ids: string[] },
): Promise<void> {
  if (!input.ids.length || new Set(input.ids).size !== input.ids.length) {
    throw new MileageRewardError('invalid_order', '並び順を確認してください');
  }
  const existing = await db.prepare(
    `SELECT id FROM mileage_rewards WHERE line_account_id = ?`,
  ).bind(input.lineAccountId).all<{ id: string }>();
  if (existing.results.length !== input.ids.length
    || existing.results.some((row) => !input.ids.includes(row.id))) {
    throw new MileageRewardError('invalid_order', '別のLINE公式アカウントの使い道が含まれています');
  }
  const now = new Date().toISOString();
  await db.batch(input.ids.map((id, index) => db.prepare(
    `UPDATE mileage_rewards SET sort_order = ?, updated_at = ? WHERE id = ? AND line_account_id = ?`,
  ).bind(index, now, id, input.lineAccountId)));
}

export async function importMileageRewardCodes(
  db: D1Database,
  input: {
    rewardId: string;
    lineAccountId: string;
    codes: Array<{ ciphertext: string; fingerprint: string }>;
  },
): Promise<{ inserted: number }> {
  const reward = await getMileageReward(db, { id: input.rewardId, lineAccountId: input.lineAccountId });
  const versionId = reward?.currentDraftVersionId;
  if (!reward || reward.rewardKind !== 'coupon' || !versionId) {
    throw new MileageRewardError('coupon_draft_missing', '交換コードを登録できる下書きがありません', 409);
  }
  const unique = [...new Map(input.codes.map((item) => [item.fingerprint, item])).values()];
  if (!unique.length || unique.length > 10_000) {
    throw new MileageRewardError('invalid_codes', '交換コードは1〜10,000件で登録してください');
  }
  // R372: 重複判定を版の外へ持ち、同じ店舗内の配布履歴まで照合する。
  // 配布済み（issued/reserved）はもちろん、未使用の旧版コードも再登録では
  // 増やさない。単発在庫が二重に確保され、別の人へ同じコードを配らない。
  const existing = new Set<string>();
  for (let offset = 0; offset < unique.length; offset += 500) {
    const chunk = unique.slice(offset, offset + 500);
    const rows = await db.prepare(
      `SELECT c.code_fingerprint AS fingerprint
         FROM mileage_reward_codes c
         JOIN mileage_reward_versions v ON v.id = c.reward_version_id
         JOIN mileage_rewards r ON r.id = v.reward_id
        WHERE r.line_account_id = ? AND c.code_fingerprint IN (SELECT value FROM json_each(?))`,
    ).bind(input.lineAccountId, JSON.stringify(chunk.map((code) => code.fingerprint)))
      .all<{ fingerprint: string }>();
    for (const row of rows.results) existing.add(row.fingerprint);
  }
  const fresh = unique.filter((code) => !existing.has(code.fingerprint));
  if (!fresh.length) return { inserted: 0 };
  const results = await db.batch(fresh.map((code) => db.prepare(
    `INSERT OR IGNORE INTO mileage_reward_codes
       (id, reward_version_id, code_ciphertext, code_fingerprint, status, created_at)
     VALUES (?, ?, ?, ?, 'available', ?)`,
  ).bind(crypto.randomUUID(), versionId, code.ciphertext, code.fingerprint, new Date().toISOString())));
  return { inserted: results.reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0) };
}
