import type { FormSubmitClaim } from '../form-submit-claim-types.js';
import { jstNow } from '../utils.js';
import { type FormSubmitClaimScope, type CreateFormSubmitClaimInput } from './types.js';


export function claimBindings(scope: FormSubmitClaimScope): string[] {
  return [scope.tenantId, scope.lineAccountId, scope.formId, scope.friendId, scope.key];
}

export const CLAIM_SCOPE_WHERE =
  `tenant_id = ? AND line_account_id = ? AND form_id = ? AND friend_id = ? AND idempotency_key = ?`;

/** 予約行を読む。なければ NULL。 */
export async function getFormSubmitClaim(
  db: D1Database,
  scope: FormSubmitClaimScope,
): Promise<FormSubmitClaim | null> {
  return db
    .prepare(`SELECT * FROM form_submit_claims WHERE ${CLAIM_SCOPE_WHERE}`)
    .bind(...claimBindings(scope))
    .first<FormSubmitClaim>();
}

/**
 * 回答 id から予約を読む(N-168)。
 *
 * 管理画面が「この回答の後処理はどこまで終わったか」を出し、失敗した工程
 * だけを再実行する入口で使う。予約は回答の保存と同じ id を持つ。
 */
export async function getFormSubmitClaimBySubmissionId(
  db: D1Database,
  submissionId: string,
): Promise<FormSubmitClaim | null> {
  return db
    .prepare(`SELECT * FROM form_submit_claims WHERE submission_id = ?`)
    .bind(submissionId)
    .first<FormSubmitClaim>();
}

/** 回答一覧用に、回答 id の束から予約をまとめて読む。 */
export async function getFormSubmitClaimsBySubmissionIds(
  db: D1Database,
  submissionIds: string[],
): Promise<Map<string, FormSubmitClaim>> {
  const unique = [...new Set(submissionIds)].filter(Boolean);
  const claims = new Map<string, FormSubmitClaim>();
  if (unique.length === 0) return claims;
  const result = await db
    .prepare(
      `SELECT * FROM form_submit_claims WHERE submission_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(unique))
    .all<FormSubmitClaim>();
  for (const row of result.results) {
    if (row.submission_id) claims.set(row.submission_id, row);
  }
  return claims;
}

/**
 * 予約行を原子的に確保する。同時送信の片方だけが true で返る。
 *
 * すでに同じ scope・キーの行があるときは作らず、残っている行を返す。
 * (主キーが同時実行を 1 行にまとめる)
 */
export async function createFormSubmitClaim(
  db: D1Database,
  input: CreateFormSubmitClaimInput,
): Promise<{ claimed: boolean; claim: FormSubmitClaim }> {
  const now = jstNow();
  try {
    await db
      .prepare(
        `INSERT INTO form_submit_claims
           (tenant_id, line_account_id, form_id, friend_id, idempotency_key,
            request_hash, status, steps, webhook, submission_id,
            owner, version, lease_generation, effect_stats,
            created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 'in_progress', '[]', NULL, ?, ?, 1, 1, '{}', ?, ?, ?)`,
      )
      .bind(
        input.tenantId,
        input.lineAccountId,
        input.formId,
        input.friendId,
        input.key,
        input.requestHash,
        input.submissionId,
        input.owner,
        now,
        now,
        input.expiresAt,
      )
      .run();
  } catch {
    const existing = await getFormSubmitClaim(db, input);
    if (!existing) throw new Error('form_submit_claim_conflict_without_row');
    return { claimed: false, claim: existing };
  }
  return {
    claimed: true,
    claim: (await getFormSubmitClaim(db, input))!,
  };
}

/**
 * 止まった予約の横取り。failed は即時、in_progress は古いものだけ所有者を
 * 書き換える。読み取った所有者と版(CAS)が一致するときだけ書き換え、
 * 版と借りの世代を +1 する。書き換えた試行だけ taken が true で返り、
 * 世代番号 generation で再開する。古い版の試行の書き込みは、工程の記録
 * 側の版ガードで捨てられる(横取りされた試行は副作用を重ねない)。
 * (friend_scenarios の楽観ロックと同じ流儀)
 */
export async function takeoverFormSubmitClaim(
  db: D1Database,
  scope: FormSubmitClaimScope,
  owner: string,
  staleBefore: string,
  observed: Pick<FormSubmitClaim, 'owner' | 'version'>,
): Promise<{ taken: boolean; generation: number }> {
  const result = await db
    .prepare(
      `UPDATE form_submit_claims
          SET owner = ?, status = 'in_progress',
              version = version + 1, lease_generation = lease_generation + 1,
              updated_at = ?
        WHERE ${CLAIM_SCOPE_WHERE}
          AND owner = ? AND version = ?
          AND (status = 'failed' OR (status = 'in_progress' AND updated_at < ?))`,
    )
    .bind(owner, jstNow(), ...claimBindings(scope), observed.owner, observed.version, staleBefore)
    .run();
  if ((result.meta.changes ?? 0) === 0) return { taken: false, generation: 0 };
  const taken = await getFormSubmitClaim(db, scope);
  return { taken: true, generation: taken?.lease_generation ?? 0 };
}

/** 工程の記録を読む。壊れていれば空として扱う。 */
export function readFormSubmitClaimSteps(claim: Pick<FormSubmitClaim, 'steps'>): string[] {
  try {
    const parsed: unknown = JSON.parse(claim.steps || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * 終わった工程を 1 件足す。所有者か版が変わっていたら足さず false を返す。
 * (横取りされた試行は副作用を重ねない。版の柵)
 */
export async function appendFormSubmitClaimStep(
  db: D1Database,
  scope: FormSubmitClaimScope,
  owner: string,
  step: string,
  version: number,
): Promise<boolean> {
  const claim = await getFormSubmitClaim(db, scope);
  if (!claim || claim.owner !== owner || claim.version !== version) return false;
  const steps = readFormSubmitClaimSteps(claim);
  const now = jstNow();
  let completedAt: Record<string, string> = {};
  try {
    const parsed = JSON.parse(claim.step_completed_at_json ?? '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      completedAt = parsed as Record<string, string>;
    }
  } catch { /* 旧記録の不明な日時は埋めない。 */ }
  if (!steps.includes(step)) {
    steps.push(step);
    completedAt = { ...completedAt, [step]: now };
  }
  const result = await db
    .prepare(
      `UPDATE form_submit_claims
          SET steps = ?, step_completed_at_json = ?, updated_at = ?
        WHERE ${CLAIM_SCOPE_WHERE} AND owner = ? AND version = ?`,
    )
    .bind(JSON.stringify(steps), JSON.stringify(completedAt), now, ...claimBindings(scope), owner, version)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Webhook の結果を残し、工程にも記録する。版の柵つき。 */
export async function saveFormSubmitClaimWebhook(
  db: D1Database,
  scope: FormSubmitClaimScope,
  owner: string,
  webhook: unknown,
  version: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE form_submit_claims
          SET webhook = ?, updated_at = ?
        WHERE ${CLAIM_SCOPE_WHERE} AND owner = ? AND version = ?`,
    )
    .bind(JSON.stringify(webhook), jstNow(), ...claimBindings(scope), owner, version)
    .run();
  if ((result.meta.changes ?? 0) === 0) return false;
  return appendFormSubmitClaimStep(db, scope, owner, 'webhook', version);
}

