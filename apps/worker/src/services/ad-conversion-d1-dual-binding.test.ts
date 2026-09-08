/**
 * 独立した2つのD1接続での送信権の競合試験。
 * miniflareを2台、同じ永続化先で起動し、本番の claimAdConversionSend を
 * 別プロセス相当の独立接続から同時に呼ぶ。片方の確保がもう片方に見え、
 * 同じ冪等キーの同時claimは1件だけが送ることを、本物のD1実装で確かめる。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { claimAdConversionSend, finishAdConversionSend } from '@line-crm/db';

const here = dirname(fileURLToPath(import.meta.url));
const bootstrapRaw = readFileSync(resolve(here, '../../../../packages/db/bootstrap.sql'), 'utf8');
const bootstrapSql = bootstrapRaw
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

type RealD1 = Awaited<ReturnType<Miniflare['getD1Database']>>;

let dir: string;
let mfA: Miniflare;
let mfB: Miniflare;
let dbA: RealD1;
let dbB: RealD1;

async function applySchema(db: RealD1): Promise<void> {
  const statements = bootstrapSql
    .split('\n')
    .reduce<string[]>((acc, line) => {
      const last = acc[acc.length - 1] ?? '';
      acc[acc.length - 1] = last ? `${last}\n${line}` : line;
      if (line.trimEnd().endsWith(';')) acc.push('');
      return acc;
    }, [''])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50).map((s) => db.prepare(s)));
  }
}

describe('独立2接続の送信権競合', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'd1-dual-'));
    mfA = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response("a"); } }`,
      d1Databases: ['DB'],
      d1Persist: join(dir, 'a'),
    });
    mfB = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response("b"); } }`,
      d1Databases: ['DB'],
      d1Persist: join(dir, 'a'),
    });
    dbA = await mfA.getD1Database('DB');
    dbB = await mfB.getD1Database('DB');
    await applySchema(dbA);
    await dbA.batch([
      dbA.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES ('a1', 'ch-a1', 'A1', 't', 's')`),
      dbA.prepare(`INSERT INTO ad_platforms (id, name, config, line_account_id) VALUES ('px', 'x', '{}', 'a1')`),
      dbA.prepare(`INSERT INTO friends (id, line_user_id, line_account_id) VALUES ('f1', 'U1', 'a1')`),
    ]);
  }, 180000);

  afterAll(async () => {
    await mfA.dispose();
    await mfB.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it('別接続の確保が見え、同時claimは1件だけ送る', async () => {
    const base = {
      platformId: 'px',
      friendId: 'f1',
      eventName: 'Purchase',
      clickId: 'tw-1',
      clickIdType: 'twclid',
      eventValue: 1000,
      idempotencyKey: 'evt-dual',
    };
    // Aの確保がBから見える(同じDBの独立接続である証拠)。
    const first = await claimAdConversionSend(dbA, base);
    expect(first.disposition).toBe('send');
    const seen = await dbB
      .prepare(`SELECT lease_token FROM ad_conversion_logs WHERE idempotency_key = 'evt-dual'`)
      .first<{ lease_token: string | null }>();
    expect(seen?.lease_token).toBe(first.lease);

    // 古くして両側から同時に取り直す。勝ちは1件だけ。
    await dbA
      .prepare(`UPDATE ad_conversion_logs SET created_at = '2026-09-01T00:00:00+09:00' WHERE idempotency_key = 'evt-dual'`)
      .run();
    const [fromA, fromB] = await Promise.all([
      claimAdConversionSend(dbA, base),
      claimAdConversionSend(dbB, base),
    ]);
    const dispositions = [fromA.disposition, fromB.disposition].sort();
    expect(dispositions).toEqual(['send', 'skip-inflight']);
    const winner = fromA.disposition === 'send' ? fromA : fromB;
    expect(winner.providerEventId).toBe('evt-dual:px');

    // 勝った証だけ確定が通る。
    await finishAdConversionSend(dbB, {
      platformId: 'px',
      friendId: 'f1',
      eventName: 'Purchase',
      idempotencyKey: 'evt-dual',
      lease: winner.lease ?? 'missing',
      status: 'sent',
    });
    const row = await dbA
      .prepare(`SELECT status FROM ad_conversion_logs WHERE idempotency_key = 'evt-dual'`)
      .first<{ status: string }>();
    expect(row?.status).toBe('sent');
  });
}, 180000);
