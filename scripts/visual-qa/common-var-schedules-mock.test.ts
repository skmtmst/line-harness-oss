/*
 * 共通情報の切り替え予約を撮るための口が、画面確認モックで本当に答えるかの試験。
 * モックを起動し、予約の一覧・登録・削除を実際に叩いて返事を見る。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { COMMON_VAR_DETAIL, COMMON_VAR_SCHEDULES } from './fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let mock: ChildProcess | null = null;
let origin = '';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  mock = spawn(process.execPath, [join(HERE, 'mock-api.mjs')], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('モックが起動しません')), 30_000);
    mock?.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('mock API on')) { clearTimeout(timer); resolve(); }
    });
    mock?.once('exit', (code) => { clearTimeout(timer); reject(new Error(`モックが止まりました（${code}）`)); });
  });
}, 40_000);

afterAll(() => {
  mock?.kill();
});

describe('画面確認モックの共通情報の予約口', () => {
  it('撮影用の共通情報には、固定の予約一覧を返す', async () => {
    const res = await fetch(`${origin}/api/common-vars/${COMMON_VAR_DETAIL.id}/schedules?accountId=account-1`);
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual(COMMON_VAR_SCHEDULES);
    expect(COMMON_VAR_SCHEDULES.length).toBeGreaterThan(0);
  });

  it('知らない共通情報の予約一覧は空で返す', async () => {
    const res = await fetch(`${origin}/api/common-vars/unknown-var/schedules?accountId=account-1`);
    expect(await res.json()).toMatchObject({ success: true, data: [] });
  });

  it('予約の登録は受け取った日時と値をそのまま返す', async () => {
    const res = await fetch(`${origin}/api/common-vars/${COMMON_VAR_DETAIL.id}/schedules?accountId=account-1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ effectiveFrom: '2026-11-01T09:00', value: '新しい会社名' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { id: 'common-var-schedule-new', varId: COMMON_VAR_DETAIL.id, effectiveFrom: '2026-11-01T09:00', value: '新しい会社名', appliedAt: null },
    });
  });

  it('予約の削除に答える', async () => {
    const res = await fetch(`${origin}/api/common-vars/${COMMON_VAR_DETAIL.id}/schedules/common-var-schedule-new?accountId=account-1`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
  });
});
