import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { incomingWebhookFencedDb } from './incoming-webhook-fenced-db.js';

let mf: Miniflare;
let native: Awaited<ReturnType<Miniflare['getD1Database']>>;

beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', d1Databases: ['DB'] });
  native = await mf.getD1Database('DB');
  await native.prepare('CREATE TABLE incoming_webhooks (id TEXT PRIMARY KEY)').run();
  const migration = readFileSync(new URL('../../../../packages/db/migrations/384_incoming_webhook_receipts.sql', import.meta.url), 'utf8')
    .split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n');
  for (const sql of migration.split(';').map(sql => sql.trim()).filter(Boolean)) await native.prepare(sql).run();
  await native.batch([
    native.prepare('CREATE TABLE fence_effects (id TEXT PRIMARY KEY, value TEXT NOT NULL)'),
    native.prepare("INSERT INTO incoming_webhooks (id) VALUES ('wh')"),
    native.prepare(`INSERT INTO incoming_webhook_receipts
      (webhook_id,signature_hash,source_event_id,status,lease_owner,lease_expires_at,attempt_count)
      VALUES ('wh','hash','event','processing','owner',4102444800000,1)`),
    native.prepare("INSERT INTO fence_effects (id,value) VALUES ('row','initial')"),
  ]);
}, 30000);
afterAll(async () => { await mf?.dispose(); });
beforeEach(async () => {
  await native.batch([
    native.prepare("UPDATE incoming_webhook_receipts SET status='processing',lease_owner='owner',attempt_count=1,lease_expires_at=4102444800000"),
    native.prepare('DELETE FROM fence_effects'),
    native.prepare("INSERT INTO fence_effects (id,value) VALUES ('row','initial')"),
  ]);
});

const fence = { sourceEventId: 'event', owner: 'owner', generation: 1 };
const mutations = [
  "UPDATE fence_effects SET value='bypass' WHERE id='row'",
  "DELETE FROM fence_effects WHERE id='row'",
  "REPLACE INTO fence_effects (id,value) VALUES ('row','bypass')",
];

it('独立再現: SELECT後続UPDATEをallで渡しても旧所有者の副作用は0になる', async () => {
  const fenced = incomingWebhookFencedDb(native, fence);
  await native.prepare("UPDATE incoming_webhook_receipts SET lease_owner='next',attempt_count=2,lease_expires_at=0").run();
  try {
    await fenced.prepare("SELECT 1; UPDATE fence_effects SET value='bypass' WHERE id='row'").all();
  } catch {
    // Rejection may be synchronous or asynchronous; the persisted effect is the invariant.
  }
  expect(await native.prepare("SELECT value FROM fence_effects WHERE id='row'").first('value')).toBe('initial');
});

it.each(['all', 'first'] as const)('実D1の%sでSELECT後続の変更文をコメントや空白があっても拒否する', async api => {
  const fenced = incomingWebhookFencedDb(native, fence);
  for (const owner of ['owner', 'reclaimed']) {
    await native.prepare('UPDATE incoming_webhook_receipts SET lease_owner=?').bind(owner).run();
    for (const mutation of mutations) {
      for (const sql of [
        `SELECT 1; ${mutation}`,
        ` \n /* leading ; */ SELECT ';' AS value; -- boundary ;\n ${mutation};`,
        `SELECT 'it''s;safe'; /* boundary */ ${mutation}`,
        `SELECT 1;\t\r\n${mutation}`,
      ]) {
        expect(() => fenced.prepare(sql)[api]()).toThrow('incoming_receipt_unsupported_sql');
        expect(await native.prepare('SELECT * FROM fence_effects').all()).toMatchObject({ results: [{ id: 'row', value: 'initial' }] });
      }
    }
  }
});

it.each(['all', 'first'] as const)('実D1の%sで引用符やコメント内のセミコロンと単一SELECTを許可する', async api => {
  const fenced = incomingWebhookFencedDb(native, fence);
  for (const sql of [
    "SELECT 'it''s;safe' AS value",
    " \t\r\n/* leading ; */ SELECT 'it''s;safe' AS value; -- trailing ;\n /* ; */ ",
    "SELECT 'it''s;safe' AS \"value\" /* ; UPDATE fence_effects */;",
    "SELECT 'it''s;safe' AS `value`;",
    "SELECT 'it''s;safe' AS [value];",
    "SELECT 'it''s;safe' AS value -- ; DELETE FROM fence_effects\n;",
  ]) {
    const result = await fenced.prepare(sql)[api]();
    expect(api === 'all' ? (result as D1Result).results : [result]).toEqual([{ value: "it's;safe" }]);
  }
  expect(await fenced.prepare('SELECT 1 AS "a;""b", 2 AS `c;``d`, 3 AS [e;f];').first())
    .toEqual({ 'a;"b': 1, 'c;`d': 2, 'e;f': 3 });
});

