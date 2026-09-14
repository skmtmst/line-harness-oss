/**
 * N-282 form参照部分 (#802): ファネルと参照フォームのaccount所属をDBで検査する。
 * 別account・存在なし・未割当legacy行はfail-closedにする。
 *
 * 実SQLite(bootstrap.sql再生)に実物の createVersionedFunnel を当てる。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createVersionedFunnel } from '../src/analytics-funnels.js';
import { asD1 } from './d1-test-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function funnel(lineAccountId: string, formId: string) {
  return {
    lineAccountId, name: '購入まで', windowDays: 7,
    steps: [
      { label: '追加', kind: 'friend_add', match: {} },
      { label: '回答', kind: 'form', match: { formId } },
    ],
    createdAt: '2026-08-01T00:00:00.000Z',
  } as const;
}

describe('ファネルのフォーム参照はaccount所属で決まる（N-282 form）', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('ten-1', 't1')`).run();
    sqlite.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
       VALUES ('account-a', 'ch-a', 'A', 't', 's', 'ten-1'),
              ('account-b', 'ch-b', 'B', 't', 's', 'ten-1')`,
    ).run();
    sqlite.prepare(`INSERT INTO forms (id, name, fields) VALUES ('form-a', '申込A', '[]')`).run();
    sqlite.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-a', 'account-a')`).run();
    sqlite.prepare(`INSERT INTO forms (id, name, fields) VALUES ('form-b', '申込B', '[]')`).run();
    sqlite.prepare(`INSERT INTO form_accounts (form_id, line_account_id) VALUES ('form-b', 'account-b')`).run();
    sqlite.prepare(`INSERT INTO forms (id, name, fields) VALUES ('form-legacy', '旧', '[]')`).run();
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('自accountのフォーム参照は通る', async () => {
    const created = await createVersionedFunnel(db, funnel('account-a', 'form-a') as never);
    expect(created.funnelId).toBeTruthy();
  });

  it('別accountのフォーム参照はstepOrderつきで拒否する', async () => {
    await expect(createVersionedFunnel(db, funnel('account-a', 'form-b') as never))
      .rejects.toThrow('analytics_funnel_reference_missing:2');
  });

  it('存在しないフォーム参照は拒否する', async () => {
    await expect(createVersionedFunnel(db, funnel('account-a', 'form-ghost') as never))
      .rejects.toThrow('analytics_funnel_reference_missing:2');
  });

  it('未割当legacy行の参照は許可しない', async () => {
    await expect(createVersionedFunnel(db, funnel('account-a', 'form-legacy') as never))
      .rejects.toThrow('analytics_funnel_reference_missing:2');
  });
});
