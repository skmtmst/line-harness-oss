import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@line-crm/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('@line-crm/db')>();
  return { ...original, jstNow: vi.fn(() => '2026-09-11 10:00:00') };
});

const { nenCampaigns } = await import('./nen-campaigns.js');

const SECRET = 'a'.repeat(32);

type DbState = {
  existing: { id: string; line_account_id: string | null } | null;
  insertBinds: unknown[] | null;
  preparedSql: string[];
};

function database(state: DbState): D1Database {
  return {
    prepare(sql: string) {
      state.preparedSql.push(sql);
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) {
          values = next;
          return statement;
        },
        async first() {
          if (sql.includes('SELECT id, line_account_id FROM nen_columns WHERE slug')) return state.existing;
          return null;
        },
        async run() {
          if (sql.includes('INSERT INTO nen_columns')) state.insertBinds = values;
          return { success: true, meta: { changes: 1 } };
        },
        async all() { return { success: true, results: [] }; },
      };
      return statement as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function freshState(): DbState {
  return { existing: null, insertBinds: null, preparedSql: [] };
}

async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function post(state: DbState, payload: Record<string, unknown>) {
  const app = new Hono<{ Bindings: { DB: D1Database; ECCUBE_WEBHOOK_SECRET: string } }>();
  app.route('/', nenCampaigns);
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return app.request('/api/integrations/eccube/columns', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nen-timestamp': timestamp,
      'x-nen-signature': `sha256=${await sign(SECRET, timestamp, body)}`,
    },
    body,
  }, { DB: database(state), ECCUBE_WEBHOOK_SECRET: SECRET });
}

beforeEach(() => { vi.clearAllMocks() });

describe('POST /api/integrations/eccube/columns の title 長さ検証（#711司令塔裁定）', () => {
  it('title が120字ちょうどなら通る', async () => {
    const state = freshState();
    const response = await post(state, {
      slug: 'boundary-120', title: 'あ'.repeat(120), article_url: 'https://example.com/journal/boundary-120',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { id: expect.any(String) } });
    expect(state.insertBinds).not.toBeNull();
  });

  it('title が121字だと title_invalid で拒否し、受け取った長さと上限を記録する', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = freshState();
    const response = await post(state, {
      slug: 'boundary-121', title: 'あ'.repeat(121), article_url: 'https://example.com/journal/boundary-121',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'title_invalid' });
    expect(state.insertBinds).toBeNull();

    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(consoleError.mock.calls[0][0] as string);
    expect(logged).toEqual({
      event: 'nen_eccube_column_title_rejected',
      slug: 'boundary-121',
      titleLength: 121,
      maxLength: 120,
    });
    consoleError.mockRestore();
  });

  it('title が120字以内なら記録を一切残さない', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const state = freshState();
    const response = await post(state, {
      slug: 'short-title', title: '短いタイトル', article_url: 'https://example.com/journal/short-title',
    });
    expect(response.status).toBe(200);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
