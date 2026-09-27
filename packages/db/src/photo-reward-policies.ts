import { jstNow } from './utils.js';

// 写真の報酬の決まりの版 (#817)。
//
// 版 (photo_reward_policies) は保存のたびに1行足す。前の版は変えない。
// 「この版に戻す」は過去の行を書き換えず、その中身で新しい版を作る。
// 採用した時点の版を、付与の記録 (nen_photo_reward_outbox) に
// policy_version（鍵）・points（点数）の写しとして持つ。
// 版を変えても、過去の付与は変わらない。

export type PhotoRewardPolicyStatus = 'in_use' | 'reserved' | 'past';

export interface PhotoRewardPolicyRow {
  id: string;
  version_number: number;
  policy_key: string;
  points: number;
  summary: string;
  /** 使い始めの日時。空は「公開と同時」。 */
  effective_from: string | null;
  created_by_staff_id: string | null;
  idempotency_key: string | null;
  created_at: string;
}

export interface PhotoRewardPolicyView extends PhotoRewardPolicyRow {
  status: PhotoRewardPolicyStatus;
}

/** 第1版は既存の 'legacy-5' と同じ鍵。無いときの fallback も同じ。 */
export const LEGACY_PHOTO_REWARD_POLICY_KEY = 'legacy-5';
export const LEGACY_PHOTO_REWARD_POINTS = 5;

export function photoPolicyKeyForVersion(versionNumber: number): string {
  return versionNumber <= 1 ? LEGACY_PHOTO_REWARD_POLICY_KEY : `v${versionNumber}`;
}

/*
 * 第1版（既存の5pt固定）の確保。
 *
 * 移行済みのDBには migration 460 の種行があるが、新しいDB
 * （bootstrap は表の形だけを持ち、種行を持たない）には無い。
 * どちらのDBでも「第1版は5ptの legacy-5」が1つだけあるよう、
 * 読む・作る前に INSERT OR IGNORE で足す。番号・鍵の重なりは
 * 無視されるので、あるDBでは何もしない。
 */
