import { logger } from '@line-crm/shared/server';
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
import { captureMediaPurgeImpacts, finishMediaPurgeImpacts, type PurgeMediaKey } from './tenant-media-impact.js';
import { beginPurgeMedia, lockPurgeMedia, renewPurgeMedia } from './tenant-purge-media-lock.js';
import { preserveForeignBanners } from './tenant-purge-banner-placeholder.js';


/**
 * 退会・無料体験切れから保存期限が過ぎた統括(テナント)の顧客データを消す（★36-2）。
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

/** A banner without a store belongs to the tenant of its oldest banner record. */
function tenantMediaCondition(table: 'media' | 'media_versions'): string {
  const owner = `(media.line_account_id IN (SELECT id FROM line_accounts WHERE tenant_id=?)
    OR (media.line_account_id IS NULL AND (SELECT tenant_id FROM banner_images b WHERE b.media_id=media.id ORDER BY b.created_at,b.id LIMIT 1)=?))`;
  return table === 'media' ? owner : `media_versions.media_id IN (SELECT media.id FROM media WHERE ${owner})`;
}

function tenantJobOwner(tenantId: string): string { return `tenant-purge:${tenantId}`; }

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
  /** R2の削除に失敗し、次回の再試行に残した画像の数。 */
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

/**
 * 回答フォームだけの消す条件。表の分類どおり利用アカウント（form_accounts）
 * をたどるが、それだけでは統括をまたいで使い回している物まで消してしまう。
 * 別の統括の店に紐づいている物は、どちらの統括の削除でも消さない。
 * 所属の決まっていない店（tenant_id が空）の紐づけも「別」扱いにして消さない。
 */
