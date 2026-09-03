import { describe, expect, it, vi } from 'vitest';
import {
  getAutoReplyEvaluationSummary,
  listAutoReplyEvaluationRuns,
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
