import { type MileageRewardSummary } from './rewards-types.js';
import { MileageRewardError } from './rewards-validation.js';
import { getMileageReward } from './rewards-definitions-reads.js';


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
