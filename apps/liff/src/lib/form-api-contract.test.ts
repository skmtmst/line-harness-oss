/**
 * 回答フォームの API 契約。
 *
 * Worker（apps/worker/src/routes/forms.ts）は GET /api/forms/:id と
 * /api/forms/:id/my-latest を `{ success: true, data }` の包みで返す。
 * LIFF は以前この包みを剥がさずに PublicForm として読み、本物の応答では
 * `data.layout` が undefined になってフォームが開けなかった。撮影用の偽 API
 * （scripts/qa-mock.mjs）は包み無しを返していたので、撮影では気づけなかった。
 *
 * ここでは「本物の形」「偽 API の実際の応答」の両方を同じ api 関数に通し、
 * 公開フォーム・試し回答・前回回答の復元が同じ契約で読めることを見張る。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

vi.mock('./liff-auth.js', () => ({ getIdToken: () => 'test-id-token', getLiffId: () => 'test-liff-id' }));
import { api, unwrapSuccessData } from './api.js';

const LAYOUT = {
  header: [],
  sections: [{ id: 's1', title: '', blocks: [] }],
  options: { restorePrevious: true },
};
const FORM = { id: 'f1', name: '来店アンケート', description: null, layout: LAYOUT, isActive: true };

function stubFetch(body: unknown, status = 200) {
  vi.stubGlobal('window', { location: { origin: 'https://example.test' } });
  const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

afterEach(() => vi.unstubAllGlobals());

describe('回答フォームの応答契約（Worker の形）', () => {
  test('公開フォームは包みを剥がして layout まで読める', async () => {
    stubFetch({ success: true, data: FORM });
    const form = await api.getForm('f1');
    expect(form.layout.sections).toHaveLength(1);
    expect(form.layout.options?.restorePrevious).toBe(true);
  });

  test('試し回答は合言葉を添えて取り、isTest を読める', async () => {
    const fetcher = stubFetch({ success: true, data: { ...FORM, isTest: true } });
    const form = await api.getForm('f1', '試し/合言葉');
    expect(form.isTest).toBe(true);
    expect(form.layout.sections).toHaveLength(1);
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(new URL(url).searchParams.get('test_token')).toBe('試し/合言葉');
  });

  test('前回回答の復元は data の answers を読む', async () => {
    stubFetch({ success: true, data: { answers: { name: '山田' }, createdAt: '2026-10-01T00:00:00Z' } });
    const latest = await api.getMyLatestFormAnswer('f1');
    expect(latest?.answers).toEqual({ name: '山田' });
  });

  test('前回回答が無い・設定が無いときは null', async () => {
    stubFetch({ success: true, data: null });
    expect(await api.getMyLatestFormAnswer('f1')).toBeNull();
  });

  test('包みの無い応答は契約違反として投げる（undefined を画面へ渡さない）', async () => {
    stubFetch(FORM);
    await expect(api.getForm('f1')).rejects.toThrow(/応答の形/);
    stubFetch({ success: false, data: FORM });
    await expect(api.getForm('f1')).rejects.toThrow(/応答の形/);
  });

  test('404 は status を持ったまま投げる（「見つかりません」の表示に使う）', async () => {
    stubFetch({ success: false, error: 'Form not found' }, 404);
    await expect(api.getForm('f1')).rejects.toMatchObject({ status: 404 });
  });

  test('包みで返す口だけを剥がす（ほかの GET は今までどおり）', async () => {
    stubFetch({ viewerCount: 2, lecturerName: null });
    expect(await api.webinarAudience('w1')).toEqual({ viewerCount: 2, lecturerName: null });
    expect(unwrapSuccessData({ success: true, data: 0 }, '/x')).toBe(0);
  });
});

describe('撮影用の偽 API も同じ契約で読める', () => {
  const port = 19000 + Math.floor(Math.random() * 900);
  let child: ChildProcess | null = null;

  beforeAll(async () => {
    const script = fileURLToPath(new URL('../../scripts/qa-mock.mjs', import.meta.url));
    child = spawn(process.execPath, [script], {
      env: { ...process.env, QA_MOCK_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('qa-mock が起動しない')), 10_000);
      child!.stdout!.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('listening')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child!.on('exit', (code) => reject(new Error(`qa-mock が終了した: ${code}`)));
    });
  });

  afterAll(() => {
    child?.kill();
  });

  function viaMock() {
    vi.stubGlobal('window', { location: { origin: `http://127.0.0.1:${port}` } });
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => realFetch(input, init));
  }

  test('公開フォーム', async () => {
    viaMock();
    const form = await api.getForm('qa-form-1');
    expect(Array.isArray(form.layout.sections)).toBe(true);
    expect(form.isTest).toBeUndefined();
  });

  test('試し回答', async () => {
    viaMock();
    const form = await api.getForm('qa-form-1', 'qa-token');
    expect(form.isTest).toBe(true);
    expect(Array.isArray(form.layout.sections)).toBe(true);
  });

  test('前回回答', async () => {
    viaMock();
    expect(await api.getMyLatestFormAnswer('qa-form-1')).toBeNull();
  });
});
