import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { app } from '../index.js';
import type { Env } from '../worker-env.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { createTotpEnrollment } from '../lib/totp.js';
import { sha256Hex } from './auth.js';

let fixture: SqliteD1;
let db: D1Database;
let trips: string[];
let tokenHash: string;

// batchは含むSQLの数にかかわらず1往復。中の実行を二重計上しない。
function countedDb(source: D1Database): D1Database {
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  function wrap(statement: D1PreparedStatement, sql: string): D1PreparedStatement {
    const proxy = new Proxy(statement, {
      get(target, prop) {
        if (prop === 'bind') return (...args: unknown[]) => wrap(target.bind(...args), sql);
        if (['first', 'all', 'run', 'raw'].includes(String(prop))) return (...args: unknown[]) => {
          trips.push(sql);
          return Reflect.get(target, prop).apply(target, args);
        };
        return Reflect.get(target, prop);
      },
    });
    originals.set(proxy, statement);
    return proxy;
  }
  return {
    prepare: sql => wrap(source.prepare(sql), sql),
    batch: statements => {
      trips.push('batch');
      return source.batch(statements.map(statement => originals.get(statement) ?? statement));
    },
  } as D1Database;
}

beforeEach(async () => {
  fixture = createTestD1();
  fixture.raw.exec(`INSERT INTO tenants(id,name) VALUES('tenant','Fixture');
    INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('actor','Fixture','owner','unused-key','tenant');
    INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id)
      VALUES('store','fixture-channel','Fixture','fixture-token','fixture-secret','tenant');`);
  tokenHash = await sha256Hex('fixture-session');
  fixture.raw.prepare("INSERT INTO admin_sessions(token_hash,staff_id,expires_at) VALUES(?,'actor',?)")
    .run(tokenHash, new Date(Date.now() + 3600_000).toISOString());
  trips = [];
  db = countedDb(fixture.db);
});
afterEach(() => { vi.restoreAllMocks(); fixture.raw.close(); });

function request(path: string, extra: Partial<Env['Bindings']> = {}) {
  return app.request(path, { headers: { Cookie: 'lh_admin_session=fixture-session; lh_csrf=fixture-csrf' } },
    { DB: db, ...extra } as Env['Bindings']);
}

// 実アプリのmiddleware登録からhandlerまで通し、権限付き読取の予算を守る。
it.each([
  ['/api/staff/me', 2],
  ['/api/tenants/me', 3],
  ['/api/auth/session', 4],
  ['/api/line-accounts', 7],
  ['/api/hq/style-attention', 5],
  ['/api/inbox/unanswered/count', 4],
  ['/api/accounts/health-summary', 4],
  ['/api/notifications/center?lineAccountId=store&limit=1', 5],
  ['/api/settings/features/visibility?account_id=store', 7],
  ['/api/settings/features?account_id=store', 8],
  ['/api/hq/billing/summary', 3],
])('%s のD1往復数を守る', async (path, expected) => {
  const response = await request(path);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(trips.length, trips.join('\n')).toBe(expected);
});

it('別要求のスタッフ停止・範囲変更を読み直し、秘密列を応答へ出さない', async () => {
  const first = await request('/api/staff/me');
  const body = await first.text();
  expect(first.status).toBe(200);
  expect(body).not.toMatch(/unused-key|totp_secret|password_hash/);
  fixture.raw.prepare("UPDATE staff_members SET account_scope='accounts' WHERE id='actor'").run();
  const scoped = await request('/api/line-accounts');
  expect((await scoped.json() as { data: unknown[] }).data).toEqual([]);
  fixture.raw.prepare("UPDATE staff_members SET is_active=0 WHERE id='actor'").run();
  expect((await request('/api/staff/me')).status).toBe(401);
});

it('別統括のアカウント指定は従来どおり拒否する', async () => {
  fixture.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id)
    VALUES('foreign','foreign','Foreign','secret','secret','other');`);
  expect((await request('/api/settings/features/visibility?account_id=foreign')).status).toBe(403);
});

const mfaKey = 'fixture-mfa-master-key-at-least-32-characters';
async function registerMfa() {
  const enrollment = await createTotpEnrollment('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', mfaKey);
  fixture.raw.prepare("UPDATE staff_members SET totp_enabled_at='2026-10-01',totp_secret_enc=? WHERE id='actor'")
    .run(enrollment.encrypted);
  fixture.raw.prepare("INSERT INTO platform_settings(key,value) VALUES(?, 'actor')")
    .run(`auth.mfa.session:${tokenHash}`);
}

it.each([
  ['/api/staff/me', 4], ['/api/tenants/me', 5], ['/api/auth/session', 6],
  ['/api/line-accounts', 9], ['/api/hq/style-attention', 7],
  ['/api/inbox/unanswered/count', 6], ['/api/accounts/health-summary', 6],
  ['/api/notifications/center?lineAccountId=store&limit=1', 7],
  ['/api/settings/features/visibility?account_id=store', 9],
  ['/api/settings/features?account_id=store', 10], ['/api/hq/billing/summary', 5],
])('MFA登録済み %s のD1往復数を守る', async (path, expected) => {
  await registerMfa();
  const response = await request(path, { TOTP_ENCRYPTION_KEY: mfaKey });
  expect(response.status, await response.clone().text()).toBe(200);
  expect(trips.length, trips.join('\n')).toBe(expected);
});

it.each(['missing', 'wrong-staff', 'policy-off'] as const)('MFA確認の印が%sならセッションを拒否する', async mode => {
  await registerMfa();
  fixture.raw.prepare("DELETE FROM platform_settings WHERE key=?").run(`auth.mfa.session:${tokenHash}`);
  if (mode === 'wrong-staff') fixture.raw.prepare("INSERT INTO platform_settings(key,value) VALUES(?, 'other')").run(`auth.mfa.session:${tokenHash}`);
  if (mode === 'policy-off') fixture.raw.exec("INSERT INTO platform_settings(key,value) VALUES('auth.mfa.required:tenant','false')");
  expect((await request('/api/staff/me', { TOTP_ENCRYPTION_KEY: mfaKey })).status).toBe(401);
  expect(fixture.raw.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash=?').get(tokenHash)).toBeUndefined();
});

it('MFA必須で未登録のセッションは確認の印を読まずに拒否する', async () => {
  expect((await request('/api/staff/me', { TOTP_ENCRYPTION_KEY: mfaKey })).status).toBe(401);
  // 本人＋方針＋失効batch＋緊急APIキーfallbackの4往復。許可へは進まない。
  expect(trips).toHaveLength(4);
});
