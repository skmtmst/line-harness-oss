import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { createAutomationActionExecutors } from '../automations/automation-action-executors.js';
import { processBroadcastAfterActions, sweepBroadcastAfterActions } from './broadcast-after-actions.js';
import { BroadcastDispatchBudget } from './broadcast-dispatch-budget.js';

/*
 * 一斉配信の送信後動作は、LINEが受け付けた宛先にだけ実行する。
 *
 * 送信前に動かすと届かなかった人にもタグが付く。失敗した宛先に動かすと
 * 「届いた人」の印が嘘になる。受理（send_claims = sent）を確認してから
 * 固定した公開版を実行し、失敗・送達不明の宛先には触れない。
 */
let db: SqliteD1;

const TAG_CONFIG = JSON.stringify([
  { id: 'a1', type: 'add_tag', params: { tagId: 'tag-done' }, onFailure: 'continue' },
]);

beforeEach(() => {
  db = createTestD1();
  db.raw.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', '本店', 'token', 'secret');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, is_following)
    VALUES ('friend-ok', 'U-ok', '届いた人', 'account-a', 1),
           ('friend-ng', 'U-ng', '届かなかった人', 'account-a', 1),
           ('friend-unknown', 'U-unknown', '分からない人', 'account-a', 1);
    INSERT INTO tags (id, line_account_id, name) VALUES ('tag-done', 'account-a', '配信済み');
    INSERT INTO common_actions (id, line_account_id, name, status)
    VALUES ('ca-1', 'account-a', '配信済みタグ', 'published');
    INSERT INTO common_action_versions (id, common_action_id, version_number, status, action_config)
    VALUES ('cav-1', 'ca-1', 1, 'published', '${TAG_CONFIG.replace(/'/g, "''")}');
    INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id, after_action_version_id)
    VALUES ('bc-1', '案内', 'text', '本文', 'tag', 'sending', 'account-a', 'cav-1');
    INSERT INTO broadcast_send_claims (broadcast_id, friend_id, line_account_id, attempt_no, state)
    VALUES ('bc-1', 'friend-ok', 'account-a', 1, 'sent'),
           ('bc-1', 'friend-ng', 'account-a', 1, 'failed'),
           ('bc-1', 'friend-unknown', 'account-a', 1, 'unknown');
  `);
});
afterEach(() => { db.raw.close(); });

function hasTag(friendId: string): boolean {
  const row = db.raw.prepare(
    `SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = 'tag-done'`,
  ).get(friendId);
  return row !== undefined;
}

function actionPlan(actions: Array<{ id: string; onFailure: 'stop' | 'continue' }>) {
  db.raw.prepare(`INSERT INTO common_action_versions(id,common_action_id,version_number,status,action_config)
    VALUES('cav-plan','ca-1',2,'published',?)`).run(JSON.stringify(actions.map(action => ({
      ...action, type: 'add_tag', params: { tagId: 'tag-done' },
    }))));
  db.raw.exec("UPDATE broadcasts SET after_action_version_id='cav-plan' WHERE id='bc-1'");
}

describe('送信後動作は受理後に実行し失敗宛先に触れない (P1-06)', () => {
  it('先行動作の実行中は同じ宛先を回収せず、完了後に順番どおり後続を実行する', async () => {
    actionPlan([{ id: 'first', onFailure: 'continue' }, { id: 'second', onFailure: 'continue' }]);
    let started!: () => void, finish!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const release = new Promise<void>(resolve => { finish = resolve; });
    const calls: string[] = [];
    const executors = { add_tag: async (context: { action: { id: string } }) => {
      calls.push(`${context.action.id}:start`);
      if (context.action.id === 'first') { started(); await release; }
      calls.push(`${context.action.id}:done`);
    } };
    const first = processBroadcastAfterActions(db.db, { broadcastId: 'bc-1', executors });
    await entered;
    expect(await sweepBroadcastAfterActions(db.db, { executors })).toEqual({ broadcasts: 0, done: 0, failed: 0 });
    expect(await processBroadcastAfterActions(db.db, { broadcastId: 'bc-1', executors })).toMatchObject({ done: 0 });
    expect(calls).toEqual(['first:start']);
    finish();
    expect((await first).done).toBe(2);
    expect(calls).toEqual(['first:start', 'first:done', 'second:start', 'second:done']);
  });

  it('候補取得後に別workerが先行動作を取得した場合もrunningを飛び越さない', async () => {
    actionPlan([{ id: 'first', onFailure: 'continue' }, { id: 'second', onFailure: 'continue' }]);
    let captured!: () => void, releaseCandidate!: () => void;
    const candidateReady = new Promise<void>(resolve => { captured = resolve; });
    const candidateRelease = new Promise<void>(resolve => { releaseCandidate = resolve; });
    const staleReader = new Proxy(db.db, { get(target, key) {
      if (key !== 'prepare') {
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      }
      return (sql: string) => {
        const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, { get(inner, method) {
          if (method === 'bind') return (...args: unknown[]) => wrap(inner.bind(...args));
          if (method === 'all' && sql.includes('SELECT c.friend_id AS friend_id')) return async () => {
            const result = await inner.all(); captured(); await candidateRelease; return result;
          };
          const value = Reflect.get(inner, method); return typeof value === 'function' ? value.bind(inner) : value;
        } });
        return wrap(target.prepare(sql));
      };
    } });
    let started!: () => void, finish!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const release = new Promise<void>(resolve => { finish = resolve; });
    const calls: string[] = [];
    const executors = { add_tag: async (context: { action: { id: string } }) => {
      calls.push(`${context.action.id}:start`);
      if (context.action.id === 'first') { started(); await release; }
      calls.push(`${context.action.id}:done`);
    } };
    const stale = processBroadcastAfterActions(staleReader, { broadcastId: 'bc-1', executors });
    await candidateReady;
    const owner = processBroadcastAfterActions(db.db, { broadcastId: 'bc-1', executors });
    await entered;
    releaseCandidate();
    expect((await stale).done).toBe(0);
    expect(calls).toEqual(['first:start']);
    finish();
    expect((await owner).done).toBe(2);
    expect(calls).toEqual(['first:start', 'first:done', 'second:start', 'second:done']);
  });

  it('最初の動作の決着後に中断しても、先に保存した後続pendingを再開する', async () => {
    actionPlan([{ id: 'first', onFailure: 'continue' }, { id: 'second', onFailure: 'continue' }]);
    db.raw.exec(`CREATE TRIGGER interrupt_second BEFORE UPDATE ON broadcast_after_action_runs
      WHEN NEW.action_id='second' AND NEW.status='running'
      BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END`);
    const executed: string[] = [];
    const executors = { add_tag: async (context: { action: { id: string } }) => { executed.push(context.action.id); } };
    await expect(processBroadcastAfterActions(db.db, { broadcastId: 'bc-1', executors })).rejects.toThrow('synthetic interruption');
    expect(db.raw.prepare('SELECT action_id,status FROM broadcast_after_action_runs ORDER BY action_id').all())
      .toEqual([{ action_id: 'first', status: 'done' }, { action_id: 'second', status: 'pending' }]);
    db.raw.exec('DROP TRIGGER interrupt_second');
    expect(await sweepBroadcastAfterActions(db.db, { executors })).toEqual({ broadcasts: 1, done: 1, failed: 0 });
    expect(executed).toEqual(['first', 'second']);
  });

  it('100動作の計画保存は1文で済み、時間予算で宛先途中に止まってもpendingから再開する', async () => {
    actionPlan(Array.from({ length: 100 }, (_, index) => ({ id: `step-${index}`, onFailure: 'continue' })));
    let clock = 0;
    const executed = new Set<string>();
    const firstBudget = new BroadcastDispatchBudget({ maxRunMs: 1_000, now: () => clock });
    const first = await sweepBroadcastAfterActions(db.db, { budget: firstBudget, executors: {
      add_tag: async context => { executed.add(context.action.id); clock += 600; },
    } });
    expect(first.done).toBe(2);
    expect(firstBudget.result.sqlStatements).toBeLessThan(20);
    expect(db.raw.prepare('SELECT status,COUNT(*) AS total FROM broadcast_after_action_runs GROUP BY status ORDER BY status').all())
      .toEqual([{ status: 'done', total: 2 }, { status: 'pending', total: 98 }]);
    expect((await sweepBroadcastAfterActions(db.db, { executors: {
      add_tag: async context => { expect(executed.has(context.action.id)).toBe(false); executed.add(context.action.id); },
    } })).done).toBe(98);
    expect(executed.size).toBe(100);
  });

  it('SQL予算を配信間で共有し、400動作を複数回収へ分けて重複なく完了する', async () => {
    db.raw.exec('DELETE FROM broadcasts');
    db.raw.transaction(() => {
      for (let friend = 0; friend < 40; friend += 1) db.raw.prepare(`INSERT INTO friends(id,line_user_id,line_account_id,is_following)
        VALUES(?,?,'account-a',1)`).run(`budget-${friend}`, `U-budget-${friend}`);
      for (let broadcast = 0; broadcast < 10; broadcast += 1) {
        const id = `budget-broadcast-${broadcast}`;
        db.raw.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,line_account_id,after_action_version_id)
          VALUES(?,'fixture','text','fixture','segment','sent','account-a','cav-1')`).run(id);
        db.raw.prepare(`INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,attempt_no,state)
          SELECT ?,id,'account-a',1,'sent' FROM friends WHERE id LIKE 'budget-%'`).run(id);
      }
    })();
    const executed = new Set<string>();
    let sweeps = 0;
    while (executed.size < 400 && sweeps < 20) {
      const budget = new BroadcastDispatchBudget({ maxSqlStatements: 250 });
      const result = await sweepBroadcastAfterActions(db.db, { budget, executors: { add_tag: async context => {
        expect(executed.has(context.idempotencyKey)).toBe(false); executed.add(context.idempotencyKey);
      } } });
      expect(budget.result.sqlStatements).toBeLessThanOrEqual(250);
      expect(result.done).toBeGreaterThan(0);
      sweeps += 1;
    }
    expect(sweeps).toBeGreaterThan(1);
    expect(executed.size).toBe(400);
  });

  it('停止指定の前動作が上限到達した後は後続pendingを保留し、回収枠を塞がない', async () => {
    actionPlan([{ id: 'first', onFailure: 'stop' }, { id: 'second', onFailure: 'continue' }]);
    db.raw.exec(`INSERT INTO broadcast_after_action_runs
      (id,broadcast_id,friend_id,common_action_version_id,action_id,status,attempt_count,max_attempts)
      VALUES('first','bc-1','friend-ok','cav-plan','first','failed',5,5),
            ('second','bc-1','friend-ok','cav-plan','second','pending',0,5)`);
    let executed = 0;
    await sweepBroadcastAfterActions(db.db, { executors: { add_tag: async () => { executed += 1; } } });
    expect(executed).toBe(0);
    expect(db.raw.prepare("SELECT status,error_code,attempt_count FROM broadcast_after_action_runs WHERE action_id='second'").get())
      .toEqual({ status: 'pending', error_code: 'blocked_by_failed_action', attempt_count: 0 });
    expect(await sweepBroadcastAfterActions(db.db)).toEqual({ broadcasts: 0, done: 0, failed: 0 });
  });

  it('再試行上限に達した50配信を残したまま、51番目の未開始動作を回収する', async () => {
    db.raw.exec('DELETE FROM broadcasts');
    for (let index = 0; index < 51; index += 1) {
      const id = `broadcast-${String(index).padStart(2, '0')}`;
      db.raw.prepare(`INSERT INTO broadcasts
        (id,title,message_type,message_content,target_type,status,line_account_id,after_action_version_id)
        VALUES(?,'fixture','text','fixture','segment','sent','account-a','cav-1')`).run(id);
      db.raw.prepare(`INSERT INTO broadcast_send_claims
        (broadcast_id,friend_id,line_account_id,attempt_no,state)
        VALUES(?,'friend-ok','account-a',1,'sent')`).run(id);
      if (index < 50) db.raw.prepare(`INSERT INTO broadcast_after_action_runs
        (id,broadcast_id,friend_id,common_action_version_id,action_id,status,attempt_count,max_attempts)
        VALUES(?,?,'friend-ok','cav-1','a1','failed',5,5)`).run(`failed-${index}`, id);
    }
    expect(await sweepBroadcastAfterActions(db.db)).toEqual({ broadcasts: 1, done: 1, failed: 0 });
    expect(hasTag('friend-ok')).toBe(true);
    expect(db.raw.prepare(`SELECT status FROM broadcast_after_action_runs WHERE broadcast_id='broadcast-50'`).get())
      .toEqual({ status: 'done' });
    expect(db.raw.prepare(`SELECT COUNT(*) AS total FROM broadcast_after_action_runs WHERE status='failed' AND attempt_count=5`).get())
      .toEqual({ total: 50 });
    expect(await sweepBroadcastAfterActions(db.db)).toEqual({ broadcasts: 0, done: 0, failed: 0 });
  });

  it('同じ配信の上限到達200宛先も後方の未開始宛先を塞がない', async () => {
    db.raw.transaction(() => {
      for (let index = 0; index < 200; index += 1) {
        const friendId = `exhausted-${String(index).padStart(3, '0')}`;
        db.raw.prepare(`INSERT INTO friends(id,line_user_id,line_account_id,is_following)
          VALUES(?,?,'account-a',1)`).run(friendId, `U-${friendId}`);
        db.raw.prepare(`INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,attempt_no,state)
          VALUES('bc-1',?,'account-a',1,'sent')`).run(friendId);
        db.raw.prepare(`INSERT INTO broadcast_after_action_runs
          (id,broadcast_id,friend_id,common_action_version_id,action_id,status,attempt_count,max_attempts)
          VALUES(?,'bc-1',?,'cav-1','a1','failed',5,5)`).run(`run-${friendId}`, friendId);
      }
    })();
    expect(await processBroadcastAfterActions(db.db, { broadcastId: 'bc-1' })).toMatchObject({ done: 1, failed: 0 });
    expect(hasTag('friend-ok')).toBe(true);
    expect(db.raw.prepare(`SELECT COUNT(*) AS total FROM broadcast_after_action_runs WHERE status='failed'`).get())
      .toEqual({ total: 200 });
  });

  it('先に完了した動作を繰り返さず、同じ宛先の再試行可能な後続動作を回収する', async () => {
    const actions = JSON.stringify([
      { id: 'first', type: 'add_tag', params: { tagId: 'tag-done' }, onFailure: 'continue' },
      { id: 'second', type: 'add_tag', params: { tagId: 'tag-done' }, onFailure: 'continue' },
    ]);
    db.raw.prepare(`INSERT INTO common_action_versions(id,common_action_id,version_number,status,action_config)
      VALUES('cav-two','ca-1',2,'published',?)`).run(actions);
    db.raw.exec(`UPDATE broadcasts SET after_action_version_id='cav-two' WHERE id='bc-1';
      INSERT INTO broadcast_after_action_runs
        (id,broadcast_id,friend_id,common_action_version_id,action_id,status,attempt_count,max_attempts)
      VALUES('first','bc-1','friend-ok','cav-two','first','done',1,5),
            ('second','bc-1','friend-ok','cav-two','second','failed',1,5)`);
    const executed: string[] = [];
    expect(await sweepBroadcastAfterActions(db.db, { executors: { add_tag: async context => { executed.push(context.action.id); } } }))
      .toEqual({ broadcasts: 1, done: 1, failed: 0 });
    expect(executed).toEqual(['second']);
  });

  it('受理した宛先にだけ固定版を実行する', async () => {
    const result = await processBroadcastAfterActions(db.db, {
      broadcastId: 'bc-1',
      executors: createAutomationActionExecutors(),
    });
    expect(result.done).toBe(1);
    expect(hasTag('friend-ok')).toBe(true);
    expect(hasTag('friend-ng')).toBe(false);
    expect(hasTag('friend-unknown')).toBe(false);
    const runs = db.raw.prepare(
      `SELECT friend_id, status FROM broadcast_after_action_runs WHERE broadcast_id = 'bc-1'`,
    ).all() as Array<{ friend_id: string; status: string }>;
    // 失敗・送達不明の宛先には台帳の行すら作らない。
    expect(runs).toEqual([{ friend_id: 'friend-ok', status: 'done' }]);
  });

  it('二度走っても二重に実行しない', async () => {
    const executors = createAutomationActionExecutors();
    await processBroadcastAfterActions(db.db, { broadcastId: 'bc-1', executors });
    const second = await processBroadcastAfterActions(db.db, { broadcastId: 'bc-1', executors });
    expect(second.done).toBe(0);
    expect(second.failed).toBe(0);
    // 実行済みの宛先は拾い直さない（タグ付けは1回きり）。
    expect(hasTag('friend-ok')).toBe(true);
    const tagCount = db.raw.prepare(
      `SELECT COUNT(*) AS n FROM friend_tags WHERE friend_id = 'friend-ok' AND tag_id = 'tag-done'`,
    ).get() as { n: number };
    expect(tagCount.n).toBe(1);
  });

  it('止める指定の失敗で後続を止め、無指定は続ける', async () => {
    // 公開版は不変なので、別アクションの別版を用意する。
    const stopConfig = JSON.stringify([
      { id: 'a1', type: 'add_tag', params: { tagId: 'tag-missing' }, onFailure: 'stop' },
      { id: 'a2', type: 'add_tag', params: { tagId: 'tag-done' }, onFailure: 'continue' },
    ]).replace(/'/g, "''");
    db.raw.exec(`
      INSERT INTO common_actions (id, line_account_id, name, status)
      VALUES ('ca-2', 'account-a', '止める試し', 'published');
      INSERT INTO common_action_versions (id, common_action_id, version_number, status, action_config)
      VALUES ('cav-2', 'ca-2', 1, 'published', '${stopConfig}');
      INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, line_account_id, after_action_version_id)
      VALUES ('bc-2', '案内2', 'text', '本文', 'tag', 'sending', 'account-a', 'cav-2');
      INSERT INTO broadcast_send_claims (broadcast_id, friend_id, line_account_id, attempt_no, state)
      VALUES ('bc-2', 'friend-ok', 'account-a', 1, 'sent');
    `);
    const result = await processBroadcastAfterActions(db.db, {
      broadcastId: 'bc-2',
      executors: createAutomationActionExecutors(),
    });
    expect(result.failed).toBe(1);
    // 止める指定で落ちたので2つ目は実行しない。
    expect(hasTag('friend-ok')).toBe(false);
    const runs = db.raw.prepare(
      `SELECT action_id, status FROM broadcast_after_action_runs WHERE broadcast_id = 'bc-2' AND friend_id = 'friend-ok' ORDER BY action_id`,
    ).all() as Array<{ action_id: string; status: string }>;
    expect(runs).toEqual([
      { action_id: 'a1', status: 'failed' },
      { action_id: 'a2', status: 'pending' },
    ]);
  });
});
