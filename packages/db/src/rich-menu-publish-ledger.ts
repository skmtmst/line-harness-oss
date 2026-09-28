import { jstNow } from './utils.js';

// K(#822)・O(公開前の確認)の台帳。版・公開の実行・ページの実行・
// 実機の確認を残す。実行の仕組み（lease・journal）は
// rich-menu-manual-publish.ts が担い、ここは見せるための記録だけを持つ。

export type RichMenuVersion = {
  id: string;
  group_id: string;
  version_number: number;
  definition_snapshot: string;
  definition_fingerprint: string;
  status: 'draft' | 'published' | 'archived';
  created_by_staff_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * 下書きの版を凍結する。同じ fingerprint の最新版があれば使い回し、
 * 変わっていれば version_number を1つ足して新しい版にする。
 * 公開はこの版を指して実行し、下書き行の直接書き換えと区別する。
 */
export async function ensureRichMenuVersion(
  db: D1Database,
  input: { id: string; groupId: string; snapshot: string; fingerprint: string; staffId: string; now?: string },
): Promise<RichMenuVersion> {
  const now = input.now ?? jstNow();
  const latest = await db.prepare(
    `SELECT * FROM rich_menu_versions WHERE group_id = ? ORDER BY version_number DESC LIMIT 1`,
  ).bind(input.groupId).first<RichMenuVersion>();
  if (latest && latest.definition_fingerprint === input.fingerprint) return latest;
  const versionNumber = (latest?.version_number ?? 0) + 1;
  await db.prepare(
    `INSERT INTO rich_menu_versions
       (id, group_id, version_number, definition_snapshot, definition_fingerprint,
        status, created_by_staff_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  ).bind(input.id, input.groupId, versionNumber, input.snapshot, input.fingerprint, input.staffId, now, now).run();
  const created = await db.prepare(
    `SELECT * FROM rich_menu_versions WHERE id = ?`,
  ).bind(input.id).first<RichMenuVersion>();
  if (!created) throw new Error('rich menu version insert race: row not found');
  return created;
}

export async function markRichMenuVersionPublished(
  db: D1Database,
  versionId: string,
  now: string = jstNow(),
): Promise<void> {
  await db.prepare(
    `UPDATE rich_menu_versions SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(now, now, versionId).run();
}

export async function getLatestRichMenuVersion(
  db: D1Database,
  groupId: string,
): Promise<RichMenuVersion | null> {
  return db.prepare(
    `SELECT * FROM rich_menu_versions WHERE group_id = ? ORDER BY version_number DESC LIMIT 1`,
  ).bind(groupId).first<RichMenuVersion>();
}

export type RichMenuDeviceConfirmation = {
  id: string;
  group_id: string;
  definition_fingerprint: string;
  version_id: string | null;
  staff_id: string;
  confirmed_at: string;
  created_at: string;
};

/**
 * 「実機で見た」の記録。同じ（group・fingerprint・staff）があれば
 * 時刻だけ更新する。fingerprint が下書きと違う確認は無効（公開門番が弾く）。
 */
export async function recordRichMenuDeviceConfirmation(
  db: D1Database,
  input: { id: string; groupId: string; fingerprint: string; versionId: string | null; staffId: string; now?: string },
): Promise<RichMenuDeviceConfirmation> {
  const now = input.now ?? jstNow();
  await db.prepare(
    `INSERT INTO rich_menu_device_confirmations
       (id, group_id, definition_fingerprint, version_id, staff_id, confirmed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(group_id, definition_fingerprint, staff_id)
     DO UPDATE SET confirmed_at = excluded.confirmed_at, version_id = excluded.version_id`,
  ).bind(input.id, input.groupId, input.fingerprint, input.versionId, input.staffId, now, now).run();
  const row = await db.prepare(
    `SELECT * FROM rich_menu_device_confirmations
      WHERE group_id = ? AND definition_fingerprint = ? AND staff_id = ?`,
  ).bind(input.groupId, input.fingerprint, input.staffId).first<RichMenuDeviceConfirmation>();
  if (!row) throw new Error('device confirmation upsert race: row not found');
  return row;
}

/** 今の下書きの fingerprint に対する確認が1件でもあれば通す（誰が押したかは問わない）。 */
export async function findRichMenuDeviceConfirmation(
  db: D1Database,
  groupId: string,
  fingerprint: string,
): Promise<RichMenuDeviceConfirmation | null> {
  return db.prepare(
    `SELECT * FROM rich_menu_device_confirmations
      WHERE group_id = ? AND definition_fingerprint = ?
      ORDER BY confirmed_at DESC LIMIT 1`,
  ).bind(groupId, fingerprint).first<RichMenuDeviceConfirmation>();
}

export type RichMenuPublishRun = {
  id: string;
  group_id: string;
  version_id: string | null;
  idempotency_key: string;
  mode: 'publish' | 'unpublish' | 'retry' | 'reconcile' | 'scheduled_reconcile';
  status: 'running' | 'succeeded' | 'failed';
  requested_by_staff_id: string | null;
  diffs_json: string | null;
  last_error_code: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
};

/**
 * 公開の実行行を確保する。同じ（group・key）があれば使い回す
 * （公開の冪等と同じ鍵で「進み」も1行に寄せる）。
 */
export async function ensureRichMenuPublishRun(
  db: D1Database,
  input: {
    id: string; groupId: string; versionId: string | null; idempotencyKey: string;
    mode: RichMenuPublishRun['mode']; staffId: string | null; now?: string;
  },
): Promise<RichMenuPublishRun> {
  const now = input.now ?? jstNow();
  await db.prepare(
    `INSERT INTO rich_menu_publish_runs
       (id, group_id, version_id, idempotency_key, mode, status,
        requested_by_staff_id, started_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)
     ON CONFLICT(group_id, idempotency_key) DO NOTHING`,
  ).bind(input.id, input.groupId, input.versionId, input.idempotencyKey, input.mode, input.staffId, now, now).run();
  const row = await db.prepare(
    `SELECT * FROM rich_menu_publish_runs WHERE group_id = ? AND idempotency_key = ?`,
  ).bind(input.groupId, input.idempotencyKey).first<RichMenuPublishRun>();
  if (!row) throw new Error('publish run ensure race: row not found');
  return row;
}

export async function markRichMenuPublishRun(
  db: D1Database,
  runId: string,
  outcome: {
    status: 'succeeded' | 'failed' | 'running';
    errorCode?: string | null; diffsJson?: string | null; now?: string;
  },
): Promise<void> {
  const now = outcome.now ?? jstNow();
  // running へ戻すのは失敗runの再試行。終わり時刻を消して実行中に戻す。
  await db.prepare(
    `UPDATE rich_menu_publish_runs
        SET status = ?, last_error_code = COALESCE(?, last_error_code),
            diffs_json = COALESCE(?, diffs_json),
            completed_at = CASE WHEN ? = 'running' THEN NULL ELSE ? END,
            created_at = created_at
      WHERE id = ?`,
  ).bind(outcome.status, outcome.errorCode ?? null, outcome.diffsJson ?? null, outcome.status, now, runId).run();
}

export async function listRichMenuPublishRuns(
  db: D1Database,
  groupId: string,
  limit = 20,
): Promise<RichMenuPublishRun[]> {
  const result = await db.prepare(
    `SELECT * FROM rich_menu_publish_runs WHERE group_id = ? ORDER BY started_at DESC LIMIT ?`,
  ).bind(groupId, limit).all<RichMenuPublishRun>();
  return result.results ?? [];
}

export async function getLatestRichMenuPublishRun(
  db: D1Database,
  groupId: string,
  modes: RichMenuPublishRun['mode'][] = ['publish', 'retry'],
): Promise<RichMenuPublishRun | null> {
  const placeholders = modes.map(() => '?').join(',');
  return db.prepare(
    `SELECT * FROM rich_menu_publish_runs
      WHERE group_id = ? AND mode IN (${placeholders})
      ORDER BY started_at DESC LIMIT 1`,
  ).bind(groupId, ...modes).first<RichMenuPublishRun>();
}

/**
 * K-2 照合用。アカウント内で誰かが指している LINE メニュー ID を全部集める。
 * ページの記録と、公開runが作った shell の両方を見る。LINE 側にだけある
 * メニュー（取り込み候補）を見つけるための除外表。
 */
export async function listAccountReferencedLineRichMenuIds(
  db: D1Database,
  accountId: string,
): Promise<string[]> {
  const pages = await db.prepare(
    `SELECT p.line_richmenu_id AS id FROM rich_menu_pages p
       JOIN rich_menu_groups g ON g.id = p.group_id
      WHERE g.account_id = ? AND p.line_richmenu_id IS NOT NULL`,
  ).bind(accountId).all<{ id: string }>();
  const shells = await db.prepare(
    `SELECT s.new_richmenu_id AS id FROM rich_menu_manual_publish_shells s
       JOIN rich_menu_manual_publish_requests r ON r.id = s.request_id
      WHERE r.account_id = ?`,
  ).bind(accountId).all<{ id: string }>();
  const ids = new Set<string>();
  for (const row of [...(pages.results ?? []), ...(shells.results ?? [])]) {
    if (row.id) ids.add(row.id);
  }
  return [...ids];
}

export type RichMenuPublishRunPage = {
  id: string;
  run_id: string;
  page_id: string;
  order_index: number;
  alias_id: string;
  old_line_richmenu_id: string | null;
  new_line_richmenu_id: string | null;
  create_status: 'pending' | 'succeeded' | 'failed';
  image_status: 'pending' | 'succeeded' | 'failed';
  alias_status: 'pending' | 'succeeded' | 'failed';
  cleanup_status: 'pending' | 'succeeded' | 'failed' | 'skipped';
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
};

export type RichMenuRunPageStep = 'create_status' | 'image_status' | 'alias_status' | 'cleanup_status';

/** 公開の段ごとにページ行を用意する（ある分は触らない）。 */
export async function ensureRichMenuPublishRunPages(
  db: D1Database,
  runId: string,
  pages: Array<{ id: string; pageId: string; orderIndex: number; aliasId: string; oldLineRichMenuId: string | null }>,
  now: string = jstNow(),
): Promise<void> {
  if (pages.length === 0) return;
  await db.batch(pages.map((page) => db.prepare(
    `INSERT INTO rich_menu_publish_run_pages
       (id, run_id, page_id, order_index, alias_id, old_line_richmenu_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id, page_id) DO NOTHING`,
  ).bind(page.id, runId, page.pageId, page.orderIndex, page.aliasId, page.oldLineRichMenuId, now, now)));
}

/** 段の進みを1つ進める。new ID が決まった段で一緒に残す。 */
export async function markRichMenuPublishRunPageStep(
  db: D1Database,
  runId: string,
  pageId: string,
  step: RichMenuRunPageStep,
  status: 'succeeded' | 'failed' | 'skipped',
  extra: { newLineRichMenuId?: string | null; errorCode?: string | null; now?: string } = {},
): Promise<void> {
  const now = extra.now ?? jstNow();
  const statusValue = step === 'cleanup_status' ? status : (status === 'skipped' ? 'failed' as const : status);
  await db.prepare(
    `UPDATE rich_menu_publish_run_pages
        SET ${step} = ?,
            new_line_richmenu_id = COALESCE(?, new_line_richmenu_id),
            last_error_code = COALESCE(?, last_error_code),
            updated_at = ?
      WHERE run_id = ? AND page_id = ?`,
  ).bind(statusValue, extra.newLineRichMenuId ?? null, extra.errorCode ?? null, now, runId, pageId).run();
}

/**
 * 毎日の自動照合の対象。公開中の group だけを見る（下書きは運用者が開いた時に見る）。
 */
export async function listPublishedRichMenuGroupIds(
  db: D1Database,
): Promise<Array<{ group_id: string; account_id: string }>> {
  const result = await db.prepare(
    `SELECT id AS group_id, account_id FROM rich_menu_groups
      WHERE status = 'published' ORDER BY updated_at ASC`,
  ).all<{ group_id: string; account_id: string }>();
  return result.results ?? [];
}

/** その日の自動照合が済んでいるか。6時間tickのどれか1回だけ見るための門。 */
export async function countScheduledReconcileSince(
  db: D1Database,
  groupId: string,
  since: string,
): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM rich_menu_publish_runs
      WHERE group_id = ? AND mode = 'scheduled_reconcile' AND started_at >= ?`,
  ).bind(groupId, since).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function listRichMenuPublishRunPages(
  db: D1Database,
  runId: string,
): Promise<RichMenuPublishRunPage[]> {
  const result = await db.prepare(
    `SELECT * FROM rich_menu_publish_run_pages WHERE run_id = ? ORDER BY order_index ASC`,
  ).bind(runId).all<RichMenuPublishRunPage>();
  return result.results ?? [];
}
