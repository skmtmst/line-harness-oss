import Database from 'better-sqlite3';
import { beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getLineAccountListStats } from '../src/line-accounts.js';
import { asD1 } from './d1-test-helper.js';

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', 'A', 'token-a', 'secret-a'),
           ('account-b', 'channel-b', 'B', 'token-b', 'secret-b'),
           ('account-c', 'channel-c', 'C', 'token-c', 'secret-c'),
           ('account-d', 'channel-d', 'D', 'token-d', 'secret-d');
    UPDATE line_accounts SET token_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = 'account-d';
    INSERT INTO staff_members (id, name, role, api_key, is_active, invite_status, account_scope)
    VALUES ('staff-all', '全担当', 'staff', 'key-all', 1, 'active', 'all'),
           ('staff-a', '個別担当', 'staff', 'key-a', 1, 'active', 'accounts'),
           ('staff-invited', '招待中', 'staff', 'key-invited', 1, 'invited', 'all'),
           ('staff-inactive', '停止中', 'staff', 'key-inactive', 0, 'active', 'all');
    INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
    VALUES ('staff-a', 'account-a', datetime('now'));
    INSERT INTO friends (id, line_user_id, line_account_id, is_following)
    VALUES ('friend-a1', 'Ua1', 'account-a', 1),
           ('friend-a2', 'Ua2', 'account-a', 1),
           ('friend-a3', 'Ua3', 'account-a', 0),
           ('friend-b1', 'Ub1', 'account-b', 1);
    INSERT INTO scenarios (id, name, trigger_type) VALUES ('scenario-1', '案内', 'manual');
    INSERT INTO friend_scenarios (id, friend_id, scenario_id, status)
    VALUES ('enrollment-a1', 'friend-a1', 'scenario-1', 'active'),
           ('enrollment-a2', 'friend-a2', 'scenario-1', 'paused'),
           ('enrollment-b1', 'friend-b1', 'scenario-1', 'active');
    INSERT INTO messages_log
      (id, friend_id, direction, message_type, content, delivery_type, created_at)
    VALUES ('message-a-push', 'friend-a1', 'outgoing', 'text', 'a', 'push', datetime('now', 'start of month', '+1 day')),
           ('message-a-reply', 'friend-a1', 'outgoing', 'text', 'a', 'reply', datetime('now', 'start of month', '+1 day')),
           ('message-a-old', 'friend-a2', 'outgoing', 'text', 'a', 'push', datetime('now', 'start of month', '-1 day')),
           ('message-b-legacy', 'friend-b1', 'outgoing', 'text', 'b', NULL, datetime('now', 'start of month', '+1 day'));
    INSERT INTO line_account_connection_checks
      (id, line_account_id, check_kind, result, checked_by, checked_at, correlation_id, idempotency_key, account_revision)
    VALUES ('check-a-bot', 'account-a', 'bot_info', 'ok', 'staff-all', '2026-09-15T09:59:00.000Z', 'corr-a', 'idem-a', 1),
           ('check-a-webhook', 'account-a', 'webhook_endpoint', 'matched', 'staff-all', '2026-09-15T10:00:00.000Z', 'corr-a', 'idem-a', 1),
           ('check-a-test', 'account-a', 'webhook_test', 'ok', 'staff-all', '2026-09-15T10:01:00.000Z', 'corr-a', 'idem-a', 1),
           ('check-a-liff', 'account-a', 'liff_config', 'unknown', 'staff-all', '2026-09-15T10:01:30.000Z', 'corr-a', 'idem-a', 1),
           ('check-b-bot', 'account-b', 'bot_info', 'ok', 'staff-all', '2026-09-15T10:01:00.000Z', 'corr-b', 'idem-b', 1),
           ('check-b-webhook', 'account-b', 'webhook_endpoint', 'mismatched', 'staff-all', '2026-09-15T10:02:00.000Z', 'corr-b', 'idem-b', 1),
           ('check-b-test', 'account-b', 'webhook_test', 'unknown', 'staff-all', '2026-09-15T10:02:30.000Z', 'corr-b', 'idem-b', 1),
           ('check-d-webhook', 'account-d', 'webhook_endpoint', 'matched', 'staff-all', '2026-09-15T10:03:00.000Z', 'corr-d', 'idem-d', 1);
  `);
  db = asD1(sqlite);
});

describe('LINEアカウント一覧の一括集計', () => {
  test('件数・担当者数・接続状態をアカウント別に一度で返す', async () => {
    const prepareCalls: string[] = [];
    const countingDb = {
      ...db,
      prepare(query: string) {
        prepareCalls.push(query);
        return db.prepare(query);
      },
    } as D1Database;

    await expect(
      getLineAccountListStats(countingDb, ['account-a', 'account-b', 'account-c', 'account-d']),
    ).resolves.toEqual({
      'account-a': { friendCount: 2, activeScenarios: 1, messagesThisMonth: 1, staffCount: 2, connection: { isActive: true, archivedAt: null, status: 'ok', checkedAt: '2026-09-15T10:01:00.000Z', tokenExpired: false, issues: [] } },
      'account-b': { friendCount: 1, activeScenarios: 1, messagesThisMonth: 1, staffCount: 1, connection: { isActive: true, archivedAt: null, status: 'warn', checkedAt: '2026-09-15T10:02:30.000Z', tokenExpired: false, issues: [
        { kind: 'webhook_endpoint', result: 'mismatched', expectedUrl: null, registeredUrl: null, webhookActive: null, httpStatus: null },
      ] } },
      'account-c': { friendCount: 0, activeScenarios: 0, messagesThisMonth: 0, staffCount: 1, connection: { isActive: true, archivedAt: null, status: 'unknown', checkedAt: null, tokenExpired: false, issues: [] } },
      'account-d': { friendCount: 0, activeScenarios: 0, messagesThisMonth: 0, staffCount: 1, connection: { isActive: true, archivedAt: null, status: 'unknown', checkedAt: '2026-09-15T10:03:00.000Z', tokenExpired: true, issues: [] } },
    });
    expect(prepareCalls).toHaveLength(1);
  });

  test('要確認の理由として、最新の確認のうち引っかかったものだけを URL ごと返す', async () => {
    sqlite.exec(`
      INSERT INTO line_account_connection_checks
        (id, line_account_id, check_kind, result, expected_url, registered_url, webhook_active, http_status,
         checked_by, checked_at, correlation_id, idempotency_key, account_revision)
      VALUES ('check-c-bot-old', 'account-c', 'bot_info', 'failed', NULL, NULL, NULL, 401,
              'staff-all', '2026-09-14T10:00:00.000Z', 'corr-c0', 'idem-c0', 1),
             ('check-c-bot', 'account-c', 'bot_info', 'ok', NULL, NULL, NULL, 200,
              'staff-all', '2026-09-15T10:00:00.000Z', 'corr-c', 'idem-c', 1),
             ('check-c-webhook', 'account-c', 'webhook_endpoint', 'mismatched',
              'https://stg-api.example.test/webhook', 'https://old.example.test/webhook', 1, 200,
              'staff-all', '2026-09-15T10:00:01.000Z', 'corr-c', 'idem-c', 1),
             ('check-c-liff', 'account-c', 'liff_config', 'failed', NULL, NULL, NULL, NULL,
              'staff-all', '2026-09-15T10:00:02.000Z', 'corr-c', 'idem-c', 1);
    `);
    const stats = await getLineAccountListStats(db, ['account-c']);
    expect(stats['account-c'].connection).toEqual({
      isActive: true, archivedAt: null, status: 'warn',
      checkedAt: '2026-09-15T10:00:01.000Z',
      tokenExpired: false,
      issues: [{
        kind: 'webhook_endpoint',
        result: 'mismatched',
        expectedUrl: 'https://stg-api.example.test/webhook',
        registeredUrl: 'https://old.example.test/webhook',
        webhookActive: true,
        httpStatus: 200,
      }],
    });
  });

  test('アカウント数を増やしてもD1問い合わせとbindは1回のまま', async () => {
    const prepareCalls: string[] = [];
    const bindCalls: unknown[][] = [];
    const countingDb = {
      prepare(query: string) {
        prepareCalls.push(query);
        const statement = db.prepare(query);
        return {
          ...statement,
          bind(...values: unknown[]) {
            bindCalls.push(values);
            return statement.bind(...values);
          },
        };
      },
    } as D1Database;

    await getLineAccountListStats(
      countingDb,
      Array.from({ length: 200 }, (_, index) => `account-${index}`),
    );

    expect(prepareCalls).toHaveLength(1);
    expect(bindCalls).toHaveLength(1);
    expect(bindCalls[0]).toHaveLength(1);
  });
});

 test('手動確認と定期のbot確認を同じ時刻で比較し、復旧とWebhookの問題を別々に残す', async () => {
   sqlite.exec(`INSERT INTO account_health_logs (id,line_account_id,error_code,error_count,check_period,risk_level,created_at)
     VALUES ('cron-a','account-a',401,1,'5m','normal','2026-09-15T19:05:00'),
            ('cron-b','account-b',NULL,0,'5m','warning','2026-09-15T19:05:00+09:00');`);
   let stats = await getLineAccountListStats(db, ['account-a', 'account-b']);
   expect(stats['account-a'].connection).toMatchObject({ status: 'warn', checkedAt: '2026-09-15T10:05:00.000Z', issues: [{ kind: 'bot_info', httpStatus: 401 }] });
   expect(stats['account-b'].connection).toMatchObject({ status: 'warn', issues: [{ kind: 'webhook_endpoint' }] });
   sqlite.exec(`INSERT INTO line_account_connection_checks
     (id,line_account_id,check_kind,result,checked_by,checked_at,correlation_id,idempotency_key,account_revision)
     VALUES ('recovered-a','account-a','bot_info','ok','staff-all','2026-09-15T10:06:00Z','recover','recover',1);`);
   stats = await getLineAccountListStats(db, ['account-a']);
   expect(stats['account-a'].connection).toMatchObject({ status: 'ok', issues: [] });
 });

 test('定期の送信量のwarningとトークン更新失敗だけを接続の故障にしない', async () => {
   sqlite.exec(`INSERT INTO account_health_logs (id,line_account_id,error_code,error_count,check_period,risk_level,created_at)
     VALUES ('traffic','account-c',NULL,0,'5m','warning','2026-09-15T10:05:00Z');
     INSERT INTO line_account_connection_checks
     (id,line_account_id,check_kind,result,checked_by,checked_at,correlation_id,idempotency_key,account_revision)
     VALUES ('refresh','account-c','token_refresh','failed','staff-all','2026-09-15T10:06:00Z','refresh','refresh',1);`);
   expect((await getLineAccountListStats(db, ['account-c']))['account-c'].connection).toMatchObject({ status: 'unknown', issues: [] });
   sqlite.exec("UPDATE line_accounts SET is_active=0 WHERE id='account-c'");
   expect((await getLineAccountListStats(db, ['account-c']))['account-c'].connection.isActive).toBe(false);
 });

 test('botとWebhookの両方の確認がない限り正常にせず、無受信と除外を一覧へ反映する', async () => {
   sqlite.exec(`INSERT INTO account_health_logs(id,line_account_id,error_count,check_period,risk_level,created_at)
     VALUES('bot-only','account-c',0,'5m','normal','2026-09-15T10:05:00Z');`);
   expect((await getLineAccountListStats(db,['account-c']))['account-c'].connection.status).toBe('unknown');
   sqlite.exec("UPDATE line_accounts SET last_webhook_received_at='2020-01-01T09:00:00' WHERE id='account-a'");
   expect((await getLineAccountListStats(db,['account-a']))['account-a'].connection).toMatchObject({status:'warn',issues:[{kind:'webhook_silence'}]});
   sqlite.exec("UPDATE line_accounts SET webhook_silence_exempt=1 WHERE id='account-a'");
   expect((await getLineAccountListStats(db,['account-a']))['account-a'].connection.status).toBe('ok');
 });

 test('定期ログの最新をUTC/JSTの文字順で取り違えず、期限の時差なしもJSTとして読む', async () => {
   sqlite.exec(`INSERT INTO account_health_logs(id,line_account_id,error_code,error_count,check_period,risk_level,created_at)
     VALUES('jst-old','account-a',401,1,'5m','normal','2026-09-15T19:05:00'),
           ('utc-new','account-a',NULL,0,'5m','normal','2026-09-15T10:06:00Z');`);
   const deadline = new Date(Date.now()+8*60*60_000).toISOString().replace(/Z$/,'');
   sqlite.prepare('UPDATE line_accounts SET token_expires_at=? WHERE id=?').run(deadline,'account-a');
   expect((await getLineAccountListStats(db,['account-a']))['account-a'].connection).toMatchObject({status:'ok',tokenExpired:true,checkedAt:'2026-09-15T10:06:00.000Z'});
 });

 test('5万件の定期記録でもアカウントごとの相関で最新1件を取得する', async () => {
   const insert = sqlite.prepare("INSERT INTO account_health_logs(id,line_account_id,error_code,error_count,check_period,risk_level,created_at) VALUES(?,'account-a',?,?,'5m','normal',?)")
   sqlite.transaction(() => {
     for(let i=0;i<50_000;i++)insert.run('bulk-'+i,401,1,new Date(Date.parse('2026-09-14T00:00:00Z')+i*1000).toISOString())
     insert.run('newest',null,0,'2026-09-15T12:00:00Z')
   })()
   let query = ''
   const observedDb = { ...db, prepare(sql:string) { query=sql; return db.prepare(sql) } } as D1Database
   const ids=['account-a','account-b','account-c','account-d']
   const stats=await getLineAccountListStats(observedDb,ids)
   expect(Object.keys(stats)).toHaveLength(4)
   expect(stats['account-a'].connection).toMatchObject({status:'ok',checkedAt:'2026-09-15T12:00:00.000Z'})
   const plan=sqlite.prepare('EXPLAIN QUERY PLAN '+query).all(JSON.stringify(ids)) as Array<{id:number;parent:number;detail:string}>
   const correlated=plan.filter(row=>row.detail.includes('CORRELATED SCALAR SUBQUERY'))
   expect(correlated.some(node=>plan.some(row=>row.parent===node.id && /SEARCH recent USING INDEX.*\(line_account_id=\?\)/.test(row.detail)))).toBe(true)
   expect(plan.some(row=>/SEARCH health USING INDEX.*\(id=\?\)/.test(row.detail))).toBe(true)

 })
