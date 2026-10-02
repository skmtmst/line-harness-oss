import { jstNow } from '@line-crm/db';

export type MemberRankSyncConfig = { enabled?: string; baseUrl?: string; secret?: string };
type SyncRow = {
  id: string; operation_id: string; friend_id: string; customer_id: string | null;
  rank_key: string; actor: string; reason: string; expected_version: number | null;
  status: 'pending' | 'failed' | 'synced'; error_code: string | null; error_reason: string | null;
  result_version: number | null; duplicate: number; attempts: number;
};
const reasons: Record<string, string> = {
  invalid_input: 'ECの会員IDまたは送信内容が正しくありません',
  member_not_found: 'ECに会員が見つかりません',
  rank_not_found: 'ECに移し先のランクが見つかりません',
  version_conflict: 'ECの会員の版が変わりました。新しい変更として判断してください',
  idempotency_conflict: '同じ重複防止の鍵で異なる内容が送られています',
  save_failed: 'ECで会員のランクを保存できませんでした',
  transport_failed: 'ECにつながりませんでした。時間をおいてやり直してください',
  invalid_response: 'ECから正しい会員別の結果を取得できませんでした',
  http_failed: 'ECが送信を受け付けませんでした。接続設定とECの配備状態を確認してください',
};
class SyncError extends Error {
  constructor(readonly code: string) { super(reasons[code]); }
}

function customerId(row: SyncRow): number | null {
  if (!row.customer_id || !/^[1-9]\d*$/.test(row.customer_id)) return null;
  const id = Number(row.customer_id);
  return Number.isSafeInteger(id) ? id : null;
}
function version(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** 本文・版・担当者・鍵は再送でも固定。署名の時刻だけ更新する。 */
async function post(config: MemberRankSyncConfig, path: string, payload: unknown, fetcher: typeof fetch) {
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).length > 65_536) throw new SyncError('invalid_input');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.secret!),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const signature = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  let response: Response;
  try {
    response = await fetcher(`${config.baseUrl!.replace(/\/$/, '')}/line-harness/member-rank${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nen-Timestamp': timestamp,
        'X-Nen-Signature': `sha256=${signature}` }, body, signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new SyncError('transport_failed'); }
  // 会員別の口では409も成功にしない。200のresultsを必ず確認する。
  if (response.status !== 200) throw new SyncError('http_failed');
  const data = await response.json().catch(() => null) as { results?: Array<Record<string, unknown>> } | null;
  if (!data || !Array.isArray(data.results)) throw new SyncError('invalid_response');
  return data.results;
}

async function fail(db: D1Database, row: SyncRow, code: string) {
  const safeCode = Object.hasOwn(reasons, code) ? code : 'invalid_response';
  // ECから返された自由文・本文・例外は保存しない（秘密値を混入させない）。
  await db.prepare(`UPDATE nen_member_rank_sync SET status = 'failed', error_code = ?, error_reason = ?, updated_at = ?
    WHERE id = ? AND status <> 'synced'`).bind(safeCode, reasons[safeCode], jstNow(), row.id).run();
}

export async function getMemberRankSync(db: D1Database, accountId: string, operationId: string, afterId = '') {
  const counts = await db.prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(status = 'synced'), 0) AS succeeded, COALESCE(SUM(status = 'failed'), 0) AS failed,
    COALESCE(SUM(status = 'pending'), 0) AS pending
    FROM nen_member_rank_sync WHERE line_account_id = ? AND operation_id = ?`)
    .bind(accountId, operationId).first<{ total: number; succeeded: number; failed: number; pending: number }>();
  const { results } = await db.prepare(`SELECT * FROM nen_member_rank_sync
    WHERE line_account_id = ? AND operation_id = ? AND id > ? ORDER BY id LIMIT 101`)
    .bind(accountId, operationId, afterId).all<SyncRow>();
  const page = results.slice(0, 100);
  return {
    operationId, total: Number(counts?.total ?? 0), succeeded: Number(counts?.succeeded ?? 0),
    failed: Number(counts?.failed ?? 0), pending: Number(counts?.pending ?? 0),
    results: page.map((row) => ({ id: row.id, friendId: row.friend_id, customerId: customerId(row),
      status: row.status, code: row.error_code, reason: row.error_reason, version: row.result_version,
      duplicate: row.duplicate === 1, attempts: row.attempts })),
    nextCursor: results.length > 100 ? page.at(-1)!.id : null,
  };
}

