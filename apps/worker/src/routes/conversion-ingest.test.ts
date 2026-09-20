import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeHmacSha256Hex } from '../lib/hmac.js';
import type { Env } from '../index.js';

// N-270: 公開受信口 /api/conversions/ingest/:id の回帰テスト。
// 管理認証を通さず、地点ごとの受信鍵で HMAC-SHA256 を照合し、
// 成否を conversion_ingestion_events(recordConversionIngestionEvent)へ残す。

const dbMocks = vi.hoisted(() => ({
  getConversionPointForIngest: vi.fn(),
  resolveConversionIngestSecret: vi.fn(),
  recordConversionIngestionEvent: vi.fn(),
  trackConversion: vi.fn(),
}));
const contractMocks = vi.hoisted(() => ({
  ConversionDefinitionError: class ConversionDefinitionError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: 400 | 404 | 409 = 409,
    ) {
      super(message);
    }
  },
}));

vi.mock('@line-crm/db', () => ({
  ...dbMocks,
  ConversionDefinitionError: contractMocks.ConversionDefinitionError,
}));
vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: vi.fn(),
  getVisibleLineAccountScope: vi.fn(),
}));
vi.mock('../services/affiliate-notifier.js', () => ({ notifyAffiliateApproval: vi.fn() }));

const { conversions } = await import('./conversions.js');

const SECRET = 'cvwhk_testsecret';

function app(friendByLineUserId: { id: string } | null = null) {
  const hono = new Hono<Env>();
  hono.use('*', async (c, next) => {
    c.env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({ first: vi.fn(async () => friendByLineUserId) })),
        })),
      } as unknown as D1Database,
      LINE_CREDENTIAL_ENCRYPTION_KEY: 'unused-in-mocks',
    } as Env['Bindings'];
    await next();
  });
  hono.route('/', conversions);
  return hono;
}

function activePoint(overrides: Record<string, unknown> = {}) {
  return {
    id: 'point-a',
    status: 'active',
    ingest_disabled_at: null,
    ingest_secret_encrypted: 'k1.v1.iv.ct',
    ...overrides,
  };
}

async function signedRequest(
  body: Record<string, unknown>,
  { eventId, secret = SECRET }: { eventId?: string; secret?: string } = {},
) {
  const raw = JSON.stringify(body);
  const signature = await computeHmacSha256Hex(secret, raw);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'X-Conversion-Signature': signature,
  };
  if (eventId) headers['X-Conversion-Event-Id'] = eventId;
  return app().request('/api/conversions/ingest/point-a', {
    method: 'POST', headers, body: raw,
  });
}

function lastLog() {
  const calls = dbMocks.recordConversionIngestionEvent.mock.calls;
  return calls[calls.length - 1]?.[1] as Record<string, unknown> | undefined;
}

