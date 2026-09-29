import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { incomingWebhookFencedDb } from './incoming-webhook-fenced-db.js';

let mf: Miniflare;
let db: Awaited<ReturnType<Miniflare['getD1Database']>>;
const owner = { sourceEventId: 'source', owner: 'lease', generation: 7 };
beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['DB'] });
  db = await mf.getD1Database('DB');
  await db.batch([
    db.prepare('CREATE TABLE incoming_webhook_receipts (source_event_id TEXT PRIMARY KEY, lease_owner TEXT, attempt_count INTEGER, status TEXT, lease_expires_at INTEGER)'),
    db.prepare('CREATE TABLE effects (id TEXT PRIMARY KEY, value TEXT)'),
  ]);
}, 30000);
afterAll(async () => { await mf?.dispose(); });
beforeEach(async () => {
  await db.batch([
    db.prepare('DELETE FROM incoming_webhook_receipts'), db.prepare('DELETE FROM effects'),
    db.prepare("INSERT INTO incoming_webhook_receipts VALUES ('source','lease',7,'processing',4102444800000)"),
    db.prepare("INSERT INTO effects VALUES ('original','safe')"),
  ]);
});

it('independent: positive single CRUD and binding / comments / quoted delimiters', async () => {
  const f = incomingWebhookFencedDb(db, owner);
  await f.prepare("/* pre; */ INSERT INTO effects VALUES (?,?); -- tail;").bind('new', "it's;--/*safe*/").run();
  await f.prepare('UPDATE effects SET value=? WHERE id=? /* ; */;').bind('changed;', 'new').run();
  expect(await f.prepare('SELECT value FROM effects WHERE id=?; /* tail */').bind('new').first('value')).toBe('changed;');
  await f.prepare("DELETE FROM effects WHERE id='new'; -- tail").run();
  expect((await f.prepare('SELECT * FROM effects;').all()).results).toEqual([{ id: 'original', value: 'safe' }]);
  for (const sql of ["SELECT 'a;''b' AS result", 'SELECT 1 AS [a;b]', 'SELECT 1 AS `a;``b`', 'SELECT 1 AS "a;""b"', '/* -- ; */ SELECT 1 AS x -- comment ;\n']) {
    expect((await f.prepare(sql).all()).results).toEqual((await db.prepare(sql).all()).results);
  }
});

it('independent: no owner/status/source/attempt/lease bypass for run and batch', async () => {
  for (const change of ["lease_owner='other'", 'attempt_count=8', 'lease_expires_at=0', 'lease_expires_at=NULL', "status='completed'", "source_event_id='different'"]) {
    await db.prepare("UPDATE incoming_webhook_receipts SET source_event_id='source', lease_owner='lease',attempt_count=7,status='processing',lease_expires_at=4102444800000").run();
    const f = incomingWebhookFencedDb(db, owner);
    await db.prepare(`UPDATE incoming_webhook_receipts SET ${change}`).run();
    await expect(f.prepare("INSERT INTO effects VALUES ('bad','bad')").run()).rejects.toThrow();
    await expect(f.batch([f.prepare("UPDATE effects SET value='bad'"), f.prepare("DELETE FROM effects")])).rejects.toThrow();
    expect((await db.prepare('SELECT * FROM effects').all()).results).toEqual([{ id: 'original', value: 'safe' }]);
  }
});

it('independent: all/first never allow mutations including mixed-case INSERT RETURNING', async () => {
  const f = incomingWebhookFencedDb(db, owner);
  for (const api of ['all', 'first'] as const) {
    for (const sql of ["iNsErT INTO effects VALUES ('bad','bad') RETURNING *", "DELETE FROM effects RETURNING *", "REPLACE INTO effects VALUES ('original','bad') RETURNING *"]) {
      expect(() => f.prepare(sql)[api]()).toThrow('unsupported_statement_api');
    }
    for (const sql of ["SELECT 1;/*skip*/INSERT INTO effects VALUES ('bad','bad')", "SELECT `x;y` FROM effects; DELETE FROM effects", 'SELECT 1\0; DELETE FROM effects', 'WITH q AS (SELECT 1) SELECT * FROM q', 'PRAGMA user_version', 'EXPLAIN SELECT 1', 'SELECT 1; /* unclosed', 'SELECT "unclosed']) {
      expect(() => f.prepare(sql)[api]()).toThrow('unsupported_sql');
    }
  }
  expect((await db.prepare('SELECT * FROM effects').all()).results).toEqual([{ id: 'original', value: 'safe' }]);
});