/** 一回100会員まで。成功済みは再送せず、残りは同じ操作IDでやり直す。 */
export async function syncMemberRanks(db: D1Database, accountId: string, operationId: string,
  config: MemberRankSyncConfig, fetcher: typeof fetch = fetch) {
  if (config.enabled !== 'true' || !config.baseUrl || !config.secret) {
    return { ...(await getMemberRankSync(db, accountId, operationId)), status: 'pending' as const };
  }
  const { results: rows } = await db.prepare(`SELECT * FROM nen_member_rank_sync
    WHERE line_account_id = ? AND operation_id = ? AND status <> 'synced' ORDER BY attempts, id LIMIT 100`)
    .bind(accountId, operationId).all<SyncRow>();
  // 同じEC会員が複数の友だちに結び付いていても、結果を取り違えない。
  const seen = new Set<number>();
  const selected = rows.filter((row) => {
    const id = customerId(row);
    if (id === null) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const ready: SyncRow[] = [];
  for (const row of selected) {
    await db.prepare('UPDATE nen_member_rank_sync SET attempts = attempts + 1, updated_at = ? WHERE id = ?')
      .bind(jstNow(), row.id).run();
    if (customerId(row) === null) await fail(db, row, 'invalid_input');
    else ready.push(row);
  }
  const unversioned = ready.filter((row) => row.expected_version === null);
  if (unversioned.length) {
    try {
      const results = await post(config, '/versions', { customerIds: unversioned.map(customerId) }, fetcher);
      for (const row of unversioned) {
        const found = results.filter((result) => result.customerId === customerId(row));
        const result = found.length === 1 ? found[0] : undefined;
        if (!result || result.success !== true || !version(result.version)) {
          await fail(db, row, result?.success === false ? String(result.code) : 'invalid_response');
          continue;
        }
        // 同時のやり直しが別の版を取っても、最初に保存できた版だけ使う。
        await db.prepare(`UPDATE nen_member_rank_sync SET expected_version = ?, updated_at = ?
          WHERE id = ? AND expected_version IS NULL`).bind(result.version, jstNow(), row.id).run();
        row.expected_version = (await db.prepare('SELECT expected_version FROM nen_member_rank_sync WHERE id = ?')
          .bind(row.id).first<{ expected_version: number }>())!.expected_version;
      }
    } catch (error) {
      for (const row of unversioned) await fail(db, row, error instanceof SyncError ? error.code : 'invalid_response');
    }
  }
  const send = ready.filter((row) => row.expected_version !== null);
  if (send.length) {
    try {
      const results = await post(config, '', { actor: send[0]!.actor,
        members: send.map((row) => ({ customerId: customerId(row), rankKey: row.rank_key, reason: row.reason,
          expectedVersion: row.expected_version, idempotencyKey: row.id })) }, fetcher);
      for (const row of send) {
        const found = results.filter((result) => result.customerId === customerId(row));
        const result = found.length === 1 ? found[0] : undefined;
        if (!result || result.success !== true || !version(result.version)
          || result.version !== row.expected_version! + 1 || result.rankKey !== row.rank_key
          || typeof result.duplicate !== 'boolean') {
          await fail(db, row, result?.success === false ? String(result.code) : 'invalid_response');
          continue;
        }
        await db.prepare(`UPDATE nen_member_rank_sync SET status = 'synced', error_code = NULL, error_reason = NULL,
          result_version = ?, duplicate = ?, updated_at = ? WHERE id = ?`)
          .bind(result.version, result.duplicate ? 1 : 0, jstNow(), row.id).run();
      }
    } catch (error) {
      for (const row of send) await fail(db, row, error instanceof SyncError ? error.code : 'invalid_response');
    }
  }
  const summary = await getMemberRankSync(db, accountId, operationId);
  return { ...summary, status: summary.pending > 0 ? 'pending' as const
    : summary.failed > 0 ? 'failed' as const : 'synced' as const };
}
