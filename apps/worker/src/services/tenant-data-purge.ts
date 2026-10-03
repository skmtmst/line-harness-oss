import {
  listTenantsDueForPurge,
  markExpiredTrialRetentionAnchors,
  markTenantDataPurged,
  purgeTablesChildFirst,
  recordTenantDataPurgeAudit,
  RETENTION_R2_KEY_COLUMNS,
  tenantScopeCondition,
  toJstString,
  type TenantRetention,
} from '@line-crm/db';

/**
 * 退会・無料体験切れから保存期限が過ぎた統括(テナント)の顧客データを消す（★V6 36-2）。
 *
 * 6時間毎のcronから呼ばれる。1回で全部を消し切る前提は置かない。
 * 消した行数が上限に届いたらそこで止め、次の回が同じ統括をもう一度拾って
 * 続きから消す。途中で止まっても消し残りが「消していない状態」のまま
 * 正しく残るよう、子の表から先に消す。
 *
 * 誰をいつ消すかの判定と、分類表(purge/retain/global)は packages/db にある。
 * ここは「実際に消す」だけを持つ。
 */

/** 1回のcronで扱う統括の数。多くしても1回の行数上限で頭打ちになる。 */
const TENANTS_PER_RUN = 3;
/** 1回のcronで消す行数の上限。ここに届いたら途中でも止めて次の回に回す。 */
const ROWS_PER_RUN = 5000;
/** 1文で消す行数。D1の1文が長くなりすぎないようにする。 */
const ROWS_PER_STATEMENT = 200;

/** 表ごとのR2鍵の列。1つの表に複数列ある場合もまとめて扱う。 */
const R2_KEY_COLUMNS_BY_TABLE = RETENTION_R2_KEY_COLUMNS.reduce<Record<string, string[]>>(
  (acc, entry) => {
    (acc[entry.table] ??= []).push(entry.column);
    return acc;
  },
  {},
);

export interface TenantDataPurgeEnv {
  DB: D1Database;
  IMAGES?: R2Bucket;
}

export interface TenantDataPurgeResult {
  /** 無料体験が切れていて保存起点を入れた統括の数。 */
  anchoredTrials: number;
  /** 今回消す対象として取り出した統括の数。 */
  tenants: number;
  /** 今回で全ての表を消し終えた統括の数。 */
  completed: number;
  deletedRows: number;
  deletedObjects: number;
  /** R2の削除に失敗した画像の数。行は消すので次回は拾えない。 */
  failedObjects: number;
}

export async function processTenantDataPurge(
  env: TenantDataPurgeEnv,
  options: { now?: string } = {},
): Promise<TenantDataPurgeResult> {
  const now = options.now ? toJstString(new Date(options.now)) : toJstString(new Date());

  // 無料体験の終了はStripeから通知が来ないので、ここで拾って起点を入れる。
  const anchoredTrials = await markExpiredTrialRetentionAnchors(env.DB, now);

  const tenants = await listTenantsDueForPurge(env.DB, { now, limit: TENANTS_PER_RUN });
  const result: TenantDataPurgeResult = {
    anchoredTrials,
    tenants: tenants.length,
    completed: 0,
    deletedRows: 0,
    deletedObjects: 0,
    failedObjects: 0,
  };

  // 行数の上限は統括をまたいで共有する。1回のcronの仕事量を一定に保つ。
  let budget = ROWS_PER_RUN;
  for (const tenant of tenants) {
    if (budget <= 0) break;
    const purged = await purgeOneTenant(env, tenant, now, budget);
    budget -= purged.deletedRows;
    result.deletedRows += purged.deletedRows;
    result.deletedObjects += purged.deletedObjects;
    result.failedObjects += purged.failedObjects;
    if (purged.finished) result.completed += 1;
  }

  return result;
}

interface OneTenantResult {
  deletedRows: number;
  deletedObjects: number;
  failedObjects: number;
  finished: boolean;
}

