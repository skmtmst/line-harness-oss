import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { createTestD1, type SqliteD1 } from '../../test-utils/d1-sqlite.js';
import { processQueuedBroadcasts, processBroadcastSend, guardScheduledBroadcastQuota } from './broadcast.js';
import { getBroadcastAudiencePreview } from './broadcast-audience-preview.js';
import { fetchQuota } from './broadcast-quota-guard.js';
import { getBroadcastById } from '@line-crm/db';

const transport = vi.hoisted(() => ({
  send: vi.fn(async (_target: string | string[]) => ({ requestId: 'isolated-transport' })),
}));
vi.mock('@line-crm/line-sdk', async original => ({
  ...await original<Record<string, unknown>>(),
  LineClient: class {
    pushMessageWithRequestId = transport.send;
    multicast = transport.send;
    broadcast = transport.send;
  },
}));
vi.mock('./broadcast-quota-guard.js', async original => ({
  ...await original<Record<string, unknown>>(),
  fetchQuota: vi.fn(async () => ({ limit: 1, used: 0 })),
}));
vi.mock('../../services/send-entitlements.js', async original => ({
  ...await original<Record<string, unknown>>(),
  getSendPermissionForAccount: vi.fn(async () => ({ allowed: true })),
}));

let fixture: SqliteD1;
let claimBatchCompleted: boolean;
let stopAfterClaims: boolean;
const eitherAccount = {
  operator: 'OR',
  rules: ['allowed', 'outside'].map(text => ({ type: 'name', value: { text, targets: ['display'] } })),
};