function formsPurgeCondition(): string {
  return `${tenantScopeCondition('forms')} AND NOT EXISTS (
    SELECT 1 FROM form_accounts fa_other
    WHERE fa_other.form_id = forms.id
      AND fa_other.line_account_id IN (
        SELECT id FROM line_accounts WHERE tenant_id IS NULL OR tenant_id <> ?
      )
  )`;
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
  const purgeOwner = crypto.randomUUID();
  // Keep send claims and deletion jobs until their media have been processed.
  const tablesInOrder = purgeTablesChildFirst().filter(table => table !== 'media_send_claims' && table !== 'media_deletion_jobs' && table !== 'media_purge_impact_pending');
  const accountsIndex = tablesInOrder.indexOf('line_accounts');
  tablesInOrder.splice(accountsIndex < 0 ? tablesInOrder.length : accountsIndex, 0, 'media_send_claims', 'media_deletion_jobs', 'media_purge_impact_pending');

  // 子が先、親が後。親を先に消すと子が親をたどれなくなって消し残る。
  tables: for (const table of tablesInOrder) {
    if (remaining <= 0) {
      out.finished = false;
      break;
    }
    // 回答フォームだけ統括またぎの使い回しを守る条件にする（? が1つ増える）。
    const sharedForm = table === 'forms';
    const tenantMedia = table === 'media' || table === 'media_versions';
    const tenantJob = table === 'media_deletion_jobs' || table === 'media_purge_impact_pending';
    const ownerColumn = table === 'media_deletion_jobs' ? 'line_account_id' : 'owner_line_account_id';
    const condition = sharedForm ? formsPurgeCondition() : tenantMedia ? tenantMediaCondition(table) : tenantJob
      ? `(${tenantScopeCondition(table)} OR ${table}.${ownerColumn}=?)` : tenantScopeCondition(table);
    const tenantParams = sharedForm || tenantMedia ? [tenant.id, tenant.id] : tenantJob ? [tenant.id,tenantJobOwner(tenant.id)] : [tenant.id];
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
        const objects = await deleteR2Objects(env, table, condition, keyColumns, tenant.id, tenantParams, chunk, purgeOwner, now);
        out.deletedObjects += objects.deleted;
        out.failedObjects += objects.failed;
        if (['form_submission_files', 'media', 'media_versions'].includes(table) && objects.failed > 0) {
          // 次回も削除を再試行できるよう、R2 キーと親行への参照を保つ。
          out.finished = false;
          break tables;
        }
      }

      const deleted = await env.DB
        .prepare(
          `DELETE FROM ${table}
            WHERE rowid IN (
              SELECT ${table}.rowid FROM ${table} WHERE ${condition} ORDER BY ${table}.rowid LIMIT ?
            )`,
        )
        .bind(...tenantParams, chunk)
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
  tenantParams: string[],
  chunk: number,
  purgeOwner: string,
  now: string,
): Promise<{ deleted: number; failed: number }> {
  const selected = await env.DB
    .prepare(
      `SELECT ${columns.map((column) => `${table}.${column}`).join(', ')}${table === 'media' ? ', media.id AS impact_media_id, media.line_account_id AS impact_account_id' : table === 'media_versions' ? ', media_versions.media_id AS impact_media_id, (SELECT line_account_id FROM media WHERE id=media_versions.media_id) AS impact_account_id' : ''}
         FROM ${table} WHERE ${condition} ORDER BY ${table}.rowid LIMIT ?`,
    )
    .bind(...tenantParams, chunk)
    .all<Record<string, string | null>>();

  const keys = (selected.results ?? [])
    .flatMap((row) => columns.map((column) => row[column]))
    .filter((key): key is string => typeof key === 'string' && key.length > 0);
  if (keys.length === 0) return { deleted: 0, failed: 0 };
  if (!env.IMAGES) return { deleted: 0, failed: keys.length };
  const lockedMedia: string[] = [];
  const releaseLeases = async () => {
    if (!lockedMedia.length) return;
    await env.DB.prepare(`UPDATE media_deletion_jobs SET lease_owner=NULL,lease_expires_at=NULL,updated_at=?
      WHERE lease_owner=? AND media_id IN (SELECT value FROM json_each(?))`)
      .bind(now,purgeOwner,JSON.stringify(lockedMedia)).run();
  };
  if (table === 'media' || table === 'media_versions') {
    const media = new Map<string, string>();
    for (const row of selected.results ?? []) {
      if (!row.impact_media_id) return { deleted: 0, failed: keys.length };
      media.set(row.impact_media_id, row.impact_account_id ?? tenantJobOwner(tenantId));
    }
    const instant = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + 300_000).toISOString();
    const entries = [...media].map(([id,accountId])=>({id,accountId}));
    if (!await lockPurgeMedia(env.DB,{media:entries,tenantId,tenantMarker:tenantJobOwner(tenantId),owner:purgeOwner,now:instant,leaseUntil})) return {deleted:0,failed:keys.length};
    lockedMedia.push(...media.keys());
    if (!await beginPurgeMedia(env.DB,{mediaIds:lockedMedia,owner:purgeOwner,now:instant})) {
      await releaseLeases(); return {deleted:0,failed:keys.length};
    }
  }

  try {
    const mediaKeys: PurgeMediaKey[] = [];
    if (table === 'media' || table === 'media_versions') {
      for (const row of selected.results ?? []) {
        for (const column of columns) {
          const key = row[column];
          if (key && row.impact_media_id) mediaKeys.push({key,mediaId:row.impact_media_id,
            ownerAccount:row.impact_account_id ?? tenantJobOwner(tenantId), includeLive:table === 'media'});
        }
      }
    }
    const impacts = await captureMediaPurgeImpacts(env.DB,tenantId,mediaKeys,now);
    if (lockedMedia.length) {
      const instant = new Date().toISOString();
      if (!await renewPurgeMedia(env.DB,{mediaIds:lockedMedia,owner:purgeOwner,now:instant,leaseUntil:new Date(Date.now()+300_000).toISOString()})) {
        await releaseLeases(); return {deleted:0,failed:keys.length};
      }
    }
    if (table === 'media_versions') {
      // バナーが参照する現行キーが旧版と同じ場合も、画像を消す前に影響を固定する。
      const live = await env.DB.prepare(`SELECT id,line_account_id,r2_key FROM media WHERE id IN (SELECT value FROM json_each(?))`)
        .bind(JSON.stringify(lockedMedia)).all<{id:string;line_account_id:string|null;r2_key:string}>();
      await captureMediaPurgeImpacts(env.DB,tenantId,live.results.map(row=>({key:row.r2_key,mediaId:row.id,ownerAccount:row.line_account_id ?? tenantJobOwner(tenantId),includeLive:true})),now);
    }
    if (table === 'media' || table === 'media_versions') await preserveForeignBanners(env.DB,tenantId,lockedMedia);
    await env.IMAGES.delete(keys);
    await finishMediaPurgeImpacts(env.DB, impacts, now);
    return { deleted: keys.length, failed: 0 };
  } catch (error) {
    // 再試行に必要なキーと親行を残す。
    logger.error("tenant_data_purge.delete_r2_objects_failed");
    await releaseLeases();
    return { deleted: 0, failed: keys.length };
  }
}
