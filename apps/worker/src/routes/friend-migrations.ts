import { Hono, type Context } from 'hono';
import {
  UID_EVIDENCE_TYPES,
  createUidMigrationRun,
  getUidMigrationRun,
  listUidMigrationItems,
  listUidMigrationRuns,
  protectCsvCell,
  type UidEvidenceType,
  type UidMigrationItemRow,
  type UidMigrationRunRow,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';

export const friendMigrations = new Hono<Env>();
const MAX_MAPPING_ROWS = 5_000;
const EXPORT_COLUMNS = ['basic', 'tags_fields', 'support'] as const;
type ExportColumn = (typeof EXPORT_COLUMNS)[number];

function runJson(row: UidMigrationRunRow) {
  return {
    id: row.id,
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    purpose: row.purpose,
    sourceKind: row.source_kind,
    sourceFilename: row.source_filename,
    status: row.status,
    dryRunRevision: row.dry_run_revision,
    counts: {
      total: row.total_count,
      auto: row.auto_count,
      review: row.review_count,
      unmatched: row.unmatched_count,
      conflict: row.conflict_count,
      applied: row.applied_count,
      failed: row.failed_count,
    },
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    executedAt: row.executed_at,
    completedAt: row.completed_at,
    rolledBackAt: row.rolled_back_at,
    failureReason: row.failure_reason,
  };
}

function itemJson(row: UidMigrationItemRow) {
  return {
    id: row.id,
    oldUid: row.old_uid,
    newUid: row.new_uid,
    candidateName: row.candidate_name,
    evidenceType: row.evidence_type,
    classification: row.classification,
    conflictReason: row.conflict_reason,
    decision: row.decision,
    result: row.result,
    errorMessage: row.error_message,
  };
}

async function accessibleRun(c: Context<Env>, id: string) {
  const run = await getUidMigrationRun(c.env.DB, id);
  if (!run) return null;
  return await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [run.from_account_id, run.to_account_id])
    ? run
    : null;
}

friendMigrations.get('/api/friends/migrations', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const runs = await listUidMigrationRuns(c.env.DB, scope.allowedAccountIds);
    return c.json({ success: true, data: runs.map(runJson) });
  } catch (error) {
    console.error(JSON.stringify({ event: 'friend_migrations_list_failed', error: String(error) }));
    return c.json({ success: false, error: '移行履歴を読み込めませんでした' }, 500);
  }
});

friendMigrations.post('/api/friends/migrations', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      fromAccountId?: string;
      toAccountId?: string;
      purpose?: string;
      sourceKind?: 'csv' | 'verified_api' | 'manual';
      sourceFilename?: string;
      sourceChecksum?: string;
      mappings?: Array<{
        oldUid?: string;
        newUid?: string | null;
        evidenceType?: UidEvidenceType;
        evidence?: Record<string, string | number | boolean | null>;
      }>;
    }>();
    const from = body.fromAccountId?.trim();
    const to = body.toAccountId?.trim();
    const purpose = body.purpose?.trim();
    const mappings = body.mappings ?? [];
    if (!from || !to || !purpose || from === to) {
      return c.json({ success: false, error: '異なる移行元・移行先と利用目的を指定してください' }, 400);
    }
    if (mappings.length === 0 || mappings.length > MAX_MAPPING_ROWS) {
      return c.json({ success: false, error: `対応表は1〜${MAX_MAPPING_ROWS}行で指定してください` }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [from, to])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const normalized = mappings.map((mapping) => ({
      oldUid: mapping.oldUid?.trim() ?? '',
      newUid: mapping.newUid?.trim() || null,
      evidenceType: mapping.evidenceType ?? 'operator_csv',
      evidence: mapping.evidence,
    }));
    if (normalized.some((mapping) => !mapping.oldUid || !UID_EVIDENCE_TYPES.includes(mapping.evidenceType))) {
      return c.json({ success: false, error: '旧UIDと確認済みの一致根拠が必要です' }, 400);
    }
    const staff = c.get('staff');
    const run = await createUidMigrationRun(c.env.DB, {
      fromAccountId: from,
      toAccountId: to,
      purpose,
      sourceKind: body.sourceKind ?? 'csv',
      sourceFilename: body.sourceFilename?.trim() || null,
      sourceChecksum: body.sourceChecksum?.trim() || null,
      mappings: normalized,
      createdBy: staff.id,
    });
    return c.json({ success: true, data: runJson(run) }, 201);
  } catch (error) {
    console.error(JSON.stringify({ event: 'friend_migration_dry_run_failed', error: String(error) }));
    return c.json({ success: false, error: 'テスト移行を実行できませんでした' }, 500);
  }
});