export async function ensureLegacyPhotoRewardPolicy(db: D1Database): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO photo_reward_policies
        (id, version_number, policy_key, points, summary, effective_from, created_at)
       VALUES ('photo-reward-legacy-5', 1, 'legacy-5', 5, '最初の報酬の決まり', NULL, datetime('now'))`,
    )
    .run();
}

/**
 * 版の一覧。新しい版から返す。札（status）はここで1か所だけ決める。
 *
 * 未来の使い始めを持つ最新の版だけが「予約」。使い始めを過ぎた
 * （または持たない）最新の版が「いま使っている」。それより前は「過去」。
 */
export async function listPhotoRewardPolicies(
  db: D1Database,
): Promise<PhotoRewardPolicyView[]> {
  await ensureLegacyPhotoRewardPolicy(db);
  const result = await db
    .prepare(
      `SELECT * FROM photo_reward_policies
        ORDER BY version_number DESC`,
    )
    .all<PhotoRewardPolicyRow>();
  const rows = (result.results ?? []).map((row) => ({
    ...row,
    version_number: Number(row.version_number),
    points: Number(row.points),
  }));
  const now = jstNow();
  let currentFound = false;
  return rows.map((row) => {
    if (!currentFound && (!row.effective_from || row.effective_from <= now)) {
      currentFound = true;
      return { ...row, status: 'in_use' as const };
    }
    if (!currentFound) return { ...row, status: 'reserved' as const };
    return { ...row, status: 'past' as const };
  });
}

export async function getPhotoRewardPolicy(
  db: D1Database,
  versionNumber: number,
): Promise<PhotoRewardPolicyRow | null> {
  const row = await db
    .prepare(
      `SELECT * FROM photo_reward_policies
        WHERE version_number = ?`,
    )
    .bind(versionNumber)
    .first<PhotoRewardPolicyRow>();
  if (!row) return null;
  return { ...row, version_number: Number(row.version_number), points: Number(row.points) };
}

/**
 * いま使っている版。表が空のとき（移行前の古いDB）は
 * 既存の5pt固定へ倒す。黙って付け直さない。
 */
export async function getEffectivePhotoRewardPolicy(
  db: D1Database,
  now?: string,
): Promise<{ versionNumber: number; policyKey: string; points: number }> {
  const at = now ?? jstNow();
  const row = await db
    .prepare(
      `SELECT version_number, policy_key, points FROM photo_reward_policies
        WHERE effective_from IS NULL OR effective_from <= ?
        ORDER BY version_number DESC LIMIT 1`,
    )
    .bind(at)
    .first<{ version_number: number; policy_key: string; points: number }>();
  if (!row) {
    return {
      versionNumber: 1,
      policyKey: LEGACY_PHOTO_REWARD_POLICY_KEY,
      points: LEGACY_PHOTO_REWARD_POINTS,
    };
  }
  return {
    versionNumber: Number(row.version_number),
    policyKey: String(row.policy_key),
    points: Number(row.points),
  };
}

export interface AdoptedPhotoDuplicate {
  photoId: string;
  imageUrl: string;
  petName: string;
  createdAt: string;
  awardedPoints: number;
}

/**
 * 同じ中身の写真で、すでに採用されて報酬が付いたもの。
 * hash が空の投稿は探さない。空同士を重複としない。
 *
 * 同じ写真が2回採用されても、報酬は1回だけ。
 * 報酬なしで採用した前の投稿は、まだ報酬が付いていないので
 * 新しい採用の報酬を止めない。
 */
export async function findRewardedAdoptedDuplicate(
  db: D1Database,
  input: { contentHash: string | null; lineAccountId: string; excludePhotoId: string },
): Promise<AdoptedPhotoDuplicate | null> {
  if (!input.contentHash) return null;
  const row = await db
    .prepare(
      `SELECT ps.id, ps.review_image_url AS image_url, ps.created_at,
              ps.awarded_points, p.name AS pet_name
         FROM nen_photo_submissions ps
         JOIN nen_pet_profiles p ON p.id = ps.pet_id
        WHERE ps.line_account_id = ?
          AND ps.content_hash = ?
          AND ps.id != ?
          AND ps.status = 'adopted'
          AND ps.awarded_points > 0
        ORDER BY ps.created_at ASC LIMIT 1`,
    )
    .bind(input.lineAccountId, input.contentHash, input.excludePhotoId)
    .first<{
      id: string; image_url: string; created_at: string;
      awarded_points: number; pet_name: string;
    }>();
  if (!row) return null;
  return {
    photoId: String(row.id),
    imageUrl: String(row.image_url ?? ''),
    petName: String(row.pet_name ?? ''),
    createdAt: String(row.created_at ?? ''),
    awardedPoints: Number(row.awarded_points),
  };
}

/**
 * 新しい版を作る。番号は「いまの最大＋1」。過去の版は変えない。
 * 同じ確認キーの再送では版を増やさず、保存済みの版を返す。
 */
export async function createPhotoRewardPolicy(
  db: D1Database,
  input: {
    points: number;
    summary?: string;
    effectiveFrom?: string | null;
    expectedVersion?: number;
    idempotencyKey: string;
    staffId?: string | null;
  },
): Promise<{ created: boolean; version: PhotoRewardPolicyRow }> {
  if (!Number.isInteger(input.points) || input.points <= 0 || input.points > 100000) {
    throw new Error('PHOTO_REWARD_POLICY_POINTS_INVALID');
  }
  await ensureLegacyPhotoRewardPolicy(db);
  // 同時保存は版確認で落とす。負けた側は開き直して確認する。
  if (input.expectedVersion !== undefined) {
    const current = await db
      .prepare(`SELECT MAX(version_number) AS max_version FROM photo_reward_policies`)
      .first<{ max_version: number | null }>();
    if (Number(current?.max_version ?? 0) !== input.expectedVersion) {
      throw new Error('PHOTO_REWARD_POLICY_VERSION_CONFLICT');
    }
  }
  const existing = await db
    .prepare(`SELECT * FROM photo_reward_policies WHERE idempotency_key = ?`)
    .bind(input.idempotencyKey)
    .first<PhotoRewardPolicyRow>();
  if (existing) {
    return {
      created: false,
      version: {
        ...existing,
        version_number: Number(existing.version_number),
        points: Number(existing.points),
      },
    };
  }
  const maxRow = await db
    .prepare(`SELECT MAX(version_number) AS max_version FROM photo_reward_policies`)
    .first<{ max_version: number | null }>();
  const versionNumber = Number(maxRow?.max_version ?? 0) + 1;
  const now = jstNow();
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO photo_reward_policies
          (id, version_number, policy_key, points, summary,
           effective_from, created_by_staff_id, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id, versionNumber, photoPolicyKeyForVersion(versionNumber), input.points,
        String(input.summary ?? '').trim().slice(0, 200),
        input.effectiveFrom || null, input.staffId ?? null, input.idempotencyKey, now,
      )
      .run();
  } catch (error) {
    // 同時保存の勝ち負け。負けた側は保存済みの版を読む。
    if (String(error).includes('UNIQUE constraint failed')) {
      const saved = await db
        .prepare(`SELECT * FROM photo_reward_policies WHERE idempotency_key = ?`)
        .bind(input.idempotencyKey)
        .first<PhotoRewardPolicyRow>();
      if (saved) {
        return {
          created: false,
          version: {
            ...saved,
            version_number: Number(saved.version_number),
            points: Number(saved.points),
          },
        };
      }
    }
    throw error;
  }
  const created = await getPhotoRewardPolicy(db, versionNumber);
  if (!created) throw new Error('PHOTO_REWARD_POLICY_CREATE_FAILED');
  return { created: true, version: created };
}

/**
 * 「この版に戻す」。過去の版は変えず、その中身（点数・ひとこと）で
 * 新しい版を作る。使い始めは空（公開と同時）にする。
 */
export async function revertPhotoRewardPolicyToVersion(
  db: D1Database,
  versionNumber: number,
  input: { idempotencyKey: string; staffId?: string | null },
): Promise<{ created: boolean; version: PhotoRewardPolicyRow }> {
  const version = await getPhotoRewardPolicy(db, versionNumber);
  if (!version) throw new Error('PHOTO_REWARD_POLICY_VERSION_NOT_FOUND');
  return createPhotoRewardPolicy(db, {
    points: version.points,
    summary: version.summary,
    effectiveFrom: null,
    idempotencyKey: input.idempotencyKey,
    staffId: input.staffId,
  });
}
