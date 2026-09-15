import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimAutoReplyEvaluationForRetry,
  claimPermanentFailedAutoReplyActionRuns,
  getAutoReplyEvaluationById,
  getAutoReplyEvaluationSummary,
  listAutoReplyActionRuns,
  listAutoReplyEvaluationRuns,
  recomputeAutoReplyEvaluationFromActions,
  reserveAutoReplyActionRun,
  reserveAutoReplyEvaluation,
} from '../src/auto-reply-runs.js';

type RecordEntry = { sql: string; bindings: unknown[] };

function recordedDb(options?: {
  insertChanges?: number;
  existing?: Record<string, unknown>;
  listRows?: Record<string, unknown>[];
}): { db: D1Database; records: RecordEntry[] } {
  const records: RecordEntry[] = [];
  const db = {
    prepare(sql: string) {
      const record = { sql, bindings: [] as unknown[] };
      records.push(record);
      const statement = {
        bind(...bindings: unknown[]) { record.bindings = bindings; return statement; },
        async run() { return { meta: { changes: options?.insertChanges ?? 1 } }; },
        async first() {
          if (sql.includes('WHERE incoming_event_id =')) return options?.existing ?? null;
          if (sql.includes('FROM auto_reply_action_runs')) return { id: 'action-run-1', status: 'queued' };
          if (sql.includes('COUNT(*) AS total')) return { total: 0 };
          if (sql.includes('SUM(CASE')) return {
            month_hits: 0, total_hits: 0, errors: 0, last_run_at: null, average_response_ms: null,
          };
          if (sql.includes('COUNT(DISTINCT')) return { total: 0, waiting: 0, in_progress: 0, completed: 0 };
          return null;
        },
        async all() { return { results: options?.listRows ?? [] }; },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, records };
}

describe('自動応答の書込台帳', () => {
  it('同じ受信イベントは既存行を返し、作成済みと判定しない', async () => {
    const existing = { id: 'evaluation-1', incoming_event_id: 'event-1', status: 'completed' };
    const { db } = recordedDb({ insertChanges: 0, existing });
    const result = await reserveAutoReplyEvaluation(db, {
      incomingEventId: 'event-1',
      lineAccountId: 'account-a',
      friendId: 'friend-1',
      messageKind: 'text',
      normalizedTextHash: 'hash',
      occurredAt: '2026-08-28T00:00:00.000Z',
    });
    expect(result.created).toBe(false);
    expect(result.row).toBe(existing);
  });

  it('一覧の全クエリへLINEアカウント範囲を付ける', async () => {
    const { db, records } = recordedDb();
    await listAutoReplyEvaluationRuns(db, {
      lineAccountIds: ['account-a', 'account-b'],
      includeUnassigned: false,
      limit: 20,
      offset: 0,
    });
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(record.sql).toContain('are.line_account_id IN (?, ?)');
      expect(record.bindings.slice(0, 2)).toEqual(['account-a', 'account-b']);
    }
  });

  it('処理行は共通状態のqueuedからclaimedへ一度だけ確保する', async () => {
    const { db, records } = recordedDb();
    const result = await reserveAutoReplyActionRun(db, {
      evaluationId: 'evaluation-1',
      actionStableId: 'action-1',
      actionType: 'tag',
      actionSnapshot: '{}',
      idempotencyKey: 'event-1:action-1',
    });
    expect(result).toEqual({ id: 'action-run-1', acquired: true });
    expect(records.find((record) => record.sql.includes('INSERT OR IGNORE'))?.sql)
      .toContain("'queued'");
    expect(records.find((record) => record.sql.includes("SET status = 'claimed'"))?.sql)
      .toContain("status = 'queued'");
  });

  it('選択したルールの見送り理由を、後続ルールの結果と混ぜず取得する', async () => {
    const { db, records } = recordedDb();
    await listAutoReplyEvaluationRuns(db, {
      ruleId: 'rule-a',
      lineAccountIds: ['account-a'],
      includeUnassigned: false,
      limit: 20,
      offset: 0,
    });
    const select = records.find((record) => record.sql.includes('candidate_reason_codes'));
    expect(select?.sql).toContain("detail.result = 'skipped'");
    expect(select?.sql).toContain('AS candidate_result');
    expect(select?.bindings).toEqual([
      'rule-a',
      'rule-a',
      'account-a',
      'rule-a',
      'rule-a',
      20,
      0,
    ]);
  });

  it('失敗にはskippedを混ぜず、何もしなかった記録と分ける', async () => {
    const { db, records } = recordedDb();
    await getAutoReplyEvaluationSummary(db, {
      lineAccountIds: ['account-a'],
      includeUnassigned: false,
      monthFrom: '2026-08-01T00:00:00.000Z',
      monthTo: '2026-09-01T00:00:00.000Z',
    });
    const summarySql = records.find((record) => record.sql.includes('SUM(CASE'))?.sql ?? '';
    expect(summarySql).toContain("('reply_failed', 'partial_failed', 'failed')");
    expect(summarySql).not.toContain("'skipped', 'failed'");
  });

  it('本文検索は保存済みの本文ではなく正規化ハッシュを照合する', async () => {
    const { db, records } = recordedDb();
    await listAutoReplyEvaluationRuns(db, {
      search: '予約したい',
      normalizedTextHash: 'normalized-hash',
      lineAccountIds: ['account-a'],
      includeUnassigned: false,
      limit: 20,
      offset: 0,
    });
    const select = records.find((record) => record.sql.includes('ORDER BY are.evaluated_at'));
    expect(select?.sql).toContain('are.normalized_text_hash = ?');
    expect(select?.sql).not.toContain('input_preview_masked,');
    expect(select?.bindings).toContain('normalized-hash');
  });
});

/*
 * N-081: permanent_failed の処理行だけを運用者が再実行する。
 * 確保の競合・集計の再計算・返信記録の保持は SQL が仕様なので、
 * モックではなく本物の SQLite に当てる。
 */
const DB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function realDb(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const make = (params: unknown[]) => ({
      bind: (...next: unknown[]) => make(next),
      async run() {
        const result = sqlite.prepare(query).run(...params);
        return { success: true, results: [], meta: { changes: result.changes } };
      },
      async first<T>() {
        return (sqlite.prepare(query).get(...params) as T) ?? null;
      },
      async all<T>() {
        return { success: true, results: sqlite.prepare(query).all(...params) as T[], meta: {} };
      },
    }) as unknown as D1PreparedStatement;
    return make([]);
  }
  return {
    prepare,
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      const run = sqlite.transaction(() => statements.map((statement) => statement.run()));
      return Promise.all(run()) as Promise<T[]>;
    },
  } as unknown as D1Database;
}

