import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { autoReplyRuns } from './auto-reply-runs.js';

/*
 * N-081: permanent_failed の処理行だけを運用者がやり直す。
 * 実route・実SQLiteで確かめる。LINEの返信API・受信イベント・
 * matchAndReply には一切触れないことを、副作用と保存値で見る。
 */

const DEFAULT_TENANT = '00000000-0000-4000-8000-000000000001';

function makeStaff(role: 'owner' | 'admin' | 'staff'): AuthenticatedStaff {
  return {
    id: `staff-${role}`,
    name: '担当者',
    role,
    readOnly: false,
    permissionKeys: [],
    assignedLineAccountId: null,
    canAccessDescendantAccounts: false,
    tenantId: DEFAULT_TENANT,
  } as AuthenticatedStaff;
}

function setupApp(db: D1Database, staff = makeStaff('owner')) {
  const app = new Hono<{
    Bindings: { DB: D1Database };
    Variables: { staff: AuthenticatedStaff };
  }>();
  app.use('*', async (c, next) => {
    c.env = { DB: db };
    c.set('staff', staff);
    await next();
  });
  app.route('/', autoReplyRuns);
  return app;
}

function seedScope(raw: SqliteD1['raw']) {
  raw.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES (?, '本部')`).run(DEFAULT_TENANT);
  raw.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-9', '他社')`).run();
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('acc-1', 'ch-1', '本店', 'token', 'secret', 1, ?)`,
  ).run(DEFAULT_TENANT);
  raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
     VALUES ('acc-9', 'ch-9', '見えない店', 'token', 'secret', 1, 'tenant-9')`,
  ).run();
  insertFriend(raw, 'friend-1', { line_account_id: 'acc-1' });
  raw.prepare(`INSERT INTO tags (id, name) VALUES ('tag-1', '写しのタグ')`).run();
  raw.prepare(`INSERT INTO tags (id, name) VALUES ('tag-2', '現在ルールのタグ')`).run();
  // 現在のルールは別のタグを付ける設定に書き換わっている。
  // 再実行はこの定義を読み直さず、保存済みの写し（tag-1）だけを動かす。
  raw.prepare(
    `INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, line_account_id, is_active, actions_json)
     VALUES ('rule-1', '予約', 'contains', 'text', 'ご予約を承ります', 'acc-1', 1, ?)`,
  ).run(JSON.stringify([{ actionType: 'tag', config: { op: 'add', tagIds: ['tag-2'] } }]));
}

function seedEvaluation(raw: SqliteD1['raw'], overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: 'evaluation-1',
    incoming_event_id: `event-${Math.random().toString(36).slice(2)}`,
    line_account_id: 'acc-1',
    friend_id: 'friend-1',
    message_kind: 'text',
    normalized_text_hash: 'hash',
    evaluated_at: '2026-09-15T01:00:00.000',
    completed_at: '2026-09-15T01:00:01.000',
    winning_auto_reply_id: 'rule-1',
    status: 'partial_failed',
    reply_status: 'accepted',
    line_request_id: 'line-request-1',
    message_log_id: 'outgoing-1',
    action_summary: '{"executed":1,"failed":1}',
    error_code: 'action_failed',
    created_at: '2026-09-15T01:00:00.000',
    updated_at: '2026-09-15T01:00:01.000',
    ...overrides,
  };
  const cols = Object.keys(row);
  raw.prepare(
    `INSERT INTO auto_reply_evaluations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
  ).run(...cols.map((c) => row[c] as never));
  return String(row.id);
}

function tagSnapshot(tagId: string, sortOrder = 0): string {
  return JSON.stringify({
    id: `auto-reply-action-${sortOrder}`,
    scenario_id: '',
    hook: 'step_sent',
    step_id: null,
    choice_index: null,
    sort_order: sortOrder,
    action_type: 'tag',
    config_json: JSON.stringify({ op: 'add', tagIds: [tagId] }),
    condition_json: null,
    repeat_on_refire: 1,
  });
}

const FAILING_SNAPSHOT = JSON.stringify({
  id: 'auto-reply-action-0',
  scenario_id: '',
  hook: 'step_sent',
  step_id: null,
  choice_index: null,
  sort_order: 0,
  action_type: 'friend_field',
  config_json: JSON.stringify({ fieldId: 'field-not-exists', op: 'set', value: '1' }),
  condition_json: null,
  repeat_on_refire: 1,
});

function seedActionRun(raw: SqliteD1['raw'], overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id: `run-${Math.random().toString(36).slice(2)}`,
    evaluation_id: 'evaluation-1',
    action_stable_id: `auto-reply-action-${Math.random().toString(36).slice(2)}`,
    action_version: 1,
    action_type: 'tag',
    action_snapshot: tagSnapshot('tag-1'),
    idempotency_key: `key-${Math.random().toString(36).slice(2)}`,
    status: 'permanent_failed',
    attempt_count: 1,
    last_error_code: 'action_failed',
    result_json: null,
    started_at: '2026-09-15T01:00:00.000',
    completed_at: '2026-09-15T01:00:01.000',
    created_at: '2026-09-15T01:00:00.000',
    updated_at: '2026-09-15T01:00:01.000',
    ...overrides,
  };
  const cols = Object.keys(row);
  raw.prepare(
    `INSERT INTO auto_reply_action_runs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
  ).run(...cols.map((c) => row[c] as never));
  return String(row.id);
}