friendMigrations.get('/api/friends/migrations/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const run = await accessibleRun(c, c.req.param('id'));
    if (!run) return c.json({ success: false, error: 'Not found' }, 404);
    const items = await listUidMigrationItems(c.env.DB, run.id);
    return c.json({ success: true, data: { ...runJson(run), items: items.map(itemJson) } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'friend_migration_detail_failed', error: String(error) }));
    return c.json({ success: false, error: '移行結果を読み込めませんでした' }, 500);
  }
});

friendMigrations.patch('/api/friends/migrations/:id/items/:itemId', requireRole('owner', 'admin'), async (c) => {
  try {
    const run = await accessibleRun(c, c.req.param('id'));
    if (!run) return c.json({ success: false, error: 'Not found' }, 404);
    if (!['review', 'ready'].includes(run.status)) {
      return c.json({ success: false, error: 'このテスト移行は判断を変更できません' }, 409);
    }
    const body = await c.req.json<{ decision?: 'link' | 'create' | 'exclude' }>();
    if (!body.decision || !['link', 'create', 'exclude'].includes(body.decision)) {
      return c.json({ success: false, error: '判断を選んでください' }, 400);
    }
    const item = await c.env.DB.prepare(
      'SELECT * FROM uid_migration_items WHERE id = ? AND run_id = ?',
    ).bind(c.req.param('itemId'), run.id).first<UidMigrationItemRow>();
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    if (body.decision === 'link' && (!item.old_friend_id || !item.new_friend_id)) {
      return c.json({ success: false, error: '新旧の友だちが両方見つからないため結び付けられません' }, 422);
    }
    const now = new Date().toISOString();
    await c.env.DB.prepare(`UPDATE uid_migration_items
      SET decision = ?, decided_by = ?, decided_at = ?, updated_at = ?
      WHERE id = ? AND run_id = ?`).bind(
      body.decision, c.get('staff').id, now, now, item.id, run.id,
    ).run();
    const pending = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM uid_migration_items
      WHERE run_id = ? AND decision = 'pending'`).bind(run.id).first<{ count: number }>();
    await c.env.DB.prepare(`UPDATE uid_migration_runs SET status = ?, reviewed_at = ? WHERE id = ?`)
      .bind((pending?.count ?? 0) === 0 ? 'ready' : 'review', (pending?.count ?? 0) === 0 ? now : null, run.id)
      .run();
    return c.json({ success: true, data: { ...(runJson((await getUidMigrationRun(c.env.DB, run.id))!)), unresolved: pending?.count ?? null } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'friend_migration_decision_failed', error: String(error) }));
    return c.json({ success: false, error: '判断を保存できませんでした' }, 500);
  }
});

friendMigrations.post('/api/friends/migrations/:id/execute', requireRole('owner'), async (c) => {
  try {
    const run = await accessibleRun(c, c.req.param('id'));
    if (!run) return c.json({ success: false, error: 'Not found' }, 404);
    const staff = c.get('staff');
    if (run.created_by === staff.id) {
      return c.json({ success: false, error: '本移行は、テスト移行を作った人とは別のownerが確認してください' }, 409);
    }
    if (run.status !== 'ready') {
      return c.json({ success: false, error: '要確認をすべて判断してから本移行してください' }, 422);
    }
    const items = await listUidMigrationItems(c.env.DB, run.id);
    const now = new Date().toISOString();
    await c.env.DB.prepare(`UPDATE uid_migration_runs
      SET status = 'executing', approved_by = ?, executed_at = ? WHERE id = ? AND status = 'ready'`)
      .bind(staff.id, now, run.id).run();
    let applied = 0;
    let failed = 0;
    for (const item of items) {
      if (item.decision === 'exclude') {
        await c.env.DB.prepare(`UPDATE uid_migration_items SET result = 'skipped', updated_at = ? WHERE id = ?`)
          .bind(now, item.id).run();
        continue;
      }
      if (item.decision !== 'link' || !item.old_friend_id || !item.new_friend_id) {
        failed += 1;
        await c.env.DB.prepare(`UPDATE uid_migration_items
          SET result = 'failed', error_message = ?, updated_at = ? WHERE id = ?`)
          .bind('この判断は自動反映できません。新しい友だちを確認してください', now, item.id).run();
        continue;
      }
      const pair = await c.env.DB.prepare(`SELECT id, user_id, display_name FROM friends
        WHERE id IN (?, ?)`).bind(item.old_friend_id, item.new_friend_id)
        .all<{ id: string; user_id: string | null; display_name: string | null }>();
      const oldFriend = pair.results.find((friend) => friend.id === item.old_friend_id);
      const newFriend = pair.results.find((friend) => friend.id === item.new_friend_id);
      if (!oldFriend || !newFriend || (oldFriend.user_id && newFriend.user_id && oldFriend.user_id !== newFriend.user_id)) {
        failed += 1;
        await c.env.DB.prepare(`UPDATE uid_migration_items
          SET result = 'failed', error_message = ?, updated_at = ? WHERE id = ?`)
          .bind('本移行前に結び付きが変わりました。テスト移行をやり直してください', now, item.id).run();
        continue;
      }
      const userId = oldFriend.user_id ?? newFriend.user_id ?? crypto.randomUUID();
      const statements: D1PreparedStatement[] = [];
      if (!oldFriend.user_id && !newFriend.user_id) {
        statements.push(c.env.DB.prepare(`INSERT INTO users
          (id, display_name, primary_display_name, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`).bind(
          userId, newFriend.display_name ?? oldFriend.display_name, newFriend.display_name ?? oldFriend.display_name,
          staff.id, now, now,
        ));
      }
      statements.push(
        c.env.DB.prepare('UPDATE friends SET user_id = ?, updated_at = ? WHERE id IN (?, ?)')
          .bind(userId, now, oldFriend.id, newFriend.id),
        c.env.DB.prepare(`UPDATE uid_migration_items
          SET result = 'applied', before_json = ?, after_json = ?, updated_at = ? WHERE id = ?`)
          .bind(JSON.stringify({ oldUserId: oldFriend.user_id, newUserId: newFriend.user_id }), JSON.stringify({ userId }), now, item.id),
      );
      await c.env.DB.batch(statements);
      applied += 1;
    }
    const status = failed === 0 ? 'completed' : 'failed';
    await c.env.DB.prepare(`UPDATE uid_migration_runs SET status = ?, applied_count = ?, failed_count = ?,
      completed_at = ?, failure_reason = ? WHERE id = ?`).bind(
      status, applied, failed, now, failed ? '一部の結び付きが事前確認後に変わりました' : null, run.id,
    ).run();
    return c.json({ success: true, data: runJson((await getUidMigrationRun(c.env.DB, run.id))!) });
  } catch (error) {
    console.error(JSON.stringify({ event: 'friend_migration_execute_failed', error: String(error) }));
    return c.json({ success: false, error: '本移行を実行できませんでした' }, 500);
  }
});

friendMigrations.post('/api/friends/migrations/:id/rollback', requireRole('owner'), async (c) => {
  try {
    const run = await accessibleRun(c, c.req.param('id'));
    if (!run) return c.json({ success: false, error: 'Not found' }, 404);
    if (run.status !== 'completed') return c.json({ success: false, error: '完了した移行だけ切り戻せます' }, 409);
    const items = await listUidMigrationItems(c.env.DB, run.id);
    const now = new Date().toISOString();
    for (const item of items.filter((value) => value.result === 'applied')) {
      const before = item.before_json ? JSON.parse(item.before_json) as { oldUserId: string | null; newUserId: string | null } : null;
      if (!before || !item.old_friend_id || !item.new_friend_id) continue;
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE friends SET user_id = ?, updated_at = ? WHERE id = ?').bind(before.oldUserId, now, item.old_friend_id),
        c.env.DB.prepare('UPDATE friends SET user_id = ?, updated_at = ? WHERE id = ?').bind(before.newUserId, now, item.new_friend_id),
        c.env.DB.prepare(`UPDATE uid_migration_items SET result = 'rolled_back', updated_at = ? WHERE id = ?`).bind(now, item.id),
      ]);
    }
    await c.env.DB.prepare(`UPDATE uid_migration_runs SET status = 'rolled_back', rolled_back_at = ? WHERE id = ?`)
      .bind(now, run.id).run();
    return c.json({ success: true, data: runJson((await getUidMigrationRun(c.env.DB, run.id))!) });
  } catch (error) {
    console.error(JSON.stringify({ event: 'friend_migration_rollback_failed', error: String(error) }));
    return c.json({ success: false, error: '切り戻しを実行できませんでした' }, 500);
  }
});

friendMigrations.post('/api/friends/exports', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: string; columns?: ExportColumn[]; encoding?: 'utf-8' | 'shift_jis' }>();
    const accountId = body.accountId?.trim();
    const columns = body.columns ?? ['basic'];
    if (!accountId || columns.some((column) => !EXPORT_COLUMNS.includes(column))) {
      return c.json({ success: false, error: '対象アカウントと書き出す項目を選んでください' }, 400);
    }
    if (body.encoding === 'shift_jis') {
      return c.json({ success: false, error: 'Shift_JIS書き出しはまだ接続されていません。UTF-8を選んでください' }, 422);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM friends WHERE line_account_id = ?')
      .bind(accountId).first<{ count: number }>();
    const id = crypto.randomUUID();
    const now = new Date();
    const staff = c.get('staff');
    await c.env.DB.prepare(`INSERT INTO friend_export_jobs
      (id, line_account_id, filter_json, columns_json, encoding, status, row_count,
       created_by, created_by_name, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`).bind(
      id, accountId, JSON.stringify({ accountId }), JSON.stringify(columns), body.encoding ?? 'utf-8',
      count?.count ?? 0, staff.id, staff.name, now.toISOString(), new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    ).run();
    return c.json({ success: true, data: { id, rowCount: count?.count ?? null, status: 'completed', downloadUrl: `/api/friends/exports/${id}/download` } }, 201);
  } catch (error) {
    console.error(JSON.stringify({ event: 'friend_export_create_failed', error: String(error) }));
    return c.json({ success: false, error: '書き出しを作れませんでした' }, 500);
  }
});

friendMigrations.get('/api/friends/exports/:id/download', requireRole('owner', 'admin'), async (c) => {
  const job = await c.env.DB.prepare('SELECT * FROM friend_export_jobs WHERE id = ?').bind(c.req.param('id'))
    .first<{ line_account_id: string; expires_at: string }>();
  if (!job || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [job.line_account_id])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  if (job.expires_at <= new Date().toISOString()) return c.json({ success: false, error: 'ダウンロード期限が切れています' }, 410);
  type ExportRow = { line_user_id: string; display_name: string | null; real_name: string | null; system_display_name: string | null; created_at: string };
  const encoder = new TextEncoder();
  let offset = 0;
  let started = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        controller.enqueue(encoder.encode('\uFEFFLINEユーザーID,LINE表示名,本名,システム表示名,登録日\r\n'));
        started = true;
      }
      const page = await c.env.DB.prepare(`SELECT line_user_id, display_name, real_name, system_display_name, created_at
        FROM friends WHERE line_account_id = ? ORDER BY created_at DESC, id ASC LIMIT 500 OFFSET ?`)
        .bind(job.line_account_id, offset).all<ExportRow>();
      if (page.results.length === 0) {
        controller.close();
        return;
      }
      const csv = page.results.map((row) => [row.line_user_id, row.display_name, row.real_name, row.system_display_name, row.created_at]
        .map((cell) => protectCsvCell(cell)).join(',')).join('\r\n') + '\r\n';
      controller.enqueue(encoder.encode(csv));
      offset += page.results.length;
      if (page.results.length < 500) controller.close();
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="friends-${c.req.param('id')}.csv"` },
  });
});

