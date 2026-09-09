import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

// index.ts はモジュール読み込み時に @line-crm/db の関数を掴む。QR は DB を
// 使わないので、読み込みが通るだけの空実装を置く。
vi.mock('@line-crm/db', () => ({
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getTrafficPoolBySlug: vi.fn(),
  getTrafficPoolById: vi.fn(),
  getRandomPoolAccount: vi.fn(),
  getPoolAccounts: vi.fn(),
  getEntryRouteByRefCode: vi.fn(),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
}));

import { qrHandler, type Env } from './index.js';

const REF_LINK = 'https://worker.example.com/r/spring-campaign-2026';

const app = new Hono<Env>();
app.get('/api/qr', qrHandler);

/** QR は公開口なので、DB も秘密値も無い env で通らなければならない。 */
async function call(query: string): Promise<Response> {
  return app.fetch(new Request(`https://worker.example.com/api/qr?${query}`), {} as Env['Bindings']);
}

function forbidOutboundFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('QR生成で外部へ通信してはいけない');
  });
}

let fetchSpy: ReturnType<typeof forbidOutboundFetch>;

beforeEach(() => {
  fetchSpy = forbidOutboundFetch();
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('GET /api/qr — 流入refを外へ出さない', () => {
  it('QRを返す間、外部への通信を1回も行わない', async () => {
    for (const format of ['png', 'svg', 'jpg']) {
      const res = await call(`format=${format}&data=${encodeURIComponent(REF_LINK)}`);
      expect(res.status).toBe(200);
      expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('入力を断るときも外部へ通信しない', async () => {
    expect((await call('')).status).toBe(400);
    expect((await call(`size=9x9&data=${encodeURIComponent(REF_LINK)}`)).status).toBe(400);
    expect((await call(`data=${encodeURIComponent('あ'.repeat(700))}`)).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('LIFF URL の ref を含む問い合わせでも外へ出さない', async () => {
    const liff = 'https://liff.line.me/1657412345-AbCdEfGh?ref=secret-ref-9182&pool=main';
    const res = await call(`size=240x240&data=${encodeURIComponent(liff)}`);
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/qr — 既存の契約', () => {
  it('format ごとに Content-Type と中身の印が変わる', async () => {
    const png = await call(`data=${encodeURIComponent(REF_LINK)}`);
    expect(png.headers.get('Content-Type')).toBe('image/png');
    expect(Array.from(new Uint8Array(await png.arrayBuffer()).subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const svg = await call(`format=svg&data=${encodeURIComponent(REF_LINK)}`);
    expect(svg.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(await svg.text()).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);

    const jpg = await call(`format=jpg&data=${encodeURIComponent(REF_LINK)}`);
    expect(jpg.headers.get('Content-Type')).toBe('image/jpeg');
    expect(Array.from(new Uint8Array(await jpg.arrayBuffer()).subarray(0, 2))).toEqual([0xff, 0xd8]);
  });

  it('知らない format は png に丸める', async () => {
    const res = await call(`format=eps&data=${encodeURIComponent(REF_LINK)}`);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('download=1 で、実際に返す形式の拡張子を付けて保存させる', async () => {
    const res = await call(`format=svg&download=1&filename=${encodeURIComponent('../A店 referral')}&data=x`);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="---A--referral.svg"');
  });

  it('download を付けなければ画面内に表示する', async () => {
    const res = await call('data=x');
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
  });

  it('size は 64〜1024 の範囲だけ受ける', async () => {
    expect((await call(`size=64x64&data=${encodeURIComponent(REF_LINK)}`)).status).toBe(200);
    expect((await call(`size=1024x1024&data=${encodeURIComponent(REF_LINK)}`)).status).toBe(200);
    expect((await call('size=32x32&data=x')).status).toBe(400);
    expect((await call('size=2048x2048&data=x')).status).toBe(400);
    expect((await call('size=wide&data=x')).status).toBe(400);
  });

  it('data は UTF-8 で 2KiB まで', async () => {
    expect((await call(`size=1024x1024&data=${encodeURIComponent('a'.repeat(2048))}`)).status).toBe(200);
    expect((await call(`data=${encodeURIComponent('a'.repeat(2049))}`)).status).toBe(400);
    expect(await (await call(`data=${encodeURIComponent('a'.repeat(2049))}`)).text()).toBe('Data param too long');
  });

  it('data が無ければ 400', async () => {
    expect(await (await call('size=240x240')).text()).toBe('Missing data param');
  });
});

describe('GET /api/qr — 異常時の返し方', () => {
  it('小さすぎて読み取れない組み合わせは、理由を添えて 400 で断る', async () => {
    // 2KiB を 64px に詰めると、目には出るが読み取れない絵になる。
    const res = await call(`size=64x64&data=${encodeURIComponent('x'.repeat(2048))}`);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('64x64');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('作れる限界の組み合わせは通り、2MiB を超えない', async () => {
    for (const format of ['png', 'svg', 'jpg']) {
      const res = await call(`size=1024x1024&format=${format}&data=${encodeURIComponent('x'.repeat(2048))}`);
      expect(res.status).toBe(200);
      expect((await res.arrayBuffer()).byteLength).toBeLessThan(2 * 1024 * 1024);
    }
  });
});

describe('GET /api/qr — 公開口としての境界', () => {
  it('DB もアカウント設定も見ないので、空の env でも同じ絵を返す', async () => {
    const withoutEnv = await app.fetch(
      new Request(`https://worker.example.com/api/qr?data=${encodeURIComponent(REF_LINK)}`),
      {} as Env['Bindings'],
    );
    const withEnv = await app.fetch(
      new Request(`https://worker.example.com/api/qr?data=${encodeURIComponent(REF_LINK)}`),
      { DB: {} as D1Database, LIFF_URL: 'https://liff.line.me/other' } as Env['Bindings'],
    );
    expect(Array.from(new Uint8Array(await withoutEnv.arrayBuffer()))).toEqual(
      Array.from(new Uint8Array(await withEnv.arrayBuffer())),
    );
  });

  it('同時に来ても、それぞれの data の絵が混ざらない', async () => {
    const links = Array.from({ length: 12 }, (_, i) => `${REF_LINK}-${i}`);
    const formats = ['png', 'jpg', 'svg'];
    const parallel = await Promise.all(
      links.map((link, i) => call(`format=${formats[i % 3]}&data=${encodeURIComponent(link)}`).then((r) => r.arrayBuffer())),
    );
    const sequential: ArrayBuffer[] = [];
    for (const [i, link] of links.entries()) {
      sequential.push(await (await call(`format=${formats[i % 3]}&data=${encodeURIComponent(link)}`)).arrayBuffer());
    }
    for (let i = 0; i < links.length; i++) {
      expect(Array.from(new Uint8Array(parallel[i]))).toEqual(Array.from(new Uint8Array(sequential[i])));
    }
    // data が違えば絵も違う。取り違えが起きていない証拠。
    expect(new Set(parallel.map((b) => new Uint8Array(b).join(','))).size).toBe(links.length);
  });
});