it('independent: assertion and every effect must remain one native batch', async () => {
  const calls: number[] = [];
  const interposed = {
    prepare: db.prepare.bind(db),
    async batch(items: D1PreparedStatement[]) {
      calls.push(items.length);
      await db.prepare("UPDATE incoming_webhook_receipts SET attempt_count=8").run();
      return db.batch(items);
    },
  } as D1Database;
  const f = incomingWebhookFencedDb(interposed, owner);
  await expect(f.batch([f.prepare("UPDATE effects SET value='bad'"), f.prepare("INSERT INTO effects VALUES ('bad','bad')")])).rejects.toThrow();
  expect(calls).toEqual([3]);
  expect((await db.prepare('SELECT * FROM effects').all()).results).toEqual([{ id: 'original', value: 'safe' }]);
});

it('independent: line comments preserve SQLite CR semantics', async () => {
  const f = incomingWebhookFencedDb(db, owner);
  const sql = "SELECT 1 AS x -- ignored\r'; ignored to LF\n";
  expect((await f.prepare(sql).all()).results).toEqual((await db.prepare(sql).all()).results);
  // The second independent example has a comment after its terminal semicolon.
  // Native D1 rejects that empty tail; the validated wrapper intentionally strips
  // it. Compare with the retained statement, not native D1's invalid empty tail.
  const trailingComment = 'SELECT 1 AS x; -- ignored\r UPDATE effects SET value=2\n';
  await expect(db.prepare(trailingComment).all()).rejects.toThrow('SQL code did not contain a statement');
  expect((await f.prepare(trailingComment).all()).results).toEqual([{ x: 1 }]);
});

it.each(['all', 'first'] as const)('independent: CR comment quote confusion cannot bypass stale-owner fence through %s', async api => {
  const f = incomingWebhookFencedDb(db, owner);
  await db.prepare("UPDATE incoming_webhook_receipts SET lease_owner='reclaimed',attempt_count=8,lease_expires_at=0").run();
  // SQLite -- comments end at LF, not CR. A CR-ending scanner would read the
  // ignored quotes and could mistake the intervening second statement for text.
  const sql = "SELECT 1 AS x --\r'\n; UPDATE effects SET value=2; --\r'\n";
  try { await f.prepare(sql)[api](); } catch { /* rejection is allowed */ }
  expect((await db.prepare('SELECT * FROM effects').all()).results).toEqual([{ id: 'original', value: 'safe' }]);
});

const lineEndings = [
  { label: 'LF', text: '\n' }, { label: 'CR', text: '\r' }, { label: 'CRLF', text: '\r\n' },
];
const readCases = (['all', 'first'] as const).flatMap(api => lineEndings.map(ending => ({ api, ...ending })));

it.each(readCases)('実D1と分類器の行コメント規則が一致する: $api / $label', async ({ api, text }) => {
  const f = incomingWebhookFencedDb(db, owner);
  for (const sql of [
    // CR keeps the second column inside the comment; LF/CRLF expose it.
    `SELECT 1 AS x -- comment${text}, 2 AS y`,
    `SELECT 'a${text};--/*' AS value /* ${text}; */`,
    `SELECT 'a;''b' AS "quoted;${text}name" -- comment${text}`,
    "SELECT 1 AS x -- ignored\r'; UPDATE effects SET value='bad'; /* ignored to EOF",
    "SELECT 1 AS x -- ignored\r'; ignored to LF\n",
  ]) {
    const actual = await f.prepare(sql)[api]();
    const expected = await db.prepare(sql)[api]();
    expect(api === 'all' ? (actual as D1Result).results : actual)
      .toEqual(api === 'all' ? (expected as D1Result).results : expected);
  }
  const normalized = await f.prepare("SELECT 1 AS x; -- ignored\r UPDATE effects SET value=2\n")[api]();
  expect(api === 'all' ? (normalized as D1Result).results : [normalized]).toEqual([{ x: 1 }]);
  expect(await f.prepare(`SELECT 1 AS x -- comment${text}, 2 AS y`).first())
    .toEqual(text === '\r' ? { x: 1 } : { x: 1, y: 2 });
  expect((await db.prepare('SELECT * FROM effects').all()).results).toEqual([{ id: 'original', value: 'safe' }]);
});

it.each(readCases)('LFで実際に始まる第2文は改行種別によらず拒否する: $api / $label', async ({ api, text }) => {
  const f = incomingWebhookFencedDb(db, owner);
  await db.prepare("UPDATE incoming_webhook_receipts SET lease_owner='reclaimed'").run();
  for (const mutation of [
    "UPDATE effects SET value='bad'",
    'DELETE FROM effects',
    "REPLACE INTO effects VALUES ('original','bad')",
  ]) {
    for (const sql of [
      `SELECT 1 -- ignored${text}\n; ${mutation}`,
      `SELECT ';' -- ignored${text}\n; /* ; */ ${mutation};`,
      `SELECT 1 --\r'${text}\n; ${mutation}; --\r'\n`,
      `SELECT 1; -- ignored${text}\n ${mutation}`,
    ]) expect(() => f.prepare(sql)[api]()).toThrow('unsupported_sql');
  }
  expect((await db.prepare('SELECT * FROM effects').all()).results).toEqual([{ id: 'original', value: 'safe' }]);
});