async function purgeOneTenant(
  env: TenantDataPurgeEnv,
  tenant: TenantRetention,
  now: string,
  budget: number,
): Promise<OneTenantResult> {
  const startedAt = now;
  const byTable: Record<string, number> = {};
  const out: OneTenantResult = {
    deletedRows: 0,
    deletedObjects: 0,
    failedObjects: 0,
    finished: true,
  };
  let remaining = budget;

  // 子が先、親が後。親を先に消すと子が親をたどれなくなって消し残る。
  for (const table of purgeTablesChildFirst()) {
    if (remaining <= 0) {
      out.finished = false;
      break;
    }
    const condition = tenantScopeCondition(table);
    const keyColumns = R2_KEY_COLUMNS_BY_TABLE[table] ?? [];

    for (;;) {
      const chunk = Math.min(ROWS_PER_STATEMENT, remaining);
      if (chunk <= 0) {
        out.finished = false;
        break;
      }

      // 行を消す前に、同じ行のR2鍵を読んで画像の実体を消す。
      // 読む順と消す順を rowid で揃えるので、両者は必ず同じ行を指す。
      if (keyColumns.length > 0) {
        const objects = await deleteR2Objects(env, table, condition, keyColumns, tenant.id, chunk);
        out.deletedObjects += objects.deleted;
        out.failedObjects += objects.failed;
      }

      const deleted = await env.DB
        .prepare(
          `DELETE FROM ${table}
            WHERE rowid IN (
              SELECT ${table}.rowid FROM ${table} WHERE ${condition} ORDER BY ${table}.rowid LIMIT ?
            )`,
        )
        .bind(tenant.id, chunk)
        .run();
      const changes = deleted.meta?.changes ?? 0;
      if (changes > 0) {
        byTable[table] = (byTable[table] ?? 0) + changes;
        out.deletedRows += changes;
        remaining -= changes;
      }
      // 上限ちょうどで切れた場合も、次の回が同じ表をもう一度見る。
      if (changes < chunk) break;
    }
  }

  const finishedAt = out.finished ? now : null;
  await recordTenantDataPurgeAudit(
    env.DB,
    {
      id: crypto.randomUUID(),
      tenantId: tenant.id,
      reason: tenant.purge_requested_at ? 'immediate' : 'expired',
      retentionAnchorAt: tenant.retention_anchor_at,
      startedAt,
      finishedAt,
      deletedRows: out.deletedRows,
      deletedRowsByTable: byTable,
      deletedObjects: out.deletedObjects,
    },
    now,
  );
  if (out.finished) await markTenantDataPurged(env.DB, tenant.id, now);

  return out;
}

async function deleteR2Objects(
  env: TenantDataPurgeEnv,
  table: string,
  condition: string,
  columns: string[],
  tenantId: string,
  chunk: number,
): Promise<{ deleted: number; failed: number }> {
  const selected = await env.DB
    .prepare(
      `SELECT ${columns.map((column) => `${table}.${column}`).join(', ')}
         FROM ${table} WHERE ${condition} ORDER BY ${table}.rowid LIMIT ?`,
    )
    .bind(tenantId, chunk)
    .all<Record<string, string | null>>();

  const keys = (selected.results ?? [])
    .flatMap((row) => columns.map((column) => row[column]))
    .filter((key): key is string => typeof key === 'string' && key.length > 0);
  if (keys.length === 0) return { deleted: 0, failed: 0 };
  if (!env.IMAGES) return { deleted: 0, failed: keys.length };

  try {
    await env.IMAGES.delete(keys);
    return { deleted: keys.length, failed: 0 };
  } catch (error) {
    // 画像が消せなくても行の削除は進める。顧客データを残し続ける方が重い。
    console.error('tenant data purge r2 delete error:', table, error);
    return { deleted: 0, failed: keys.length };
  }
}