function runRow(raw: SqliteD1['raw'], id: string) {
  return raw.prepare(`SELECT * FROM auto_reply_action_runs WHERE id = ?`).get(id) as {
    status: string;
    attempt_count: number;
    last_error_code: string | null;
    result_json: string | null;
    completed_at: string | null;
  };
}

function evaluationRow(raw: SqliteD1['raw'], id: string) {
  return raw.prepare(`SELECT * FROM auto_reply_evaluations WHERE id = ?`).get(id) as {
    status: string;
    reply_status: string;
    line_request_id: string | null;
    message_log_id: string | null;
    action_summary: string | null;
    error_code: string | null;
  };
}

function friendTagIds(raw: SqliteD1['raw'], friendId: string): string[] {
  return (raw.prepare(`SELECT tag_id FROM friend_tags WHERE friend_id = ?`).all(friendId) as Array<{ tag_id: string }>)
    .map((row) => row.tag_id);
}

describe('POST /api/auto-reply-runs/:id/retry (N-081、実DB)', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedScope(testDb.raw);
  });

  it('オーナーは失敗した処理だけを再実行し、評価を完了へ進める', async () => {
    seedEvaluation(testDb.raw);
    const failedRun = seedActionRun(testDb.raw, { id: 'run-failed' });
    const okRun = seedActionRun(testDb.raw, {
      id: 'run-ok',
      status: 'succeeded',
      result_json: '{"executed":1,"skippedByCondition":0,"skippedByOnce":0,"failed":0,"skippedIncomplete":0,"scenarioTouched":false}',
    });

    const res = await setupApp(testDb.db).request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('completed');

    // 保存された写し（tag-1）だけが動く。
    expect(friendTagIds(testDb.raw, 'friend-1')).toEqual(['tag-1']);
    const run = runRow(testDb.raw, failedRun);
    expect(run.status).toBe('succeeded');
    expect(run.attempt_count).toBe(2);
    expect(run.completed_at).not.toBeNull();
    // 成功済みの行は触らない。
    expect(runRow(testDb.raw, okRun).attempt_count).toBe(1);

    const evaluation = evaluationRow(testDb.raw, 'evaluation-1');
    expect(evaluation.status).toBe('completed');
    // LINEの返信結果・要求ID・送信ログは再送しないので、そのまま残る。
    expect(evaluation.reply_status).toBe('accepted');
    expect(evaluation.line_request_id).toBe('line-request-1');
    expect(evaluation.message_log_id).toBe('outgoing-1');
    const summary = JSON.parse(evaluation.action_summary ?? '{}') as Record<string, number>;
    expect(summary.executed).toBe(2);
    expect(summary.failed).toBe(0);
  });

  it('管理者も再実行できる', async () => {
    seedEvaluation(testDb.raw);
    seedActionRun(testDb.raw);
    const res = await setupApp(testDb.db, makeStaff('admin'))
      .request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(friendTagIds(testDb.raw, 'friend-1')).toEqual(['tag-1']);
  });

  it('スタッフ権限は403で、何も動かない', async () => {
    seedEvaluation(testDb.raw);
    const runId = seedActionRun(testDb.raw);
    const res = await setupApp(testDb.db, makeStaff('staff'))
      .request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(runRow(testDb.raw, runId).status).toBe('permanent_failed');
    expect(friendTagIds(testDb.raw, 'friend-1')).toEqual([]);
  });

  it('見えないアカウントの評価は404で、存在を明かさない', async () => {
    seedEvaluation(testDb.raw, { line_account_id: 'acc-9' });
    const runId = seedActionRun(testDb.raw);
    const res = await setupApp(testDb.db).request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(runRow(testDb.raw, runId).status).toBe('permanent_failed');
    expect(friendTagIds(testDb.raw, 'friend-1')).toEqual([]);
  });

  it('存在しない評価も404', async () => {
    const res = await setupApp(testDb.db).request('/api/auto-reply-runs/evaluation-none/retry', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('失敗した処理行が無ければ409', async () => {
    seedEvaluation(testDb.raw, { status: 'completed' });
    seedActionRun(testDb.raw, { status: 'succeeded' });
    const res = await setupApp(testDb.db).request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ success: false });
    expect(friendTagIds(testDb.raw, 'friend-1')).toEqual([]);
  });

  it('終了済みの評価でも permanent_failed 行が残るだけでは再実行しない', async () => {
    // completed 評価に失敗行が残るのは不整合データ。canRetry=false と
    // 揃えて、POST 側も409で閉じる。
    seedEvaluation(testDb.raw, { status: 'completed' });
    const runId = seedActionRun(testDb.raw);
    const res = await setupApp(testDb.db).request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(runRow(testDb.raw, runId).status).toBe('permanent_failed');
    expect(friendTagIds(testDb.raw, 'friend-1')).toEqual([]);
  });

  it('処理中の評価は409で、生きている確保行を二重に動かさない', async () => {
    seedEvaluation(testDb.raw, { status: 'actions_running', completed_at: null });
    seedActionRun(testDb.raw, { id: 'run-live', status: 'claimed' });
    seedActionRun(testDb.raw, { id: 'run-failed', action_stable_id: 'a-9' });
    const res = await setupApp(testDb.db).request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(runRow(testDb.raw, 'run-live').status).toBe('claimed');
    expect(friendTagIds(testDb.raw, 'friend-1')).toEqual([]);
  });

  it('途中で止まった再実行（actions_running＋失敗行残り・処理中行なし）はやり直せる', async () => {
    seedEvaluation(testDb.raw, { status: 'actions_running', completed_at: null });
    const runId = seedActionRun(testDb.raw);
    const res = await setupApp(testDb.db).request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(friendTagIds(testDb.raw, 'friend-1')).toEqual(['tag-1']);
    expect(runRow(testDb.raw, runId).status).toBe('succeeded');
    expect(evaluationRow(testDb.raw, 'evaluation-1').status).toBe('completed');
  });

  it('同時に2度呼んでも1回だけ動き、負けた側は409', async () => {
    seedEvaluation(testDb.raw);
    seedActionRun(testDb.raw);
    const app = setupApp(testDb.db);
    const [first, second] = await Promise.all([
      app.request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' }),
      app.request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    // 副作用は1回だけ。
    expect(friendTagIds(testDb.raw, 'friend-1')).toEqual(['tag-1']);
  });

  it('現在のルール定義は読み直さず、保存された写しだけを実行する', async () => {
    seedEvaluation(testDb.raw);
    seedActionRun(testDb.raw); // snapshot は tag-1、現在の rule-1 は tag-2
    const res = await setupApp(testDb.db).request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(friendTagIds(testDb.raw, 'friend-1')).toEqual(['tag-1']);
  });

  it('成功・見送り・処理中の行は再実行しない', async () => {
    seedEvaluation(testDb.raw);
    const failed = seedActionRun(testDb.raw, { id: 'run-failed' });
    const succeeded = seedActionRun(testDb.raw, { id: 'run-ok', status: 'succeeded' });
    const skipped = seedActionRun(testDb.raw, { id: 'run-skip', status: 'skipped' });
    const claimed = seedActionRun(testDb.raw, { id: 'run-claimed', status: 'claimed' });

    const res = await setupApp(testDb.db).request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' });
    expect(res.status).toBe(200);

    expect(runRow(testDb.raw, succeeded).status).toBe('succeeded');
    expect(runRow(testDb.raw, succeeded).attempt_count).toBe(1);
    expect(runRow(testDb.raw, skipped).status).toBe('skipped');
    expect(runRow(testDb.raw, skipped).attempt_count).toBe(1);
    expect(runRow(testDb.raw, claimed).status).toBe('claimed');
    expect(runRow(testDb.raw, claimed).attempt_count).toBe(1);
    expect(runRow(testDb.raw, failed).status).toBe('succeeded');
    // tag-1 の付与は1回だけ（succeeded行の写しは再実行されない）。
    expect(friendTagIds(testDb.raw, 'friend-1')).toEqual(['tag-1']);
  });

  it('壊れた写しは実行せず permanent_failed に戻し、再試行の余地を残す', async () => {
    seedEvaluation(testDb.raw);
    const runId = seedActionRun(testDb.raw, {
      action_type: 'tag',
      action_snapshot: '{"unexpected":"shape"}',
    });
    const res = await setupApp(testDb.db).request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' });
    expect(res.status).toBe(200);
    const run = runRow(testDb.raw, runId);
    expect(run.status).toBe('permanent_failed');
    expect(run.last_error_code).toBe('invalid_action_snapshot');
    expect(friendTagIds(testDb.raw, 'friend-1')).toEqual([]);
    const evaluation = evaluationRow(testDb.raw, 'evaluation-1');
    expect(evaluation.status).toBe('partial_failed');
  });

  it('再実行しても失敗するなら permanent_failed のまま、もう一度やり直せる', async () => {
    seedEvaluation(testDb.raw);
    const runId = seedActionRun(testDb.raw, {
      action_type: 'friend_field',
      action_snapshot: FAILING_SNAPSHOT,
    });
    const app = setupApp(testDb.db);
    const first = await app.request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' });
    expect(first.status).toBe(200);
    expect(runRow(testDb.raw, runId).status).toBe('permanent_failed');

    const second = await app.request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' });
    expect(second.status).toBe(200);
    const run = runRow(testDb.raw, runId);
    expect(run.status).toBe('permanent_failed');
    expect(run.attempt_count).toBe(3);
    expect(evaluationRow(testDb.raw, 'evaluation-1').status).toBe('partial_failed');
  });

  it('返信だけが失敗した評価は、処理の失敗を直しても reply_failed のまま', async () => {
    seedEvaluation(testDb.raw, {
      status: 'reply_failed', reply_status: 'failed',
      line_request_id: null, message_log_id: null, error_code: 'LineApiError',
    });
    const runId = seedActionRun(testDb.raw);

    const res = await setupApp(testDb.db).request('/api/auto-reply-runs/evaluation-1/retry', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(friendTagIds(testDb.raw, 'friend-1')).toEqual(['tag-1']);
    expect(runRow(testDb.raw, runId).status).toBe('succeeded');
    const evaluation = evaluationRow(testDb.raw, 'evaluation-1');
    // 返信の失敗だけは reply_failed のまま残り、返信は送り直さない。
    expect(evaluation.status).toBe('reply_failed');
    expect(evaluation.reply_status).toBe('failed');
    expect(evaluation.line_request_id).toBeNull();
    expect(evaluation.message_log_id).toBeNull();
    expect(evaluation.error_code).toBe('LineApiError');
  });
});

describe('GET /api/auto-reply-runs の canRetry（N-081、実DB）', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    seedScope(testDb.raw);
  });

  async function canRetryOf(evaluationId: string): Promise<boolean> {
    const res = await setupApp(testDb.db).request('/api/auto-reply-runs', {});
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { items: Array<{ id: string; canRetry: boolean }> } };
    const item = body.data.items.find((row) => row.id === evaluationId);
    if (!item) throw new Error(`run not listed: ${evaluationId}`);
    return item.canRetry;
  }

  it('permanent_failed の処理行がある評価だけ true', async () => {
    seedEvaluation(testDb.raw, { id: 'ev-failed', status: 'partial_failed' });
    seedActionRun(testDb.raw, { evaluation_id: 'ev-failed', status: 'permanent_failed' });
    seedEvaluation(testDb.raw, { id: 'ev-done', status: 'completed' });
    seedActionRun(testDb.raw, { evaluation_id: 'ev-done', status: 'succeeded' });
    seedEvaluation(testDb.raw, {
      id: 'ev-reply-failed', status: 'reply_failed', reply_status: 'failed',
    });

    expect(await canRetryOf('ev-failed')).toBe(true);
    expect(await canRetryOf('ev-done')).toBe(false);
    // 返信の失敗だけでは再実行できるものが無い。
    expect(await canRetryOf('ev-reply-failed')).toBe(false);
  });

  it('処理途中の評価は失敗行があっても false', async () => {
    seedEvaluation(testDb.raw, { id: 'ev-running', status: 'matched', completed_at: null });
    seedActionRun(testDb.raw, { evaluation_id: 'ev-running', status: 'permanent_failed' });
    expect(await canRetryOf('ev-running')).toBe(false);
  });

  it('選んだルールが見送られた行は false', async () => {
    testDb.raw.prepare(
      `INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, line_account_id, is_active)
       VALUES ('rule-skip', '予約', 'contains', 'text', 'x', 'acc-1', 1)`,
    ).run();
    seedEvaluation(testDb.raw, { id: 'ev-skip', status: 'completed', winning_auto_reply_id: 'rule-1' });
    seedActionRun(testDb.raw, { evaluation_id: 'ev-skip', status: 'permanent_failed' });
    testDb.raw.prepare(
      `INSERT INTO auto_reply_evaluation_details
         (id, evaluation_id, auto_reply_id, evaluation_order, result, reason_codes_json, created_at)
       VALUES ('detail-1', 'ev-skip', 'rule-skip', 1, 'skipped', '["operator_handling"]', '2026-09-15T01:00:00.000')`,
    ).run();

    const res = await setupApp(testDb.db).request('/api/auto-reply-runs?rule_id=rule-skip', {});
    const body = await res.json() as { data: { items: Array<{ id: string; canRetry: boolean; status: string }> } };
    const item = body.data.items.find((row) => row.id === 'ev-skip');
    expect(item?.status).toBe('skipped');
    expect(item?.canRetry).toBe(false);
  });
});
