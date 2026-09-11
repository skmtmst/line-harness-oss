/**
 * #650 再審査: 自動配信(event-bus)の外向きWebhookに署名が必ず付くこと。
 *
 * 退行の中身: secret を暗号文だけで保存するようにしたのに、この経路は行を
 * そのまま deliverWebhook へ渡していた。平文列が NULL なので
 * X-Webhook-Signature が付かないまま送られ、しかも成功として記録されていた。
 *
 * ここでは差し替えなしの deliverWebhook と実際の復号を通し、送信ヘッダを
 * 直接見て署名を固定する。鍵は Worker の bindings 経由で読ませる。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const KEY = 'DRQbIikwNz5FTFNaYWhvdn2Ei5KZoKeutbzDytHY3-Y';

vi.mock('cloudflare:workers', () => ({ env: { LINE_CREDENTIAL_ENCRYPTION_KEY: KEY } }));

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({
    replyMessage: vi.fn().mockResolvedValue(undefined),
    pushMessage: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { fireEvent } from './event-bus.js';
import { encryptWebhookSecret } from '@line-crm/db';

const ACCOUNT = 'acc-1';
const SECRET = 'e'.repeat(32);

interface Written { sql: string; binds: unknown[] }

/** outgoing_webhooks の1行だけを返す最小の D1。他の問い合わせは空。 */
function dbWith(row: Record<string, unknown>, written: Written[] = []): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) { written.push({ sql, binds }); return this; },
        async all<T>(): Promise<{ results: T[] }> {
          if (sql.includes('FROM outgoing_webhooks')) return { results: [row as T] };
          return { results: [] };
        },
        async first<T>(): Promise<T | null> {
          // 記録の作成は「入れて読み直す」ので、読み直しに1行返す。
          if (sql.includes('FROM webhook_interaction_logs')) {
            return { id: 'wi-1', line_account_id: ACCOUNT, status: 'pending' } as T;
          }
          return null;
        },
        async run(): Promise<{ success: true }> { return { success: true }; },
      };
    },
  } as unknown as D1Database;
}

function captureFetch(): { headers: () => Record<string, string>; body: () => string; calls: () => number } {
  let seenHeaders: Record<string, string> = {};
  let seenBody = '';
  let count = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    // 送り先の名前引きは外へ出さず、公開IPを返す決め打ちにする。
    if (href.includes('dns.google') || href.includes('cloudflare-dns')) {
      return new Response(JSON.stringify({
        Status: 0,
        Answer: [{ name: 'hooks.example.com.', type: 1, TTL: 60, data: '93.184.216.34' }],
      }), { status: 200 });
    }
    count++;
    seenHeaders = (init?.headers ?? {}) as Record<string, string>;
    seenBody = String(init?.body ?? '');
    return new Response('', { status: 200 });
  }));
  return { headers: () => seenHeaders, body: () => seenBody, calls: () => count };
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function webhookRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'wh-1', name: '外部連携', url: 'https://hooks.example.com/events',
    event_types: '["*"]', secret: null, secret_encrypted: null,
    is_active: 1, max_retries: 0, consecutive_failures: 0, last_failed_at: null,
    line_account_id: ACCOUNT, created_at: '2026-05-08', updated_at: '2026-05-08',
    ...overrides,
  };
}

describe('#650 event-bus の外向きWebhookは暗号文でも署名する', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('平文列がNULLで暗号文だけの行でも X-Webhook-Signature が付く', async () => {
    const encrypted = await encryptWebhookSecret(SECRET, { current: KEY });
    const seen = captureFetch();
    await fireEvent(
      dbWith(webhookRow({ secret: null, secret_encrypted: encrypted })),
      'friend_added',
      { friendId: 'friend-1' },
      undefined,
      ACCOUNT,
    );
    expect(seen.calls()).toBe(1);
    const signature = seen.headers()['X-Webhook-Signature'];
    expect(signature).toBeDefined();
    expect(signature).toBe(await hmacHex(SECRET, seen.body()));
  });

  it('復号できない行は署名なしで送らず、失敗として記録する(fail-closed)', async () => {
    const seen = captureFetch();
    const written: Written[] = [];
    await fireEvent(
      dbWith(webhookRow({ secret: null, secret_encrypted: 'k000000000000.v1.zzz.zzz' }), written),
      'friend_added',
      { friendId: 'friend-1' },
      undefined,
      ACCOUNT,
    );
    // 送っていない。
    expect(seen.calls()).toBe(0);
    // 黙って捨てず、失敗として台帳に残す。
    const finished = written.filter((w) => w.sql.includes('UPDATE webhook_interaction_logs'));
    expect(finished.length).toBe(1);
    expect(finished[0].binds[0]).toBe('failed');
    // 台帳にも要求本文にも秘密値・暗号文を書かない。
    for (const w of written) {
      expect(JSON.stringify(w.binds)).not.toContain(SECRET);
      expect(JSON.stringify(w.binds)).not.toContain('k000000000000.v1.zzz.zzz');
    }
  });

  it('旧平文だけの行は従来どおり平文で署名する(後方互換)', async () => {
    const seen = captureFetch();
    await fireEvent(
      dbWith(webhookRow({ secret: SECRET, secret_encrypted: null })),
      'friend_added',
      { friendId: 'friend-1' },
      undefined,
      ACCOUNT,
    );
    expect(seen.calls()).toBe(1);
    expect(seen.headers()['X-Webhook-Signature']).toBe(await hmacHex(SECRET, seen.body()));
  });
});
