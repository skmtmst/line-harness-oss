import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyScoring, publishScenarioVersion } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { incomingWebhookFencedDb } from './incoming-webhook-fenced-db.js';
import { createAutomationActionExecutors } from './automation-action-executors.js';
import type { ActionDefinition, AutomationActionContext } from './automation-engine.js';

describe('受信所有権と副作用を同じSQL transactionで検査する', () => {
  let testDb: SqliteD1;
  let db: D1Database;
  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.exec(`INSERT INTO tenants (id,name) VALUES ('t','t');
      INSERT INTO line_accounts (id,channel_id,name,tenant_id,channel_access_token,channel_secret) VALUES ('a','ch','a','t','token','secret');
      INSERT INTO incoming_webhooks (id,name,source_type,line_account_id,secret) VALUES ('wh','wh','custom','a','secret');
      INSERT INTO friends (id,line_user_id,line_account_id,metadata) VALUES ('f','Uf','a','{}');
      INSERT INTO tags (id,name,line_account_id) VALUES ('tag','tag','a');
      INSERT INTO incoming_webhook_receipts (webhook_id,signature_hash,source_event_id,status,lease_owner,lease_expires_at,attempt_count)
        VALUES ('wh','hash','source','processing','owner',4102444800000,1);`);
    db = incomingWebhookFencedDb(testDb.db, { sourceEventId: 'source', owner: 'owner', generation: 1 });
  });
  afterEach(() => { vi.restoreAllMocks(); testDb.raw.close(); });

  it('runとbatchは有効な所有者の書き込みを許可する', async () => {
    expect((await db.prepare(`UPDATE friends SET score=1 WHERE id='f'`).run()).meta.changes).toBe(1);
    await db.batch([
      db.prepare(`UPDATE friends SET score=2 WHERE id='f'`),
      db.prepare(`INSERT INTO friend_tags (friend_id,tag_id) VALUES ('f','tag')`),
    ]);
    expect(await db.prepare(`SELECT score FROM friends WHERE id='f'`).first()).toEqual({ score: 2 });
    expect((await db.prepare('SELECT * FROM friend_tags').all()).results).toHaveLength(1);
  });

  it.each([
    "UPDATE incoming_webhook_receipts SET lease_owner='new-owner'",
    'UPDATE incoming_webhook_receipts SET attempt_count=2',
    'UPDATE incoming_webhook_receipts SET lease_expires_at=0',
    "UPDATE incoming_webhook_receipts SET status='completed'",
    'DELETE FROM incoming_webhook_receipts',
  ])('所有者・世代・DB時刻・状態・存在の不一致は書き込み0: %s', async sql => {
    testDb.raw.exec(sql);
    // JSの時計を過去にしても期限切れはDBの現在時刻で拒否する。
    vi.spyOn(Date, 'now').mockReturnValue(0);
    await expect(db.prepare(`UPDATE friends SET score=10 WHERE id='f'`).run()).rejects.toThrow();
    await expect(db.batch([
      db.prepare(`UPDATE friends SET score=20 WHERE id='f'`),
      db.prepare(`INSERT INTO friend_tags (friend_id,tag_id) VALUES ('f','tag')`),
    ])).rejects.toThrow();
    expect(testDb.raw.prepare('SELECT score FROM friends').get()).toEqual({ score: 0 });
    expect(testDb.raw.prepare('SELECT * FROM friend_tags').all()).toEqual([]);
  });

  it('副作用側のSQL失敗も同一batchの先行更新ごとrollbackする', async () => {
    await expect(db.batch([
      db.prepare(`UPDATE friends SET score=10 WHERE id='f'`),
      db.prepare(`INSERT INTO friends (id,line_user_id) VALUES ('f','duplicate')`),
    ])).rejects.toThrow();
    expect(testDb.raw.prepare('SELECT score FROM friends').get()).toEqual({ score: 0 });
  });

  it('未対応APIと別DBで作った文はfail-closedで書き込まない', async () => {
    expect(() => db.exec(`UPDATE friends SET score=99`)).toThrow('unsupported_database_api');
    expect(() => db.withSession()).toThrow('unsupported_database_api');
    expect(() => db.prepare('PRAGMA foreign_keys=OFF')).toThrow('unsupported_sql');
    expect(() => db.prepare(`UPDATE friends SET score=99 RETURNING score`).first()).toThrow('unsupported_statement_api');
    expect(() => db.prepare(`DELETE FROM friends RETURNING id`).all()).toThrow('unsupported_statement_api');
    expect(() => db.prepare(`SELECT score FROM friends`).raw()).toThrow('unsupported_statement_api');
    expect(() => db.batch([testDb.db.prepare(`UPDATE friends SET score=99`)])).toThrow('foreign_statement');
    expect(testDb.raw.prepare('SELECT score FROM friends').get()).toEqual({ score: 0 });
  });

  const context = (action: ActionDefinition): AutomationActionContext => ({
    db, runId: 'source', lineAccountId: 'a', automationId: 'incoming-webhook:wh',
    automationVersionId: 'wh', friendId: 'f', sourceEventId: 'source', inputEvent: {},
    action, stepExecutionId: 'step', idempotencyKey: 'step', attemptNumber: 1,
    commonActionVersionId: null, isTest: false,
  });

  it.each(['add_tag', 'remove_tag', 'set_metadata'])( '%s実行器の遅い旧所有者は確定済みの値を変えない', async type => {
    if (type === 'remove_tag') testDb.raw.exec(`INSERT INTO friend_tags (friend_id,tag_id) VALUES ('f','tag')`);
    testDb.raw.exec(`UPDATE incoming_webhook_receipts SET lease_owner='new-owner',attempt_count=2;
      UPDATE friends SET metadata='{"stage":"last"}';`);
    const before = testDb.raw.prepare('SELECT * FROM friend_tags').all();
    const action = { id: 'a', type, params: type === 'set_metadata' ? { values: { stage: 'first' } } : { tagId: 'tag' }, onFailure: 'stop' as const };
    await expect(createAutomationActionExecutors()[type]!(context(action))).rejects.toThrow();
    expect(testDb.raw.prepare('SELECT metadata FROM friends').get()).toEqual({ metadata: '{"stage":"last"}' });
    expect(testDb.raw.prepare('SELECT * FROM friend_tags').all()).toEqual(before);
  });

  it('旧所有者による加点batchは台帳も合計も変更しない', async () => {
    testDb.raw.exec(`INSERT INTO scoring_rules (id,name,event_type,score_value,is_active) VALUES ('r','r','incoming_webhook.custom',10,1);
      UPDATE incoming_webhook_receipts SET lease_owner='new-owner',attempt_count=2;`);
    await expect(applyScoring(db, 'f', 'incoming_webhook.custom', 'source')).rejects.toThrow();
    expect(testDb.raw.prepare('SELECT score FROM friends').get()).toEqual({ score: 0 });
    expect(testDb.raw.prepare('SELECT * FROM friend_scores').all()).toEqual([]);
  });

  it('旧所有者のシナリオ開始・停止・再開は新所有者の購読を変更しない', async () => {
    testDb.raw.exec(`INSERT INTO scenarios (id,name,trigger_type,is_active,delivery_mode,line_account_id,allow_concurrent)
      VALUES ('s','s','manual',1,'relative','a',1);
      INSERT INTO scenario_steps (id,scenario_id,step_order,delay_minutes,message_type,message_content)
      VALUES ('ss','s',1,0,'text','hello');`);
    await publishScenarioVersion(testDb.db, 's', { staffId: null, idempotencyKey: 'published' });
    testDb.raw.exec(`UPDATE incoming_webhook_receipts SET lease_owner='new-owner',attempt_count=2;`);
    const executors = createAutomationActionExecutors();
    const make = (type: string) => context({ id: type, type, params: { scenarioId: 's' }, onFailure: 'stop' });
    await expect(executors.start_scenario!(make('start_scenario'))).rejects.toThrow();
    expect(testDb.raw.prepare('SELECT * FROM friend_scenarios').all()).toEqual([]);
    testDb.raw.exec(`INSERT INTO friend_scenarios (id,friend_id,scenario_id,status) VALUES ('new','f','s','active')`);
    await expect(executors.stop_scenario!(make('stop_scenario'))).rejects.toThrow();
    expect(testDb.raw.prepare('SELECT status FROM friend_scenarios').get()).toEqual({ status: 'active' });
    testDb.raw.exec(`UPDATE friend_scenarios SET status='paused'`);
    await expect(executors.resume_scenario!(make('resume_scenario'))).rejects.toThrow();
    expect(testDb.raw.prepare('SELECT status FROM friend_scenarios').get()).toEqual({ status: 'paused' });
  });
});
