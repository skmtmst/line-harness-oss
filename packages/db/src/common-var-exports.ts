import type { CommonVar } from './common-vars.js';

/**
 * 共通情報の監査付きCSV出力（N-192）。
 *
 * 画面に読み込めた最大200件を端末でCSV化する方式だと、200件を超える
 * 共通情報は届かず、誰が何を出力したかも残らない。ここでは出力を
 * 台帳（common_var_export_jobs）に記録し、workerがページングで全件を
 * 書き出した成果物を期限つきで保管する。
 */

export type CommonVarExportStatus = 'queued' | 'running' | 'completed' | 'failed' | 'expired';

export interface CommonVarExportJob {
  id: string;
  line_account_id: string;
  filter_json: string;
  status: CommonVarExportStatus;
  total_count: number | null;
  processed_count: number;
  row_count: number | null;
  byte_size: number | null;
  csv_text: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  expires_at: string;
  failure_reason: string | null;
}

export interface CommonVarExportFilter {
  accountId: string;
  folderId?: string;
  /** true ならフォルダ未分類（folder_id IS NULL）だけを対象にする。 */
  ungrouped?: boolean;
}

/** ダウンロードの有効期間。friend_export_jobs と同じ 7 日。 */
export const COMMON_VAR_EXPORT_TTL_MS = 7 * 86_400_000;

/** 生成ループが1回に読む行数。使用先の集計はこの単位で batch する。 */
export const COMMON_VAR_EXPORT_PAGE_SIZE = 200;

/*
 * 成果物は台帳行に CSV 本文ごと置く（出力時点の写し）。上限を決めておき、
 * 超えたら失敗にしてフォルダ分割へ誘導する。画面上限 200 件 × 長文でも
 * 余裕のある 4MiB。
 */
export const COMMON_VAR_EXPORT_MAX_BYTES = 4 * 1024 * 1024;

export function parseCommonVarExportFilter(filterJson: string): CommonVarExportFilter {
  try {
    const parsed = JSON.parse(filterJson) as { accountId?: unknown; folderId?: unknown; ungrouped?: unknown };
    return {
      accountId: typeof parsed.accountId === 'string' ? parsed.accountId : '',
      folderId: typeof parsed.folderId === 'string' && parsed.folderId ? parsed.folderId : undefined,
      ungrouped: parsed.ungrouped === true ? true : undefined,
    };
  } catch {
    return { accountId: '' };
  }
}

export async function createCommonVarExportJob(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    filter: CommonVarExportFilter;
    createdBy: string;
    createdByName: string;
    createdAt: string;
    expiresAt: string;
  },
): Promise<CommonVarExportJob> {
  await db.prepare(`INSERT INTO common_var_export_jobs
    (id, line_account_id, filter_json, status, processed_count,
     created_by, created_by_name, created_at, expires_at)
    VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?)`).bind(
    input.id, input.lineAccountId, JSON.stringify(input.filter),
    input.createdBy, input.createdByName, input.createdAt, input.expiresAt,
  ).run();
  return (await getCommonVarExportJob(db, input.id))!;
}

export async function getCommonVarExportJob(
  db: D1Database,
  id: string,
): Promise<CommonVarExportJob | null> {
  return db.prepare('SELECT * FROM common_var_export_jobs WHERE id = ?')
    .bind(id).first<CommonVarExportJob>();
}

