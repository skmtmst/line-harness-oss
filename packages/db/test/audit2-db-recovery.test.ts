import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { purgeExpiredAutomationRuns } from '../src/automation-retention.js';
import { getFriendFieldListSummary, countFriendFieldValuesForScopes } from '../src/friend-fields.js';
import { createMileageRewardDraft, importMileageRewardCodes } from '../src/mileage-rewards.js';
import { captureFriendAddEventAttribution } from '../src/friend-add-events.js';
import { recordLinkClick } from '../src/tracked-links.js';
import { addScore } from '../src/scoring.js';
import { getTemplateSendCounts, createTemplate, publishTemplate } from '../src/templates.js';
import { saveLineAccountConnectionChecks } from '../src/line-accounts.js';
import { createFieldMigrationPreview, queueFieldMigration, executeFieldMigration } from '../src/field-migrations.js';
import { bumpAuthThrottle, readAuthThrottle } from '../src/auth-email.js';
import { linkHandover, issueHandoverCode } from '../src/account-handovers.js';
let raw: Database.Database;
let db: D1Database;
const account = 'account';
const scope = { tenantId: '00000000-0000-4000-8000-000000000001', lineAccountId: account };
beforeEach(() => {
  raw = new Database(':memory:');
  raw.exec(readFileSync(fileURLToPath(new URL('../bootstrap.sql', import.meta.url)), 'utf8'));
  db = asD1(raw);
  raw.exec("INSERT INTO mileage_programs(id,code,name,created_at,updated_at) VALUES('default','default','Miles','2026-10-08','2026-10-08'); INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES('account','Account','channel','token','secret'); INSERT INTO friends(id,line_user_id,line_account_id) VALUES('friend','Ufriend','account')");
});
afterEach(() => { raw.close(); vi.useRealTimers(); });
function oldRuns(count: number) {
  raw.exec("INSERT INTO automation_definitions(id,line_account_id,name) VALUES('automation','account','Rule'); INSERT INTO automation_versions(id,automation_id,version_number,trigger_type) VALUES('version','automation',1,'manual')");
  for (let index = 0; index < count; index++) {
    const id = `run-${index}`;
    raw.prepare("INSERT INTO automation_runs(id,line_account_id,automation_id,automation_version_id,source_event_id,idempotency_key,status,created_at) VALUES(?,'account','automation','version',?,?,'success','2026-01-01T00:00:00Z')").run(id,id,id);
    raw.prepare("INSERT INTO automation_run_steps(id,automation_run_id,step_key,action_type,idempotency_key,status) VALUES(?,?,'step','tag',?,'success')").run(id,id,id);
  }
}
describe('監査2: 件数の境界と途中失敗の回復', () => {
  it('PKG38: 150項目の一覧と使用数をD1の100bind以内で集計する', async () => {
    const ids = [];
    for (let index = 0; index < 150; index++) {
      const id = `field${index}`; ids.push(id);
      raw.prepare("INSERT INTO friend_fields(id,name,field_key,type) VALUES(?,?,?,'text')").run(id,id,id);
      raw.prepare("INSERT INTO friend_field_values(friend_id,field_id,value,updated_at) VALUES('friend',?,'value','2026-10-08')").run(id);
    }
    const summary = await getFriendFieldListSummary(db, scope);
    expect(summary).toMatchObject({ total: 150, inUse: 150, registeredFriends: 1 });
    expect((await countFriendFieldValuesForScopes(db, ids, scope)).size).toBe(150);
  });
  it('PKG49/50: 95件と子明細を外部キーを守って集計・削除し、再実行で二重計上しない', async () => {
    oldRuns(95); raw.pragma('foreign_keys = ON');
    const result = await purgeExpiredAutomationRuns(db, new Date('2026-10-08T00:00:00Z'));
    expect(result).toMatchObject({ runs: 95, steps: 95, dailyBuckets: 1 });
    expect(raw.prepare('SELECT run_count,step_count FROM automation_run_daily_counts').get()).toEqual({ run_count: 95, step_count: 95 });
    expect((await purgeExpiredAutomationRuns(db, new Date('2026-10-08T00:00:00Z'))).runs).toBe(0);
  });
  it('PKG50: 日別集計の保存失敗で元の履歴・子明細を消さない', async () => {
    oldRuns(1);
    raw.exec("CREATE TRIGGER fail_daily BEFORE INSERT ON automation_run_daily_counts BEGIN SELECT RAISE(ABORT,'storage unavailable'); END");
    await expect(purgeExpiredAutomationRuns(db, new Date('2026-10-08T00:00:00Z'))).rejects.toThrow();
    expect(raw.prepare('SELECT COUNT(*) n FROM automation_runs').get()).toEqual({ n: 1 });
    expect(raw.prepare('SELECT COUNT(*) n FROM automation_run_steps').get()).toEqual({ n: 1 });
    raw.exec('DROP TRIGGER fail_daily');
    expect((await purgeExpiredAutomationRuns(db, new Date('2026-10-08T00:00:00Z'))).runs).toBe(1);
  });
  it('PKG51: 100件の交換コードを登録でき、同じ取り込みを二重に数えない', async () => {
    const draft = await createMileageRewardDraft(db, { lineAccountId: account, draft: { name: 'Coupon', rewardKind: 'coupon', requiredMiles: 100 } });
    const codes = Array.from({ length: 100 }, (_, index) => ({ fingerprint: `fingerprint-${index}`, ciphertext: `encrypted-${index}` }));
    await importMileageRewardCodes(db, { rewardId: draft.id, lineAccountId: account, codes });
    await importMileageRewardCodes(db, { rewardId: draft.id, lineAccountId: account, codes });
    expect(raw.prepare('SELECT COUNT(*) n FROM mileage_reward_codes').get()).toEqual({ n: 100 });
  });
  it('PKG63: 流入元の保存が落ちても同じイベントで回復できる', async () => {
    raw.exec("INSERT INTO friend_add_events(id,line_account_id,friend_id,webhook_event_id,friend_kind,occurred_at) VALUES('event','account','friend','source','first_time','2026-10-08T00:00:00Z'); INSERT INTO friend_add_attribution_candidates(id,line_account_id,friend_id,ref_code,source,occurred_at,expires_at) VALUES('candidate','account','friend','ref','liff','2026-10-08T00:00:00Z','2026-10-09T00:00:00Z'); CREATE TRIGGER fail_attribution BEFORE UPDATE OF attribution_status ON friend_add_events BEGIN SELECT RAISE(ABORT,'storage unavailable'); END");
    const input = { eventId: 'event', lineAccountId: account, friendId: 'friend', now: '2026-10-08T01:00:00Z' };
    await expect(captureFriendAddEventAttribution(db, input)).rejects.toThrow();
    raw.exec('DROP TRIGGER fail_attribution');
    expect(await captureFriendAddEventAttribution(db, input)).toEqual({ refCode: 'ref', entryRouteId: null });
    expect(await captureFriendAddEventAttribution(db, input)).toEqual({ refCode: 'ref', entryRouteId: null });
  });
  it('PKG68: クリック件数の保存失敗は明細も巻き戻し、次の記録と一致する', async () => {
    raw.exec("INSERT INTO tracked_links(id,name,original_url) VALUES('link','Link','https://example.test'); CREATE TRIGGER fail_click BEFORE UPDATE OF click_count ON tracked_links BEGIN SELECT RAISE(ABORT,'storage unavailable'); END");
    await expect(recordLinkClick(db, 'link', 'friend')).rejects.toThrow();
    expect(raw.prepare('SELECT COUNT(*) n FROM link_clicks').get()).toEqual({ n: 0 });
    raw.exec('DROP TRIGGER fail_click'); await recordLinkClick(db, 'link', 'friend');
    expect(raw.prepare('SELECT click_count FROM tracked_links').get()).toEqual({ click_count: 1 });
  });
  it('PKG47: スコアの保存失敗は履歴も巻き戻して回復時の現在値と一致する', async () => {
    raw.exec("CREATE TRIGGER fail_score BEFORE UPDATE OF score ON friends BEGIN SELECT RAISE(ABORT,'storage unavailable'); END");
    await expect(addScore(db, { friendId: 'friend', scoreChange: 10 })).rejects.toThrow();
    expect(raw.prepare('SELECT COUNT(*) n FROM friend_scores').get()).toEqual({ n: 0 });
    raw.exec('DROP TRIGGER fail_score'); await addScore(db, { friendId: 'friend', scoreChange: 10 });
    expect(raw.prepare("SELECT score FROM friends WHERE id='friend'").get()).toEqual({ score: 10 });
    expect(raw.prepare('SELECT SUM(score_change) n FROM friend_scores').get()).toEqual({ n: 10 });
  });
  it('PKG47: 同じ加点番号は一度だけで、内容の変更や別の操作と混ざらない', async () => {
    const input = { friendId: 'friend', scoreChange: 10, idempotencyKey: 'request-1' };
    await Promise.all([addScore(db, input), addScore(db, input)]);
    await expect(addScore(db, { ...input, scoreChange: 20 })).rejects.toThrow('score_idempotency_conflict');
    await addScore(db, { ...input, idempotencyKey: 'request-2' });
    expect(raw.prepare("SELECT score FROM friends WHERE id='friend'").get()).toEqual({ score: 20 });
    expect(raw.prepare('SELECT COUNT(*) n, SUM(score_change) total FROM friend_scores').get()).toEqual({ n: 2, total: 20 });
  });
  it('PKG63: 旧処理が候補だけ消費済みでも同じイベントへ回復し、別イベントは奪わない', async () => {
    raw.exec("INSERT INTO friend_add_events(id,line_account_id,friend_id,webhook_event_id,friend_kind,occurred_at) VALUES('event','account','friend','source','first_time','2026-10-08T00:00:00Z'),('other','account','friend','other-source','returning','2026-10-08T01:00:00Z'); INSERT INTO friend_add_attribution_candidates(id,line_account_id,friend_id,ref_code,source,status,consumed_by_event_id,occurred_at,expires_at) VALUES('candidate','account','friend','ref','liff','consumed','event','2026-10-08T00:00:00Z','2026-10-08T00:10:00Z')");
    expect(await captureFriendAddEventAttribution(db, { eventId: 'other', lineAccountId: account, friendId: 'friend', now: '2026-10-08T01:00:00Z' })).toBeNull();
    expect(await captureFriendAddEventAttribution(db, { eventId: 'event', lineAccountId: account, friendId: 'friend', now: '2026-10-08T01:00:00Z' })).toEqual({ refCode: 'ref', entryRouteId: null });
  });

  it('PKG36: 並行20要求をそれぞれ数え、窓の期限で1から再開する', async () => {
    const now = new Date('2026-10-08T03:00:00Z');
    const counts = await Promise.all(Array.from({ length: 20 }, () => bumpAuthThrottle(db, 'key', 60_000, now)));
    expect(counts.slice().sort((a,b) => a-b)).toEqual(Array.from({ length: 20 }, (_, i) => i+1));
    expect(await readAuthThrottle(db, 'key', 60_000, now)).toBe(20);
    expect(await bumpAuthThrottle(db, 'key', 60_000, new Date(now.getTime()+60_001))).toBe(1);
  });
  it('PKG29: UTC表記のコードをJST表記の現在時刻と正しく比べ、期限前は同じコードを返す', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T03:00:00Z'));
    raw.exec("INSERT INTO account_handovers(id,from_account_id,code,code_expires_at,created_at) VALUES('handover','account','code','2026-10-08T06:00:00Z','2026-10-08T00:00:00Z')");
    expect((await issueHandoverCode(db, { fromAccountId: account })).id).toBe('handover');
    raw.exec("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES('target','Target','target-channel','token','secret')");
    expect((await linkHandover(db, { code: 'code', toAccountId: 'target', providerMatch: 'same' })).ok).toBe(true);
  });
  it('PKG30: 同じ引き継ぎコードを並行に使っても受け取り先は一つだけ', async () => {
    raw.exec("INSERT INTO account_handovers(id,from_account_id,code,code_expires_at,created_at) VALUES('handover','account','code','2099-10-08T06:00:00Z','2026-10-08T00:00:00Z')");
    raw.exec("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES('target-a','A','channel-a','token','secret'),('target-b','B','channel-b','token','secret')");
    const results = await Promise.all(['target-a','target-b'].map(toAccountId =>
      linkHandover(db, { code: 'code', toAccountId, providerMatch: 'same' })));
    expect(results.filter(result => result.ok)).toHaveLength(1);
  });

  it('PKG22: 200テンプレートの使用数を100bind以内で集計する', async () => {
    raw.exec("INSERT INTO templates(id,name,message_type,message_content) VALUES('template','Template','text','Text'); INSERT INTO messages_log(id,friend_id,direction,message_type,content,template_id_at_send) VALUES('message','friend','outgoing','text','Text','template')");
    const counts = await getTemplateSendCounts(db,['template',...Array.from({ length: 199 },(_,i)=>`missing${i}`)]);
    expect(counts.size).toBe(1); expect(counts.get('template')?.total).toBe(1);
  });
  it('PKG66: 97本のリマインダ参照の切替と情報欄の移行完了を同時に確定する', async () => {
    raw.exec("INSERT INTO friend_fields(id,name,field_key,type) VALUES('source-field','Source','source','date'),('target-field','Target','target','date')");
    const usageTargets = Array.from({ length: 97 },(_,i)=>({ kind: 'reminder' as const, id: `reminder${i}`, name: `Reminder${i}`, fieldId: 'source-field', switchable: true }));
    for (const target of usageTargets) raw.prepare("INSERT INTO reminders(id,name,line_account_id,trigger_type,trigger_field_id) VALUES(?,?,'account','friend_field','source-field')").run(target.id,target.name);
    await createFieldMigrationPreview(db,{ runId: 'migration', scope, sourceFieldId: 'source-field', targetFieldId: 'target-field', sourceVersion: 1, targetVersion: 1,
      previewTokenHash: 'hash', snapshotHash: 'hash', expiresAt: '2099-01-01', usageTargets, items: [], createdBy: 'staff' });
    await queueFieldMigration(db,'migration','key'); await executeFieldMigration(db,'migration','date','staff');
    expect(raw.prepare("SELECT status FROM field_migration_runs WHERE id='migration'").get()).toEqual({ status: 'succeeded' });
    expect(raw.prepare("SELECT COUNT(*) n FROM reminders WHERE trigger_field_id='target-field'").get()).toEqual({ n: 97 });
    expect(raw.prepare("SELECT status FROM friend_fields WHERE id='source-field'").get()).toEqual({ status: 'read_only' });
  });

  it('PKG20: 版の競合で拒否した接続点検を保存しない', async () => {
    raw.exec("UPDATE line_accounts SET revision=2 WHERE id='account'");
    await expect(saveLineAccountConnectionChecks(db, { lineAccountId: account, expectedRevision: 1, checkedBy: 'staff', checkedAt: '2026-10-08',
      correlationId: 'request', idempotencyKey: 'key', checks: [{ kind: 'bot_info', result: 'ok' }] })).rejects.toThrow();
    expect(raw.prepare('SELECT COUNT(*) n FROM line_account_connection_checks').get()).toEqual({ n: 0 });
  });
  it('PKG21: 公開の履歴保存失敗で本文・成功キーも戻し、同じ操作番号で回復する', async () => {
    const template = await createTemplate(db, { name: 'Template', messageType: 'text', messageContent: 'Published', lineAccountId: account });
    raw.exec("CREATE TRIGGER fail_template_history BEFORE INSERT ON template_versions BEGIN SELECT RAISE(ABORT,'storage unavailable'); END");
    await expect(publishTemplate(db,template.id,{ idempotencyKey: 'publish' })).rejects.toThrow();
    expect(raw.prepare('SELECT published_version FROM templates WHERE id=?').get(template.id)).toEqual({ published_version: 0 });
    expect(raw.prepare('SELECT COUNT(*) n FROM template_publish_keys').get()).toEqual({ n: 0 });
    raw.exec('DROP TRIGGER fail_template_history');
    await publishTemplate(db,template.id,{ idempotencyKey: 'publish' });
    await publishTemplate(db,template.id,{ idempotencyKey: 'publish' });
    expect(raw.prepare('SELECT version_number,message_content FROM template_versions WHERE template_id=?').all(template.id))
      .toEqual([{ version_number: 1, message_content: 'Published' }]);
  });

  it('PKG21: 過去の欠落した固定版を現在の追加設定から推測して作らない', async () => {
    const template = await createTemplate(db,{name:'Missing',messageType:'text',messageContent:'Original'});
    await publishTemplate(db,template.id,{expectedVersion:0,idempotencyKey:'legacy'});
    raw.prepare('DELETE FROM template_versions WHERE template_id=?').run(template.id);
    await expect(publishTemplate(db,template.id,{idempotencyKey:'legacy'})).rejects.toThrow('TEMPLATE_VERSION_HISTORY_MISSING');
    expect(raw.prepare('SELECT COUNT(*) n FROM template_versions WHERE template_id=?').get(template.id)).toEqual({n:0});
  });

});