beforeEach(() => {
  fixture = createTestD1();
  fixture.raw.prepare('INSERT OR IGNORE INTO tenants(id,name) VALUES (?,?)').run('other-tenant', 'Other');
  for (const [id, tenant] of [['own', DEFAULT_TENANT_ID], ['other', 'other-tenant']]) {
    fixture.raw.prepare(`INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id)
      VALUES (?,?,?,'unused','unused',?)`).run(id, id, id, tenant);
  }
  for (const [id, account, name] of [['own-friend', 'own', 'allowed'], ['other-friend', 'other', 'outside']]) {
    fixture.raw.prepare(`INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following)
      VALUES (?,?,?,?,1)`).run(id, 'U' + id, name, account);
  }
  fixture.raw.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,
    line_account_id,segment_conditions,batch_offset,track_links)
    VALUES ('scope-check','Scope check','text','Hello','segment','sending','own',?,0,0)`)
    .run(JSON.stringify(eitherAccount));
  claimBatchCompleted = false;
  stopAfterClaims = true;
  const batch = fixture.db.batch.bind(fixture.db);
  vi.spyOn(fixture.db, 'batch').mockImplementation(async statements => {
    const result = await batch(statements);
    if (statements.some(statement => /INSERT INTO broadcast_send_claims/.test((statement as unknown as { sql: string }).sql))) {
      claimBatchCompleted = true;
      // The real target INSERT has committed. Stop before any downstream dispatch or claim cleanup.
      if (stopAfterClaims) throw new Error('Stop after freezing the isolated SQLite audience');
    }
    return result;
  });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('External network is forbidden'); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); fixture.raw.close(); });

it('OR条件でも他統括の友だちを送信対象の台帳へ固定しない', async () => {
  await processQueuedBroadcasts(fixture.db, { multicast: transport.send, pushMessageWithRequestId: transport.send, broadcast: transport.send } as never);
  expect(claimBatchCompleted).toBe(true);
  const rows = fixture.raw.prepare(`SELECT friend_id,line_account_id,state FROM broadcast_send_claims
    WHERE broadcast_id='scope-check' ORDER BY friend_id`).all();
  expect(transport.send).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  console.info(JSON.stringify({ isolatedClaims: rows, externalCalls: transport.send.mock.calls.length }));
  expect(rows).toEqual([{ friend_id: 'own-friend', line_account_id: 'own', state: 'claimed' }]);
  expect(fixture.raw.prepare("SELECT total_count FROM broadcasts WHERE id='scope-check'").get()).toEqual({ total_count: 1 });
  expect(transport.send).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  { account: 'own', personalized: false },
  { account: 'own', personalized: true },
  { account: null, personalized: false },
  { account: null, personalized: true },
])('後段のdispatchでも他統括へ送ろうとしない: %j', async ({ account, personalized }) => {
  stopAfterClaims = false;
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id=?,message_content=? WHERE id='scope-check'")
    .run(account, personalized ? '{{name}} さん' : 'Hello');
  await processQueuedBroadcasts(fixture.db, { multicast: transport.send, pushMessageWithRequestId: transport.send, broadcast: transport.send } as never);
  expect(claimBatchCompleted).toBe(true);
  const attempted = transport.send.mock.calls.flatMap(([ids]) => Array.isArray(ids) ? ids : [ids]);
  const claims = fixture.raw.prepare(`SELECT friend_id,line_account_id,state,error_code FROM broadcast_send_claims
    WHERE broadcast_id='scope-check' ORDER BY friend_id`).all();
  console.info(JSON.stringify({ account, personalized, isolatedClaims: claims, attempted, externalCalls: vi.mocked(fetch).mock.calls.length }));
  expect(attempted).toEqual(['Uown-friend']);
  expect(claims).toEqual([{ friend_id: 'own-friend', line_account_id: account, state: 'sent', error_code: null }]);
});

it.each(['own', null])('緊急停止前の人数も所属範囲だけを数える: %s', async account => {
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id=? WHERE id='scope-check'").run(account);
  const row = await getBroadcastById(fixture.db, 'scope-check');
  expect(row).not.toBeNull();
  expect(await getBroadcastAudiencePreview(fixture.db, row!)).toEqual({ count: 1 });
});

it.each([
  { account: 'own', personalized: false }, { account: 'own', personalized: true },
  { account: null, personalized: false }, { account: null, personalized: true },
])('保存済み条件からキューへ入れる時も所属外の人数/名前を混ぜない: %j', async ({ account, personalized }) => {
  fixture.raw.prepare("UPDATE broadcasts SET status='draft',line_account_id=?,message_content=? WHERE id='scope-check'")
    .run(account, personalized ? '{{name}} さん' : 'Hello');
  const result = await processBroadcastSend(fixture.db, {
    multicast: transport.send, pushMessageWithRequestId: transport.send, broadcast: transport.send,
  } as never, 'scope-check');
  expect(result).toMatchObject({ status: 'sending', total_count: 1 });
  expect(transport.send).not.toHaveBeenCalled();
});

it('予約前の残枠の計算も他統括を混ぜない', async () => {
  const row = await getBroadcastById(fixture.db, 'scope-check');
  expect(await guardScheduledBroadcastQuota(fixture.db, row!, 'own')).toEqual({ blocked: false });
});

it('他統括の名前なしをORで拾っても、自分の差込配信を止めない', async () => {
  fixture.raw.prepare("UPDATE friends SET display_name=NULL WHERE id='other-friend'").run();
  fixture.raw.prepare("UPDATE broadcasts SET status='draft',message_content='{{name}} さん',segment_conditions=? WHERE id='scope-check'")
    .run(JSON.stringify({ operator: 'OR', rules: [{ type: 'name', value: { text: 'allowed', targets: ['display'] } }, { type: 'tag_not_exists', value: 'none' }] }));
  const result = await processBroadcastSend(fixture.db, {
    multicast: transport.send, pushMessageWithRequestId: transport.send, broadcast: transport.send,
  } as never, 'scope-check');
  expect(result).toMatchObject({ status: 'sending', total_count: 1 });
  expect(transport.send).not.toHaveBeenCalled();
});

it.each([
  { account: 'own', state: 'claimed', code: null }, { account: null, state: 'claimed', code: null },
  { account: 'own', state: 'failed', code: 'line_http_429' }, { account: null, state: 'failed', code: 'line_http_429' },
  { account: 'own', state: 'failed', code: 'stopped_before_dispatch' }, { account: null, state: 'failed', code: 'stopped_before_dispatch' },
])('既存の宛先と再試行も所属を越えて送らない: %j', async ({ account, state, code }) => {
  stopAfterClaims = false;
  fixture.raw.prepare("UPDATE broadcasts SET line_account_id=? WHERE id='scope-check'").run(account);
  for (const friend of ['own-friend', 'other-friend']) {
    fixture.raw.prepare(`INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,attempt_no,state,error_code)
      VALUES ('scope-check',?,?,1,?,?)`).run(friend, account, state, code);
  }
  await processQueuedBroadcasts(fixture.db, {
    multicast: transport.send, pushMessageWithRequestId: transport.send, broadcast: transport.send,
  } as never);
  expect(transport.send.mock.calls.flatMap(([ids]) => Array.isArray(ids) ? ids : [ids])).toEqual(['Uown-friend']);
  expect(fixture.raw.prepare("SELECT state,error_code FROM broadcast_send_claims WHERE friend_id='other-friend'").get())
    .toEqual({ state: 'failed', error_code: 'recipient_unavailable' });
});

it('ORでもブロック/非表示を最初の宛先へ固定しない', async () => {
  for (const [id, following, hidden] of [['blocked', 0, 0], ['hidden', 1, 1]]) {
    fixture.raw.prepare(`INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following,is_hidden)
      VALUES (?,?,?,'own',?,?)`).run(id, 'U' + id, 'outside', following, hidden);
  }
  await processQueuedBroadcasts(fixture.db, {
    multicast: transport.send, pushMessageWithRequestId: transport.send, broadcast: transport.send,
  } as never);
  expect(claimBatchCompleted).toBe(true);
  expect(fixture.raw.prepare("SELECT friend_id FROM broadcast_send_claims WHERE broadcast_id='scope-check' ORDER BY friend_id").all())
    .toEqual([{ friend_id: 'own-friend' }]);
  expect(transport.send).not.toHaveBeenCalled();
});

it('予約枠の計算で配信同意が撤回済みの相手をORから復活させない', async () => {
  fixture.raw.prepare(`INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source)
    VALUES ('own','own-friend','marketing','revoked','本人希望','manual')`).run();
  const row = await getBroadcastById(fixture.db, 'scope-check');
  expect(await guardScheduledBroadcastQuota(fixture.db, row!, 'own')).toEqual({ blocked: false });
  expect(fetchQuota).not.toHaveBeenCalled();
});

it('条件SQLの形が変わって入力集合を限定できなければ宛先を作らず送らない', async () => {
  vi.spyOn(await import('./broadcast-audience-query.js'), 'buildBroadcastAudienceQuery')
    .mockReturnValue({ sql: 'SELECT f.id, f.line_user_id, f.display_name FROM friends AS f WHERE 1=1', bindings: [] });
  await processQueuedBroadcasts(fixture.db, {
    multicast: transport.send, pushMessageWithRequestId: transport.send, broadcast: transport.send,
  } as never);
  expect(claimBatchCompleted).toBe(false);
  expect(fixture.raw.prepare("SELECT COUNT(*) AS n FROM broadcast_send_claims").get()).toEqual({ n: 0 });
  expect(transport.send).not.toHaveBeenCalled();
});

it('再確認の直後に古い宛先の所属が変わっても、pendingの取得自身が拒む', async () => {
  stopAfterClaims = false;
  fixture.raw.prepare(`INSERT INTO friends(id,line_user_id,display_name,line_account_id)
    VALUES ('moving-friend','Umoving-friend','moving','own')`).run();
  for (const friend of ['own-friend', 'moving-friend']) {
    fixture.raw.prepare(`INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,attempt_no,state)
      VALUES ('scope-check',?,'own',1,'claimed')`).run(friend);
  }
  let moved = false;
  const prepare = fixture.db.prepare.bind(fixture.db);
  vi.spyOn(fixture.db, 'prepare').mockImplementation(sql => {
    if (!moved && sql.includes('FROM broadcast_send_claims c JOIN')) {
      // Account migration after the UPDATE, before the pending SELECT reaches SQLite.
      fixture.raw.prepare("UPDATE friends SET line_account_id='other' WHERE id='moving-friend'").run();
      moved = true;
    }
    return prepare(sql);
  });
  await processQueuedBroadcasts(fixture.db, {
    multicast: transport.send, pushMessageWithRequestId: transport.send, broadcast: transport.send,
  } as never);
  expect(moved).toBe(true);
  expect(transport.send.mock.calls.flatMap(([ids]) => Array.isArray(ids) ? ids : [ids])).toEqual(['Uown-friend']);
});