it.each(['all', 'first'] as const)('実D1の%sでWITH・判定不能SQL・変更RETURNINGをfail closedにする', async api => {
  const fenced = incomingWebhookFencedDb(native, fence);
  for (const sql of [
    'WITH selected AS (SELECT 1) SELECT * FROM selected',
    "WITH selected AS (SELECT 1) UPDATE fence_effects SET value='bypass'",
    'WITH RECURSIVE selected(n) AS (SELECT 1) DELETE FROM fence_effects',
    "WITH selected AS (SELECT 1) REPLACE INTO fence_effects VALUES ('row','bypass')",
    'PRAGMA user_version=99', 'EXPLAIN SELECT 1', '', '/* comment only */',
    "SELECT 'unterminated;", 'SELECT "unterminated;', 'SELECT `unterminated;', 'SELECT [unterminated;',
    'SELECT 1 /* unterminated', 'SELECT 1;;', 'SELECT 1; SELECT 2', 'SELECT 1\0',
  ]) expect(() => fenced.prepare(sql)[api]()).toThrow('incoming_receipt_unsupported_sql');
  for (const mutation of mutations) {
    expect(() => fenced.prepare(`${mutation} RETURNING *`)[api]()).toThrow('incoming_receipt_unsupported_statement_api');
  }
  expect((await native.prepare('SELECT * FROM fence_effects').all()).results).toEqual([{ id: 'row', value: 'initial' }]);
});

it('実D1でコメント付き変更は同一batchの所有権確認を通り、SELECT後続文はrun/batchでも拒否する', async () => {
  const fenced = incomingWebhookFencedDb(native, fence);
  await fenced.prepare("/* ; */ UPDATE fence_effects SET value='valid;value' WHERE id='row'; -- ;").run();
  expect(await native.prepare("SELECT value FROM fence_effects WHERE id='row'").first('value')).toBe('valid;value');
  await native.prepare("UPDATE incoming_webhook_receipts SET lease_owner='reclaimed'").run();
  await expect(fenced.prepare("-- comment\n UPDATE fence_effects SET value='bypass' WHERE id='row'").run()).rejects.toThrow();
  expect(() => fenced.prepare("SELECT 1; UPDATE fence_effects SET value='bypass'").run()).toThrow('incoming_receipt_unsupported_sql');
  expect(() => fenced.batch([fenced.prepare("SELECT 1; DELETE FROM fence_effects")])).toThrow('incoming_receipt_unsupported_sql');
  expect(await native.prepare("SELECT value FROM fence_effects WHERE id='row'").first('value')).toBe('valid;value');
});

it('実D1でowner/世代/期限が違うbatchは副作用0、後続文の例外も先行変更をrollbackする', async () => {
  const fenced = incomingWebhookFencedDb(native, { sourceEventId: 'event', owner: 'owner', generation: 1 });
  expect((await fenced.prepare("UPDATE fence_effects SET value='last' WHERE id='row'").run()).meta.changes).toBe(1);
  await expect(fenced.batch([
    fenced.prepare("UPDATE fence_effects SET value='first' WHERE id='row'"),
    fenced.prepare("INSERT INTO fence_effects (id,value) VALUES ('row','duplicate')"),
  ])).rejects.toThrow();
  expect(await native.prepare("SELECT value FROM fence_effects WHERE id='row'").first()).toEqual({ value: 'last' });

  for (const change of ["lease_owner='new'", 'attempt_count=2', 'lease_expires_at=0']) {
    await native.prepare(`UPDATE incoming_webhook_receipts SET lease_owner='owner',attempt_count=1,lease_expires_at=4102444800000`).run();
    await native.prepare(`UPDATE incoming_webhook_receipts SET ${change}`).run();
    await expect(fenced.batch([
      fenced.prepare("UPDATE fence_effects SET value='first' WHERE id='row'"),
      fenced.prepare("INSERT INTO fence_effects (id,value) VALUES ('stale','bad')"),
    ])).rejects.toThrow(/malformed JSON/);
    expect((await native.prepare('SELECT * FROM fence_effects').all()).results).toEqual([{ id: 'row', value: 'last' }]);
  }
}, 30000);

it('実D1でbind後かつbatch開始直前に所有権が変わっても同じtransactionの検査で拒否する', async () => {
  // Interpose only the scheduling boundary; every SQL statement and transaction
  // still executes in real D1 (Miniflare's remote object cannot be spied on).
  const racingDb = {
    prepare: native.prepare.bind(native),
    async batch(statements: D1PreparedStatement[]) {
      await native.prepare("UPDATE incoming_webhook_receipts SET lease_owner='next',attempt_count=2").run();
      return native.batch(statements);
    },
  } as D1Database;
  const fenced = incomingWebhookFencedDb(racingDb, fence);
  const prepared = fenced.prepare('UPDATE fence_effects SET value=? WHERE id=?').bind('bypass', 'row');
  await expect(prepared.run()).rejects.toThrow();
  expect(await native.prepare("SELECT value FROM fence_effects WHERE id='row'").first('value')).toBe('initial');
});
