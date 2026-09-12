import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

/**
 * 全体上限・選択肢定員が同時回答で超えないことの実DBテスト(N-167 / #751)。
 *
 * 棚卸し(#264, 2026-09-12)で、`checkFormGates` の「数えてから比べる」判定
 * だけでは、実SQLiteファイル1本への2接続 + `Promise.all` で確実に(または
 * ほぼ確実に)超えることを確認済み。ここでは修正後、同じ形の並行でも
 * 超えないことを見る。
 *
 * forms-submit-reality.test.ts の「実DBの2接続」パターンを流用する
 * (D1 の並行に近い形。better-sqlite3 は同期実行だが、await のたびに
 * 制御が譲られるため、この形で実際の競合を再現できる)。
 *
 * 時刻の同一性には依存しない(#743 の教訓)。別々の友だち・別々の
 * Idempotency-Key を使い、判定は「最終的に何件保存されたか」「エラーの
 * 文言が利用者に分かる形か」だけを見る。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = readFileSync(join(HERE, '..', '..', '..', '..', 'packages', 'db', 'bootstrap.sql'), 'utf8');

const TOTAL_LIMIT_LAYOUT = JSON.stringify({
  sections: [{ id: 's1', blocks: [{ id: 'b1', kind: 'input', type: 'text', name: 'full_name', label: 'お名前', required: true }] }],
  options: { totalLimit: { enabled: true, max: 1, message: 'このフォームは受付を終了しました' } },
});

const CHOICE_CAPACITY_LAYOUT = JSON.stringify({
  sections: [{
    id: 's1',
    blocks: [
      { id: 'b1', kind: 'input', type: 'text', name: 'full_name', label: 'お名前', required: true },
      {
        id: 'b2',
        kind: 'input',
        type: 'radio',
        name: 'slot',
        label: '希望枠',
        choiceMode: 'friendField',
        choices: [{ id: 'c1', label: '午前', capacity: { enabled: true, limit: 1 } }],
      },
    ],
  }],
  options: {},
});

type Inject = { match: string; error: Error } | null;

function asD1(sqlite: Database.Database, injected: { current: Inject }) {
  function prepare(query: string): D1PreparedStatement {
    if (injected.current && query.includes(injected.current.match)) {
      const failure = injected.current;
      injected.current = null;
      throw failure.error;
    }
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return { prepare } as unknown as D1Database;
}

vi.mock('../services/liff-auth.js', () => ({
  verifyCallerLineIdentity: vi.fn(async (auth: string | null) => {
    if (auth === 'Bearer user-2') return { lineUserId: 'U-2', lineAccountId: 'account-a' };
    return { lineUserId: 'U-1', lineAccountId: 'account-a' };
  }),
}));
vi.mock('../services/line-proxy-send.js', () => ({
  pushViaHarnessProxy: vi.fn(async () => undefined),
}));
vi.mock('../services/local-line-proxy.js', () => ({
  dispatchLineProxyLocally: vi.fn(async () => new Response(null, { status: 200 })),
}));

const { forms } = await import('./forms.js');

function app() {
  const a = new Hono<Env>();
  a.route('/', forms);
  return a;
}

function envFor(db: D1Database) {
  return {
    DB: db,
    IMAGES: { put: vi.fn() } as unknown as R2Bucket,
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    WORKER_URL: 'https://worker.example.test',
  } as Env['Bindings'];
}

function submitRequest(formId: string, data: Record<string, unknown>, key: string, bearer: string) {
  return new Request(`https://worker.example.test/api/forms/${formId}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      'Idempotency-Key': key,
    },
    body: JSON.stringify({ data }),
  });
}

function twoConnections(seedSql: string) {
  const dir = mkdtempSync(join(tmpdir(), 'form-capacity-race-'));
  const file = join(dir, 'test.sqlite');
  const primary = new Database(file);
  primary.exec(BOOTSTRAP);
  primary.exec(`PRAGMA journal_mode=WAL;`);
  primary.exec(seedSql);
  const secondary = new Database(file);
  secondary.exec(`PRAGMA journal_mode=WAL;`);
  const injected1: { current: Inject } = { current: null };
  const injected2: { current: Inject } = { current: null };
  return {
    primary,
    secondary,
    env1: envFor(asD1(primary, injected1)),
    env2: envFor(asD1(secondary, injected2)),
    cleanup: () => {
      primary.close();
      secondary.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('N-167: 全体上限は同時回答でも超えない(実DB・2接続)', () => {
  test('totalLimit.max=1 のフォームへ、別々の友だちが同時に送っても1件しか保存されない', async () => {
    const { primary, env1, env2, cleanup } = twoConnections(`
      INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-1', 'T1');
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES ('account-a', 'ch-a', 'A', 'tok-a', 'sec-a', 'tenant-1');
      INSERT INTO friends (id, line_user_id, line_account_id, display_name)
      VALUES ('friend-1', 'U-1', 'account-a', '一郎'), ('friend-2', 'U-2', 'account-a', '二郎');
      INSERT INTO forms (id, name, fields, layout, save_to_metadata, is_active, submit_count)
      VALUES ('form-limit', 'L', '[]', '${TOTAL_LIMIT_LAYOUT}', 0, 1, 0);
      INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-limit', 'account-a');
    `);
    try {
      const [res1, res2] = await Promise.all([
        app().fetch(submitRequest('form-limit', { full_name: '一郎' }, 'aaaaaaaa-1111-4333-8444-111111111111', 'user-1'), env1),
        app().fetch(submitRequest('form-limit', { full_name: '二郎' }, 'bbbbbbbb-2222-4333-8444-222222222222', 'user-2'), env2),
      ]);
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 400]);

      const rejected = res1.status === 400 ? res1 : res2;
      const rejectedBody = await rejected.json() as { success: boolean; error: string };
      expect(rejectedBody.success).toBe(false);
      expect(rejectedBody.error).toBe('このフォームは受付を終了しました');

      const finalCount = primary.prepare(`SELECT COUNT(*) AS n FROM form_submissions WHERE form_id = 'form-limit'`).get() as { n: number };
      expect(finalCount.n).toBe(1);
      // 超過を拒んだ側の「確保しかけた枠」も残っていないこと。
      const claims = primary.prepare(`SELECT COUNT(*) AS n FROM form_capacity_claims WHERE form_id = 'form-limit'`).get() as { n: number };
      expect(claims.n).toBe(1);
    } finally {
      cleanup();
    }
  });
});

describe('N-167: 選択肢の定員は同時回答でも超えない(実DB・2接続)', () => {
  test('capacity.limit=1 の選択肢へ、別々の友だちが同時に同じ選択肢を選んでも1件しか通らない', async () => {
    const { primary, env1, env2, cleanup } = twoConnections(`
      INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-1', 'T1');
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES ('account-a', 'ch-a', 'A', 'tok-a', 'sec-a', 'tenant-1');
      INSERT INTO friends (id, line_user_id, line_account_id, display_name)
      VALUES ('friend-1', 'U-1', 'account-a', '一郎'), ('friend-2', 'U-2', 'account-a', '二郎');
      INSERT INTO forms (id, name, fields, layout, save_to_metadata, is_active, submit_count)
      VALUES ('form-choice', 'C', '[]', '${CHOICE_CAPACITY_LAYOUT}', 0, 1, 0);
      INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-choice', 'account-a');
    `);
    try {
      const [res1, res2] = await Promise.all([
        app().fetch(submitRequest('form-choice', { full_name: '一郎', slot: '午前' }, 'cccccccc-1111-4333-8444-333333333333', 'user-1'), env1),
        app().fetch(submitRequest('form-choice', { full_name: '二郎', slot: '午前' }, 'dddddddd-2222-4333-8444-444444444444', 'user-2'), env2),
      ]);
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 400]);

      const rejected = res1.status === 400 ? res1 : res2;
      const rejectedBody = await rejected.json() as { success: boolean; error: string };
      expect(rejectedBody.success).toBe(false);
      expect(rejectedBody.error).toBe('「午前」は定員に達しました');

      const finalCount = primary.prepare(`SELECT COUNT(*) AS n FROM form_submissions WHERE form_id = 'form-choice'`).get() as { n: number };
      expect(finalCount.n).toBe(1);
      const claims = primary.prepare(`SELECT COUNT(*) AS n FROM form_capacity_claims WHERE form_id = 'form-choice'`).get() as { n: number };
      expect(claims.n).toBe(1);
    } finally {
      cleanup();
    }
  });

  test('同じ回答が全体上限と選択肢定員を両方要求し、片方だけ空きが無い場合はどちらの枠も残らない', async () => {
    const layout = JSON.stringify({
      sections: [{
        id: 's1',
        blocks: [
          { id: 'b1', kind: 'input', type: 'text', name: 'full_name', label: 'お名前', required: true },
          {
            id: 'b2', kind: 'input', type: 'radio', name: 'slot', label: '希望枠', choiceMode: 'friendField',
            choices: [{ id: 'c1', label: '午前', capacity: { enabled: true, limit: 5 } }],
          },
        ],
      }],
      options: { totalLimit: { enabled: true, max: 1, message: '受付終了' } },
    });
    const { primary, env1, env2, cleanup } = twoConnections(`
      INSERT OR IGNORE INTO tenants (id, name) VALUES ('tenant-1', 'T1');
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
      VALUES ('account-a', 'ch-a', 'A', 'tok-a', 'sec-a', 'tenant-1');
      INSERT INTO friends (id, line_user_id, line_account_id, display_name)
      VALUES ('friend-1', 'U-1', 'account-a', '一郎'), ('friend-2', 'U-2', 'account-a', '二郎');
      INSERT INTO forms (id, name, fields, layout, save_to_metadata, is_active, submit_count)
      VALUES ('form-both', 'B', '[]', '${layout}', 0, 1, 0);
      INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-both', 'account-a');
    `);
    try {
      const [res1, res2] = await Promise.all([
        app().fetch(submitRequest('form-both', { full_name: '一郎', slot: '午前' }, 'eeeeeeee-1111-4333-8444-555555555551', 'user-1'), env1),
        app().fetch(submitRequest('form-both', { full_name: '二郎', slot: '午前' }, 'ffffffff-2222-4333-8444-555555555552', 'user-2'), env2),
      ]);
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 400]);

      // 全体上限(max=1)で断られた側は、選択肢の枠(定員5、まだ空きがある)も
      // 確保したままにしてはいけない。断られた回答の分だけ丸ごと戻す。
      const totalClaims = primary.prepare(
        `SELECT COUNT(*) AS n FROM form_capacity_claims WHERE form_id = 'form-both' AND slot_key = '__total__'`,
      ).get() as { n: number };
      expect(totalClaims.n).toBe(1);
      const choiceClaims = primary.prepare(
        `SELECT COUNT(*) AS n FROM form_capacity_claims WHERE form_id = 'form-both' AND slot_key = 'choice:slot:午前'`,
      ).get() as { n: number };
      expect(choiceClaims.n).toBe(1);
    } finally {
      cleanup();
    }
  });
});