export async function listCommonVarExportJobs(
  db: D1Database,
  lineAccountId: string,
  limit = 20,
): Promise<CommonVarExportJob[]> {
  const result = await db.prepare(`SELECT * FROM common_var_export_jobs
    WHERE line_account_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
    .bind(lineAccountId, Math.max(1, Math.min(Math.floor(limit), 100))).all<CommonVarExportJob>();
  return result.results;
}

export async function markCommonVarExportRunning(
  db: D1Database,
  id: string,
  startedAt: string,
  totalCount: number,
): Promise<void> {
  await db.prepare(`UPDATE common_var_export_jobs
    SET status = 'running', started_at = ?, total_count = ?
    WHERE id = ? AND status = 'queued'`).bind(startedAt, totalCount, id).run();
}

export async function updateCommonVarExportProgress(
  db: D1Database,
  id: string,
  processedCount: number,
): Promise<void> {
  await db.prepare('UPDATE common_var_export_jobs SET processed_count = ? WHERE id = ?')
    .bind(processedCount, id).run();
}

export async function completeCommonVarExport(
  db: D1Database,
  id: string,
  result: { rowCount: number; csvText: string; byteSize: number; finishedAt: string },
): Promise<void> {
  await db.prepare(`UPDATE common_var_export_jobs
    SET status = 'completed', row_count = ?, csv_text = ?, byte_size = ?,
        processed_count = ?, finished_at = ?
    WHERE id = ?`).bind(
    result.rowCount, result.csvText, result.byteSize, result.rowCount, result.finishedAt, id,
  ).run();
}

export async function failCommonVarExport(
  db: D1Database,
  id: string,
  failureReason: string,
  finishedAt: string,
): Promise<void> {
  await db.prepare(`UPDATE common_var_export_jobs
    SET status = 'failed', failure_reason = ?, finished_at = ?
    WHERE id = ?`).bind(failureReason, finishedAt, id).run();
}

/** 期限切れへの遷移は読み取り時に確定させる（cron 不要）。 */
export async function markCommonVarExportExpired(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare(`UPDATE common_var_export_jobs SET status = 'expired'
    WHERE id = ? AND status = 'completed'`).bind(id).run();
}

/**
 * 書き出し対象の全件を LIMIT/OFFSET でページングして読む。
 *
 * `getCommonVars` は一覧表示用に 200 件で頭打ちするため使わず、
 * 同じ並び順（名前順・id タイブレーク）と次回予約の概要だけを持つ
 * 専用の読み口にする。途中で行が増減しても重複・欠落が出にくいよう
 * ORDER BY name ASC, id ASC を固定する。
 */
export async function listCommonVarsForExport(
  db: D1Database,
  opts: { lineAccountId: string; folderId?: string; ungrouped?: boolean; limit: number; offset: number },
): Promise<CommonVar[]> {
  const limit = Math.max(1, Math.floor(opts.limit));
  const offset = Math.max(0, Math.floor(opts.offset));
  const overview = `,
    (SELECT s.effective_from FROM common_var_schedules s
      WHERE s.var_id = common_vars.id AND s.applied_at IS NULL
      ORDER BY s.effective_from ASC, s.id ASC LIMIT 1) AS next_effective_from,
    (SELECT s.value FROM common_var_schedules s
      WHERE s.var_id = common_vars.id AND s.applied_at IS NULL
      ORDER BY s.effective_from ASC, s.id ASC LIMIT 1) AS next_value`;
  if (opts.folderId) {
    const result = await db
      .prepare(`SELECT common_vars.* ${overview} FROM common_vars
        WHERE line_account_id = ? AND archived_at IS NULL AND folder_id = ?
        ORDER BY name ASC, id ASC LIMIT ? OFFSET ?`)
      .bind(opts.lineAccountId, opts.folderId, limit, offset)
      .all<CommonVar>();
    return result.results;
  }
  if (opts.ungrouped) {
    const result = await db
      .prepare(`SELECT common_vars.* ${overview} FROM common_vars
        WHERE line_account_id = ? AND archived_at IS NULL AND folder_id IS NULL
        ORDER BY name ASC, id ASC LIMIT ? OFFSET ?`)
      .bind(opts.lineAccountId, limit, offset)
      .all<CommonVar>();
    return result.results;
  }
  const result = await db
    .prepare(`SELECT common_vars.* ${overview} FROM common_vars
      WHERE line_account_id = ? AND archived_at IS NULL
      ORDER BY name ASC, id ASC LIMIT ? OFFSET ?`)
    .bind(opts.lineAccountId, limit, offset)
    .all<CommonVar>();
  return result.results;
}
