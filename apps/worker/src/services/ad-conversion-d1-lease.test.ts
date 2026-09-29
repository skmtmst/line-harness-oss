/**
 * 実D1(miniflareのローカルD1・workerd実装)での送信権の競合試験。
 * better-sqlite3の自作shimではなく、本物のD1Database実装に対して
 * 本番の claimAdConversionSend / finishAdConversionSend を直接呼ぶ。
 * - 同じ冪等キーの同時claimは1件だけが送る
 * - lease切れのtakeoverは保存済みのprovider_event_idを維持する
 * - 古い持ち主の確定は拒否する
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import {
  AdConversionLeaseError,
  claimAdConversionSend,
  finishAdConversionSend,
} from '@line-crm/db';

const here = dirname(fileURLToPath(import.meta.url));
const bootstrapRaw = readFileSync(resolve(here, '../../../../packages/db/bootstrap.sql'), 'utf8');
// D1のexecは注釈だけの断片で止まるため、行注釈を落としてから流す(DDL本体は無加工)。
const bootstrapSql = bootstrapRaw
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

type RealD1 = Awaited<ReturnType<Miniflare['getD1Database']>>;

let mf: Miniflare;
let db: RealD1;

const claimBase = {
  platformId: 'px',
  friendId: 'f1',
  eventName: 'Purchase',
  clickId: 'tw-1',
  clickIdType: 'twclid',
  eventValue: 1000,
};

async function readLog(key: string) {
  return db
    .prepare(
      `SELECT status, lease_token, provider_event_id, created_at FROM ad_conversion_logs WHERE idempotency_key = ?`,
    )
    .bind(key)
    .first<{ status: string; lease_token: string | null; provider_event_id: string | null; created_at: string }>();
}

describe('実D1の送信権競合', () => {
  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: `export default { async fetch() { return new Response("ok"); } }`,
      d1Databases: ['DB'],
    });
    db = await mf.getD1Database('DB');
    // bootstrapは全886文が「行末;」で終わる形に正規化されているため、
    // 行末;で文分割してbatchで流す(exec一括はD1側の分割と相性が悪い)。
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
    await db.batch([
      db.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret) VALUES ('a1', 'ch-a1', 'A1', 't', 's')`),
      db.prepare(`INSERT INTO ad_platforms (id, name, config, line_account_id) VALUES ('px', 'x', '{}', 'a1')`),
      db.prepare(`INSERT INTO friends (id, line_user_id, line_account_id) VALUES ('f1', 'U1', 'a1')`),
    ]);
  }, 120000);

  afterAll(async () => {
    await mf.dispose();
  });

  it('同じ冪等キーの同時claimは1件だけ送り、安定IDは一致する', async () => {
    const [first, second] = await Promise.all([
      claimAdConversionSend(db, { ...claimBase, idempotencyKey: 'evt-simu' }),
      claimAdConversionSend(db, { ...claimBase, idempotencyKey: 'evt-simu' }),
    ]);
    const dispositions = [first.disposition, second.disposition].sort();
    expect(dispositions).toEqual(['send', 'skip-inflight']);
    const winner = first.disposition === 'send' ? first : second;
    expect(winner.lease).toBeTruthy();
    // 負けた側も保存済みの安定IDを受け取り、再送時に同じIDを使える。
    expect(first.providerEventId).toBe('evt-simu:px');
    expect(second.providerEventId).toBe(first.providerEventId);
    const row = await readLog('evt-simu');
    expect(row?.status).toBe('pending');
    expect(row?.lease_token).toBe(winner.lease);
  });

  it('lease切れtakeoverは保存IDを維持し、旧持ち主の確定は拒否する', async () => {
    const first = await claimAdConversionSend(db, { ...claimBase, idempotencyKey: 'evt-take' });
    expect(first.disposition).toBe('send');
    expect(first.providerEventId).toBe('evt-take:px');

    // 持ち主が落ちた想定で確保時刻を古くする。
    await db
      .prepare(`UPDATE ad_conversion_logs SET created_at = '2026-09-01T00:00:00+09:00' WHERE idempotency_key = 'evt-take'`)
      .run();

    // 別の安定IDを渡しても、保存済みを使い続ける。
    const takeover = await claimAdConversionSend(db, {
      ...claimBase,
      idempotencyKey: 'evt-take',
      providerEventId: 'prov-evil',
    });
    expect(takeover.disposition).toBe('send');
    expect(takeover.lease).toBeTruthy();
    expect(takeover.lease).not.toBe(first.lease);
    expect(takeover.providerEventId).toBe('evt-take:px');

    // 旧持ち主の確定は通らない。
    await expect(
      finishAdConversionSend(db, {
        platformId: 'px',
        friendId: 'f1',
        eventName: 'Purchase',
        idempotencyKey: 'evt-take',
        lease: first.lease ?? 'missing',
        status: 'sent',
      }),
    ).rejects.toBeInstanceOf(AdConversionLeaseError);

    // 新持ち主の確定は通る。
    await finishAdConversionSend(db, {
      platformId: 'px',
      friendId: 'f1',
      eventName: 'Purchase',
      idempotencyKey: 'evt-take',
      lease: takeover.lease ?? 'missing',
      status: 'sent',
    });
    const row = await readLog('evt-take');
    expect(row?.status).toBe('sent');
    expect(row?.provider_event_id).toBe('evt-take:px');
    expect(row?.lease_token).toBe(takeover.lease);
  });
}, 120000);
