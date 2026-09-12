import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
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