describe('POST /api/conversions/ingest/:id (N-270)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getConversionPointForIngest.mockResolvedValue(activePoint());
    dbMocks.resolveConversionIngestSecret.mockResolvedValue(SECRET);
    dbMocks.recordConversionIngestionEvent.mockResolvedValue(undefined);
    dbMocks.trackConversion.mockImplementation(
      async (_db: unknown, _input: unknown, _opts: unknown, outcome?: { deduplicated?: boolean }) => {
        if (outcome) outcome.deduplicated = false;
        return { id: 'evt-1' };
      },
    );
  });

  it('存在しない地点は404で、point_not_found を台帳へ残す', async () => {
    dbMocks.getConversionPointForIngest.mockResolvedValue(null);
    const response = await signedRequest({ friendId: 'f1' }, { eventId: 'e1' });
    expect(response.status).toBe(404);
    expect(lastLog()).toMatchObject({ conversionPointId: 'point-a', result: 'rejected', reason: 'point_not_found' });
    expect(dbMocks.trackConversion).not.toHaveBeenCalled();
  });

  it.each([
    ['draft', 'point_draft'],
    ['stopped', 'point_stopped'],
  ])('status=%s の地点は409で、%s を台帳へ残す', async (status, reason) => {
    dbMocks.getConversionPointForIngest.mockResolvedValue(activePoint({ status }));
    const response = await signedRequest({ friendId: 'f1' }, { eventId: 'e1' });
    expect(response.status).toBe(409);
    expect(lastLog()).toMatchObject({ result: 'rejected', reason });
  });

  it('外部受信を止めた地点は403で、ingest_disabled を台帳へ残す', async () => {
    dbMocks.getConversionPointForIngest.mockResolvedValue(
      activePoint({ ingest_disabled_at: '2026-09-20T00:00:00+09:00' }),
    );
    const response = await signedRequest({ friendId: 'f1' }, { eventId: 'e1' });
    expect(response.status).toBe(403);
    expect(lastLog()).toMatchObject({ result: 'rejected', reason: 'ingest_disabled' });
  });

  it('受信鍵が未発行なら503で、secret_not_issued を台帳へ残す', async () => {
    dbMocks.resolveConversionIngestSecret.mockResolvedValue(null);
    const response = await signedRequest({ friendId: 'f1' }, { eventId: 'e1' });
    expect(response.status).toBe(503);
    expect(lastLog()).toMatchObject({ result: 'rejected', reason: 'secret_not_issued' });
  });

  it('署名ヘッダが無ければ401で、signature_missing を台帳へ残す', async () => {
    const response = await app().request('/api/conversions/ingest/point-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ friendId: 'f1' }),
    });
    expect(response.status).toBe(401);
    expect(lastLog()).toMatchObject({ result: 'rejected', reason: 'signature_missing' });
  });

  it('署名が違えば401で、signature_mismatch と署名のSHA-256だけを台帳へ残す', async () => {
    const response = await signedRequest({ friendId: 'f1' }, { eventId: 'e1', secret: 'wrong-secret' });
    expect(response.status).toBe(401);
    const log = lastLog();
    expect(log).toMatchObject({ result: 'rejected', reason: 'signature_mismatch' });
    expect(typeof log?.signatureSha256).toBe('string');
    expect(log?.signatureSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(dbMocks.trackConversion).not.toHaveBeenCalled();
  });

  it('署名が正しくても本文がJSONでなければ400で、invalid_json を台帳へ残す', async () => {
    const raw = 'not-json';
    const signature = await computeHmacSha256Hex(SECRET, raw);
    const response = await app().request('/api/conversions/ingest/point-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Conversion-Signature': signature },
      body: raw,
    });
    expect(response.status).toBe(400);
    expect(lastLog()).toMatchObject({ result: 'rejected', reason: 'invalid_json' });
  });

  it('sourceEventId が無ければ400で、source_event_id_missing を台帳へ残す', async () => {
    const response = await signedRequest({ friendId: 'f1' });
    expect(response.status).toBe(400);
    expect(lastLog()).toMatchObject({ result: 'rejected', reason: 'source_event_id_missing' });
  });

  it('友だちを特定できなければ400で、friend_missing を台帳へ残す', async () => {
    const response = await signedRequest({ value: 100 }, { eventId: 'e1' });
    expect(response.status).toBe(400);
    expect(lastLog()).toMatchObject({ result: 'rejected', reason: 'friend_missing', sourceEventId: 'e1' });
  });

  it('署名・本文・友だちが揃えば成果を記録し、recorded を台帳へ残す', async () => {
    const response = await signedRequest(
      { friendId: 'friend-1', sourceEventId: 'evt-body-1', value: 500 },
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { success: boolean; data: { received: boolean; duplicated: boolean } };
    expect(json.data).toMatchObject({ received: true, duplicated: false });
    expect(dbMocks.trackConversion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversionPointId: 'point-a',
        friendId: 'friend-1',
        value: 500,
        idempotencyKey: 'cvingest:point-a:evt-body-1',
      }),
      undefined,
      expect.anything(),
    );
    expect(lastLog()).toMatchObject({
      result: 'recorded', sourceEventId: 'evt-body-1', friendId: 'friend-1',
    });
  });

  it('同じsourceEventIdの再送は duplicate として台帳へ残し、応答は duplicated:true', async () => {
    dbMocks.trackConversion.mockImplementation(
      async (_db: unknown, _input: unknown, _opts: unknown, outcome?: { deduplicated?: boolean }) => {
        if (outcome) outcome.deduplicated = true;
        return { id: 'evt-1' };
      },
    );
    const response = await signedRequest({ friendId: 'f1' }, { eventId: 'e-dup' });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: { duplicated: boolean } };
    expect(json.data.duplicated).toBe(true);
    expect(lastLog()).toMatchObject({ result: 'duplicate', sourceEventId: 'e-dup' });
  });

  it('lineUserId でも友だちを引き当てて記録できる', async () => {
    const hono = new Hono<Env>();
    hono.use('*', async (c, next) => {
      c.env = {
        DB: {
          prepare: vi.fn(() => ({
            bind: vi.fn(() => ({ first: vi.fn(async () => ({ id: 'friend-from-line' })) })),
          })),
        } as unknown as D1Database,
      } as Env['Bindings'];
      await next();
    });
    hono.route('/', conversions);
    const raw = JSON.stringify({ lineUserId: 'U123', sourceEventId: 'e-line' });
    const signature = await computeHmacSha256Hex(SECRET, raw);
    const response = await hono.request('/api/conversions/ingest/point-a', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Conversion-Signature': signature },
      body: raw,
    });
    expect(response.status).toBe(200);
    expect(dbMocks.trackConversion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ friendId: 'friend-from-line' }),
      undefined,
      expect.anything(),
    );
  });

  it('冪等キー衝突(別内容の同ID)は409で、idempotency_conflict を台帳へ残す', async () => {
    dbMocks.trackConversion.mockRejectedValue(new Error('conversion_idempotency_conflict'));
    const response = await signedRequest({ friendId: 'f1' }, { eventId: 'e-conflict' });
    expect(response.status).toBe(409);
    expect(lastLog()).toMatchObject({ result: 'rejected', reason: 'idempotency_conflict' });
  });

  it('台帳の書き込みに失敗しても受信処理自体は止めない', async () => {
    dbMocks.recordConversionIngestionEvent.mockRejectedValue(new Error('ledger down'));
    const response = await signedRequest({ friendId: 'f1' }, { eventId: 'e1' });
    expect(response.status).toBe(200);
  });
});