friendMigrations.post('/api/friends/imports', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      accountId?: string;
      sourceFilename?: string;
      sourceChecksum?: string;
      rows?: Array<{
        lineUid?: string;
        displayName?: string | null;
        realName?: string | null;
        systemDisplayName?: string | null;
      }>;
    }>();
    const accountId = body.accountId?.trim();
    const filename = body.sourceFilename?.trim();
    const checksum = body.sourceChecksum?.trim();
    const rows = body.rows ?? [];
    if (!accountId || !filename || !checksum || rows.length === 0 || rows.length > MAX_MAPPING_ROWS) {
      return c.json({ success: false, error: `対象・ファイル情報と1〜${MAX_MAPPING_ROWS}行のデータが必要です` }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const previous = await c.env.DB.prepare(
      'SELECT id, status, result_json FROM friend_import_jobs WHERE line_account_id = ? AND source_checksum = ?',
    ).bind(accountId, checksum).first<{ id: string; status: string; result_json: string }>();
    if (previous) {
      return c.json({ success: true, data: { id: previous.id, status: previous.status, result: JSON.parse(previous.result_json), duplicate: true } });
    }
    const seen = new Set<string>();
    const results: Array<{
      lineUid: string;
      kind: 'add' | 'update' | 'unchanged' | 'conflict' | 'error';
      reason: string | null;
      values: { displayName: string | null; realName: string | null; systemDisplayName: string | null };
    }> = [];
    for (const raw of rows) {
      const lineUid = raw.lineUid?.trim() ?? '';
      const values = {
        displayName: raw.displayName?.trim() || null,
        realName: raw.realName?.trim() || null,
        systemDisplayName: raw.systemDisplayName?.trim() || null,
      };
      if (!lineUid || seen.has(lineUid)) {
        results.push({ lineUid, kind: 'error', reason: lineUid ? '同じUIDがファイルに複数あります' : 'LINEユーザーIDがありません', values });
        continue;
      }
      seen.add(lineUid);
      const existing = await c.env.DB.prepare(`SELECT id, line_account_id, display_name, real_name, system_display_name
        FROM friends WHERE line_user_id = ? LIMIT 1`).bind(lineUid).first<{
        id: string; line_account_id: string | null; display_name: string | null;
        real_name: string | null; system_display_name: string | null;
      }>();
      if (existing && existing.line_account_id !== accountId) {
        results.push({ lineUid, kind: 'conflict', reason: '別のLINEアカウントに同じUIDがあります', values });
      } else if (!existing) {
        results.push({ lineUid, kind: 'add', reason: null, values });
      } else if (
        existing.display_name === values.displayName
        && existing.real_name === values.realName
        && existing.system_display_name === values.systemDisplayName
      ) {
        results.push({ lineUid, kind: 'unchanged', reason: null, values });
      } else {
        results.push({ lineUid, kind: 'update', reason: null, values });
      }
    }
    const count = (kind: typeof results[number]['kind']) => results.filter((row) => row.kind === kind).length;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const staff = c.get('staff');
    const summary = { add: count('add'), update: count('update'), unchanged: count('unchanged'), conflict: count('conflict'), error: count('error') };
    await c.env.DB.prepare(`INSERT INTO friend_import_jobs (
      id, line_account_id, source_filename, source_checksum, rows_json, result_json,
      status, total_count, add_count, update_count, unchanged_count, conflict_count,
      error_count, created_by, created_by_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'previewed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      id, accountId, filename, checksum, JSON.stringify(rows), JSON.stringify({ summary, rows: results }),
      results.length, summary.add, summary.update, summary.unchanged, summary.conflict, summary.error,
      staff.id, staff.name, now,
    ).run();
    return c.json({ success: true, data: { id, status: 'previewed', result: { summary, rows: results }, duplicate: false } }, 201);
  } catch (error) {
    console.error(JSON.stringify({ event: 'friend_import_preview_failed', error: String(error) }));
    return c.json({ success: false, error: '取り込みの確認を実行できませんでした' }, 500);
  }
});

friendMigrations.post('/api/friends/imports/:id/execute', requireRole('owner', 'admin'), async (c) => {
  try {
    const job = await c.env.DB.prepare('SELECT * FROM friend_import_jobs WHERE id = ?').bind(c.req.param('id')).first<{
      id: string; line_account_id: string; status: string; result_json: string;
    }>();
    if (!job || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [job.line_account_id])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    if (job.status === 'completed') return c.json({ success: true, data: { id: job.id, status: 'completed', duplicate: true } });
    if (job.status !== 'previewed') return c.json({ success: false, error: '確認が終わったファイルだけ反映できます' }, 409);
    const result = JSON.parse(job.result_json) as { rows: Array<{
      lineUid: string; kind: 'add' | 'update' | 'unchanged' | 'conflict' | 'error';
      values: { displayName: string | null; realName: string | null; systemDisplayName: string | null };
    }> };
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    for (const row of result.rows) {
      if (row.kind === 'add') {
        statements.push(c.env.DB.prepare(`INSERT INTO friends (
          id, line_user_id, line_account_id, display_name, real_name, system_display_name,
          is_following, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, '{}', ?, ?)`).bind(
          crypto.randomUUID(), row.lineUid, job.line_account_id, row.values.displayName,
          row.values.realName, row.values.systemDisplayName, now, now,
        ));
      } else if (row.kind === 'update') {
        statements.push(c.env.DB.prepare(`UPDATE friends
          SET display_name = ?, real_name = ?, system_display_name = ?, updated_at = ?
          WHERE line_account_id = ? AND line_user_id = ?`).bind(
          row.values.displayName, row.values.realName, row.values.systemDisplayName,
          now, job.line_account_id, row.lineUid,
        ));
      }
    }
    if (statements.length > 0) await c.env.DB.batch(statements);
    await c.env.DB.prepare(`UPDATE friend_import_jobs SET status = 'completed', executed_at = ? WHERE id = ? AND status = 'previewed'`)
      .bind(now, job.id).run();
    return c.json({ success: true, data: { id: job.id, status: 'completed', applied: statements.length, duplicate: false } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'friend_import_execute_failed', error: String(error) }));
    return c.json({ success: false, error: '取り込みを反映できませんでした' }, 500);
  }
});

friendMigrations.get('/api/friends/migration-jobs', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (scope.allowedAccountIds.length === 0) return c.json({ success: true, data: [] });
    const placeholders = scope.allowedAccountIds.map(() => '?').join(',');
    const [exports, imports] = await Promise.all([
      c.env.DB.prepare(`SELECT id, line_account_id, row_count, status, created_by_name, created_at, expires_at
        FROM friend_export_jobs WHERE line_account_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 20`)
        .bind(...scope.allowedAccountIds).all<Record<string, unknown>>(),
      c.env.DB.prepare(`SELECT id, line_account_id, total_count, update_count, conflict_count, status,
        created_by_name, created_at FROM friend_import_jobs WHERE line_account_id IN (${placeholders})
        ORDER BY created_at DESC LIMIT 20`).bind(...scope.allowedAccountIds).all<Record<string, unknown>>(),
    ]);
    const jobs = [
      ...exports.results.map((row) => ({ ...row, kind: 'export', sortCreatedAt: String(row['created_at']) })),
      ...imports.results.map((row) => ({ ...row, kind: 'import', sortCreatedAt: String(row['created_at']) })),
    ];
    return c.json({ success: true, data: jobs
      .sort((a, b) => b.sortCreatedAt.localeCompare(a.sortCreatedAt))
      .slice(0, 20)
      .map(({ sortCreatedAt: _sortCreatedAt, ...job }) => job) });
  } catch (error) {
    console.error(JSON.stringify({ event: 'friend_migration_jobs_list_failed', error: String(error) }));
    return c.json({ success: false, error: '書き出し・取り込み履歴を読み込めませんでした' }, 500);
  }
});