/** 予約を完了にする。保存済みの回答を返すようになる。版の柵つき。 */
export async function completeFormSubmitClaim(
  db: D1Database,
  scope: FormSubmitClaimScope,
  owner: string,
  version: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE form_submit_claims
          SET status = 'completed', updated_at = ?
        WHERE ${CLAIM_SCOPE_WHERE} AND owner = ? AND version = ?`,
    )
    .bind(jstNow(), ...claimBindings(scope), owner, version)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * 予約を失敗に残す。回答は消さず、同じキーでの再送が未完の工程を補完する。
 * (所有者以外の試行が状態を変えないよう owner と版を見る)
 */
export async function failFormSubmitClaim(
  db: D1Database,
  scope: FormSubmitClaimScope,
  owner: string,
  version: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE form_submit_claims
          SET status = 'failed', updated_at = ?
        WHERE ${CLAIM_SCOPE_WHERE} AND owner = ? AND version = ?`,
    )
    .bind(jstNow(), ...claimBindings(scope), owner, version)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** layout の効果ごとの集計を読む。壊れていれば空として扱う。 */
export function readFormSubmitClaimEffectStats(
  claim: Pick<FormSubmitClaim, 'effect_stats'>,
): Record<string, { attempted: number; succeeded: number; failed: number }> {
  try {
    const parsed: unknown = JSON.parse(claim.effect_stats || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, { attempted: number; succeeded: number; failed: number }> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = value as { attempted?: unknown; succeeded?: unknown; failed?: unknown };
      out[String(key)] = {
        attempted: Math.max(0, Math.floor(Number(entry?.attempted) || 0)),
        succeeded: Math.max(0, Math.floor(Number(entry?.succeeded) || 0)),
        failed: Math.max(0, Math.floor(Number(entry?.failed) || 0)),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * layout の効果1件の集計を残す。同じ効果の実行は上書きし、再開時の合計が
 * 重ならないようにする。所有者か版が違うときは残さず false を返す。
 */
export async function saveFormSubmitClaimEffectStats(
  db: D1Database,
  scope: FormSubmitClaimScope,
  owner: string,
  version: number,
  effectId: string,
  stats: { attempted: number; succeeded: number; failed: number },
): Promise<boolean> {
  const claim = await getFormSubmitClaim(db, scope);
  if (!claim || claim.owner !== owner || claim.version !== version) return false;
  const merged = readFormSubmitClaimEffectStats(claim);
  merged[effectId] = {
    attempted: Math.max(0, Math.floor(stats.attempted)),
    succeeded: Math.max(0, Math.floor(stats.succeeded)),
    failed: Math.max(0, Math.floor(stats.failed)),
  };
  const result = await db
    .prepare(
      `UPDATE form_submit_claims
          SET effect_stats = ?, updated_at = ?
        WHERE ${CLAIM_SCOPE_WHERE} AND owner = ? AND version = ?`,
    )
    .bind(JSON.stringify(merged), jstNow(), ...claimBindings(scope), owner, version)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