function seedEvaluation(
  sqlite: Database.Database,
  overrides: Record<string, unknown> = {},
): string {
  const row: Record<string, unknown> = {
    id: 'evaluation-1',
    incoming_event_id: `event-${Math.random().toString(36).slice(2)}`,
    incoming_message_log_id: null,
    line_account_id: 'account-a',
    friend_id: 'friend-1',
    message_kind: 'text',
    normalized_text_hash: 'hash',
    input_preview_masked: null,
    evaluated_at: '2026-09-15T01:00:00.000',
    completed_at: '2026-09-15T01:00:01.000',
    winning_auto_reply_id: 'rule-1',
    winning_version_id: 'version-1',
    status: 'partial_failed',
    skip_reason: null,
    matched_keyword: '予約',
    reply_status: 'accepted',
    line_request_id: 'line-request-1',
    message_log_id: 'outgoing-1',
    action_summary: '{"executed":1,"failed":1}',
    error_code: 'action_failed',
    duration_ms: 1000,
    created_at: '2026-09-15T01:00:00.000',
    updated_at: '2026-09-15T01:00:01.000',
    ...overrides,
  };
  const cols = Object.keys(row);
  sqlite.prepare(
    `INSERT INTO auto_reply_evaluations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
  ).run(...cols.map((c) => row[c]));
  return String(row.id);
}

function seedActionRun(
  sqlite: Database.Database,
  overrides: Record<string, unknown> = {},
): string {
  const row: Record<string, unknown> = {
    id: `run-${Math.random().toString(36).slice(2)}`,
    evaluation_id: 'evaluation-1',
    action_stable_id: 'auto-reply-action-0',
    action_version: 1,
    action_type: 'tag',
    action_snapshot: '{"id":"auto-reply-action-0"}',
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
  sqlite.prepare(
    `INSERT INTO auto_reply_action_runs (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
  ).run(...cols.map((c) => row[c]));
  return String(row.id);
}

function actionRunOf(sqlite: Database.Database, id: string) {
  return sqlite.prepare(`SELECT * FROM auto_reply_action_runs WHERE id = ?`).get(id) as {
    status: string;
    attempt_count: number;
    last_error_code: string | null;
    completed_at: string | null;
  };
}

describe('失敗した処理行の再実行（N-081、実DB）', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(DB_ROOT, 'bootstrap.sql'), 'utf8'));
    db = realDb(sqlite);
  });

  it('評価をIDで取れる', async () => {
    seedEvaluation(sqlite);
    expect((await getAutoReplyEvaluationById(db, 'evaluation-1'))?.friend_id).toBe('friend-1');
    expect(await getAutoReplyEvaluationById(db, 'evaluation-9')).toBeNull();
  });

  it('permanent_failed の行だけを確保し、試行回数と開始時刻を進める', async () => {
    seedEvaluation(sqlite);
    const failed = seedActionRun(sqlite, { id: 'run-failed', status: 'permanent_failed' });
    const done = seedActionRun(sqlite, { id: 'run-done', status: 'succeeded', action_stable_id: 'a-1' });
    const skipped = seedActionRun(sqlite, { id: 'run-skipped', status: 'skipped', action_stable_id: 'a-2' });
    const claimedAlready = seedActionRun(sqlite, { id: 'run-claimed', status: 'claimed', action_stable_id: 'a-3' });

    const claimed = await claimPermanentFailedAutoReplyActionRuns(db, 'evaluation-1');

    expect(claimed.map((row) => row.id)).toEqual([failed]);
    const updated = actionRunOf(sqlite, failed);
    expect(updated.status).toBe('claimed');
    expect(updated.attempt_count).toBe(2);
    expect(updated.completed_at).toBeNull();
    // 失敗していない行・処理中の行は一切触らない。
    expect(actionRunOf(sqlite, done).status).toBe('succeeded');
    expect(actionRunOf(sqlite, done).attempt_count).toBe(1);
    expect(actionRunOf(sqlite, skipped).status).toBe('skipped');
    expect(actionRunOf(sqlite, claimedAlready).status).toBe('claimed');
    expect(actionRunOf(sqlite, claimedAlready).attempt_count).toBe(1);
  });

  it('確保は条件付きUPDATEなので、2回目の呼び出しは0件を返す', async () => {
    seedEvaluation(sqlite);
    seedActionRun(sqlite, { id: 'run-failed' });
    expect(await claimPermanentFailedAutoReplyActionRuns(db, 'evaluation-1')).toHaveLength(1);
    // 先に確保された行は permanent_failed ではなくなっているので取りこぼす。
    expect(await claimPermanentFailedAutoReplyActionRuns(db, 'evaluation-1')).toHaveLength(0);
  });

  it('確保は1文の条件付きUPDATEで失敗行をまとめて取る（文が分かれると2並行で分け合ってしまう）', async () => {
    seedEvaluation(sqlite);
    seedActionRun(sqlite, { id: 'run-a' });
    seedActionRun(sqlite, { id: 'run-b', action_stable_id: 'a-1' });
    const statements: string[] = [];
    const inner = db;
    const counted = {
      prepare(query: string) {
        statements.push(query);
        return inner.prepare(query);
      },
      batch: inner.batch.bind(inner),
    } as unknown as D1Database;

    const claimed = await claimPermanentFailedAutoReplyActionRuns(counted, 'evaluation-1');

    // 2行とも1回の確保で取れ、UPDATE は1文だけ走る。SELECT＋行ごとの
    // UPDATE だと文の合間に別リクエストが残り行を取り、両方が副作用を起こす。
    expect(claimed.map((row) => row.id).sort()).toEqual(['run-a', 'run-b']);
    expect(
      statements.filter((sql) => /UPDATE\s+auto_reply_action_runs/i.test(sql)),
    ).toHaveLength(1);
    // 確保済みの行は二度目の確保を受けない。
    expect(await claimPermanentFailedAutoReplyActionRuns(counted, 'evaluation-1')).toHaveLength(0);
  });

  it('再実行の入口は評価側の条件付きUPDATEが1回だけ通す', async () => {
    seedEvaluation(sqlite);
    seedActionRun(sqlite);

    expect(await claimAutoReplyEvaluationForRetry(db, 'evaluation-1')).toBe(true);
    let row = sqlite.prepare(`SELECT status FROM auto_reply_evaluations WHERE id = 'evaluation-1'`).get() as { status: string };
    expect(row.status).toBe('actions_running');

    // 処理中はもう1本入れない（claimed の行がある＝生きている再実行）。
    seedActionRun(sqlite, { id: 'run-live', action_stable_id: 'a-9', status: 'claimed' });
    expect(await claimAutoReplyEvaluationForRetry(db, 'evaluation-1')).toBe(false);
  });

  it('再実行できない評価状態・失敗行なしでは入口を通さない', async () => {
    seedEvaluation(sqlite, { id: 'ev-done', status: 'completed' });
    seedActionRun(sqlite, { evaluation_id: 'ev-done', status: 'permanent_failed' });
    seedEvaluation(sqlite, { id: 'ev-none', status: 'partial_failed', incoming_event_id: 'event-none' });

    expect(await claimAutoReplyEvaluationForRetry(db, 'ev-done')).toBe(false);
    expect(await claimAutoReplyEvaluationForRetry(db, 'ev-none')).toBe(false);
    const done = sqlite.prepare(`SELECT status FROM auto_reply_evaluations WHERE id = 'ev-done'`).get() as { status: string };
    expect(done.status).toBe('completed');
  });

  it('途中で止まった再実行（actions_running＋失敗行残り・処理中行なし）はもう一度入れる', async () => {
    seedEvaluation(sqlite, { status: 'actions_running' });
    seedActionRun(sqlite); // permanent_failed のまま残った行

    expect(await claimAutoReplyEvaluationForRetry(db, 'evaluation-1')).toBe(true);
    const row = sqlite.prepare(`SELECT status FROM auto_reply_evaluations WHERE id = 'evaluation-1'`).get() as { status: string };
    expect(row.status).toBe('actions_running');
  });

  it('一覧の各行に permanent_failed の有無を付ける', async () => {
    seedEvaluation(sqlite, { id: 'evaluation-1', incoming_event_id: 'event-1' });
    seedActionRun(sqlite, { evaluation_id: 'evaluation-1', status: 'permanent_failed' });
    seedEvaluation(sqlite, {
      id: 'evaluation-2', incoming_event_id: 'event-2', status: 'reply_failed', reply_status: 'failed',
    });
    seedEvaluation(sqlite, {
      id: 'evaluation-3', incoming_event_id: 'event-3', status: 'completed',
    });
    seedActionRun(sqlite, { evaluation_id: 'evaluation-3', status: 'succeeded' });

    const { items } = await listAutoReplyEvaluationRuns(db, {
      lineAccountIds: ['account-a'],
      includeUnassigned: false,
      limit: 20,
      offset: 0,
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get('evaluation-1')?.has_failed_action_run).toBe(1);
    expect(byId.get('evaluation-2')?.has_failed_action_run).toBe(0);
    expect(byId.get('evaluation-3')?.has_failed_action_run).toBe(0);
  });

  it('集計と状態を全処理行から計算し直し、返信の記録はそのまま残す', async () => {
    seedEvaluation(sqlite);
    seedActionRun(sqlite, {
      id: 'run-ok', status: 'succeeded',
      result_json: '{"executed":1,"skippedByCondition":0,"skippedByOnce":0,"failed":0,"skippedIncomplete":0,"scenarioTouched":false}',
    });
    seedActionRun(sqlite, {
      id: 'run-fixed', status: 'succeeded', action_stable_id: 'a-1',
      result_json: '{"executed":0,"skippedByCondition":1,"skippedByOnce":0,"failed":0,"skippedIncomplete":0,"scenarioTouched":false}',
    });

    await recomputeAutoReplyEvaluationFromActions(db, 'evaluation-1');

    const row = sqlite.prepare(`SELECT * FROM auto_reply_evaluations WHERE id = 'evaluation-1'`).get() as {
      status: string; reply_status: string; line_request_id: string | null;
      message_log_id: string | null; action_summary: string; error_code: string | null;
    };
    expect(row.status).toBe('completed');
    const summary = JSON.parse(row.action_summary) as Record<string, number>;
    expect(summary.executed).toBe(1);
    expect(summary.skippedByCondition).toBe(1);
    expect(summary.failed).toBe(0);
    expect(row.error_code).toBeNull();
    // LINEの返信結果・要求ID・送信ログは再送しないので、そのまま残る。
    expect(row.reply_status).toBe('accepted');
    expect(row.line_request_id).toBe('line-request-1');
    expect(row.message_log_id).toBe('outgoing-1');
  });

  it('失敗が残るなら partial_failed、返信だけの失敗は reply_failed のままにする', async () => {
    seedEvaluation(sqlite);
    seedActionRun(sqlite, { id: 'run-still-failed', status: 'permanent_failed' });
    seedActionRun(sqlite, { id: 'run-ok', status: 'succeeded', action_stable_id: 'a-1' });
    await recomputeAutoReplyEvaluationFromActions(db, 'evaluation-1');
    expect((sqlite.prepare(`SELECT status FROM auto_reply_evaluations WHERE id = 'evaluation-1'`).get() as { status: string }).status)
      .toBe('partial_failed');

    seedEvaluation(sqlite, {
      id: 'evaluation-2', incoming_event_id: 'event-2',
      status: 'reply_failed', reply_status: 'failed', error_code: 'LineApiError',
    });
    seedActionRun(sqlite, { evaluation_id: 'evaluation-2', status: 'succeeded', action_stable_id: 'a-9' });
    await recomputeAutoReplyEvaluationFromActions(db, 'evaluation-2');
    const replyFailed = sqlite.prepare(
      `SELECT status, error_code FROM auto_reply_evaluations WHERE id = 'evaluation-2'`,
    ).get() as { status: string; error_code: string | null };
    // 返信の失敗だけは reply_failed のまま。返信の失敗理由も消さない。
    expect(replyFailed.status).toBe('reply_failed');
    expect(replyFailed.error_code).toBe('LineApiError');
  });
});
