import { jstNow } from '../utils.js';
import { type FormTestToken } from './types.js';


/** 有効な試し合言葉の数。発行の上限の判定に使う。 */
export async function countActiveFormTestTokens(
  db: D1Database,
  formId: string,
  now: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM form_test_tokens
        WHERE form_id = ? AND expires_at > ?`,
    )
    .bind(formId, now)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function insertFormTestToken(
  db: D1Database,
  input: {
    id: string;
    formId: string;
    tokenHash: string;
    createdByStaffId: string | null;
    expiresAt: string;
  },
): Promise<FormTestToken> {
  await db
    .prepare(
      `INSERT INTO form_test_tokens
         (id, form_id, token_hash, created_by_staff_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.formId,
      input.tokenHash,
      input.createdByStaffId,
      input.expiresAt,
      jstNow(),
    )
    .run();
  return (await db
    .prepare(`SELECT * FROM form_test_tokens WHERE id = ?`)
    .bind(input.id)
    .first<FormTestToken>())!;
}

/** 試し合言葉の確認。期限切れは無いものとして扱う。 */
export async function getValidFormTestToken(
  db: D1Database,
  formId: string,
  tokenHash: string,
  now: string,
): Promise<FormTestToken | null> {
  return db
    .prepare(
      `SELECT * FROM form_test_tokens
        WHERE form_id = ? AND token_hash = ? AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(formId, tokenHash, now)
    .first<FormTestToken>();
}

/** 期限切れの試し合言葉の掃除。発行時に合わせて呼ぶ。 */
export async function deleteExpiredFormTestTokens(
  db: D1Database,
  now: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM form_test_tokens WHERE expires_at <= ?`)
    .bind(now)
    .run();
}

/**
 * 選択肢ごとの、これまでの選ばれた数。定員の判定に使う。
 *
 * 回答は JSON なので SQL では数えられない。ここで読んで数える。
 * 定員は「先着の枠取り」に使うもので、何万件も溜まった頃には枠は
 * とっくに埋まっている。読む件数に上限を置いて、重くならないようにする。
 */
export async function countChoiceUsage(
  db: D1Database,
  formId: string,
  blockName: string,
  limit = 5000,
): Promise<Map<string, number>> {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 20000));
  const result = await db
    .prepare(
      `SELECT data FROM form_submissions
       WHERE form_id = ? AND is_test = 0
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(formId, safeLimit)
    .all<{ data: string }>();

  const counts = new Map<string, number>();
  for (const row of result.results) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.data || '{}') as Record<string, unknown>;
    } catch {
      continue;
    }
    const value = parsed[blockName];
    const labels = Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)];
    for (const label of labels) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return counts;
}
