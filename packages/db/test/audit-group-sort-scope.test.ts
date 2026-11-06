import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listAuditEvents, recordAuditEvent } from '../src/access-audit.js';
import { getTrackedLinkStats } from '../src/analytics.js';
import { asD1 } from './d1-test-helper.js';

/*
 * 監査記録・URL分析の並び・分類・範囲の試験。
 *  - 「古い順」の並び替えはDBがページ分割と同じ順序で行う
 *  - タブの絞り込み（group）と件数の集計は同じ分類を使う
 *  - 所属先がない認証記録はアカウントの履歴へ混ぜない
 *  - URL分析の検索はSQLで絞り、上位200件の外のURLにも届く
 */
const TENANT = '00000000-0000-4000-8000-000000000001';
let sqlite: Database.Database;
let db: D1Database;

function addAccount(id: string) {
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
     VALUES (?, ?, ?, 'token', 'secret', ?)`,
  ).run(id, `channel-${id}`, id, TENANT);
}

function addStaff(id: string, accountId?: string) {
  sqlite.prepare(
    `INSERT INTO staff_members
       (id, name, email, role, api_key, is_active, access_level, permission_keys,
        notification_preferences, invite_status, invite_expires_at, totp_secret_enc,
        totp_enabled_at, account_scope, tenant_id)
     VALUES (?, ?, ?, 'staff', ?, 1, 'full', '[]', '{}', 'active', NULL, NULL, NULL, 'accounts', ?)`,
  ).run(id, id, `${id}@example.com`, `key-${id}`, TENANT);
  if (accountId) {
    sqlite.prepare(
      `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at) VALUES (?, ?, ?)`,
    ).run(id, accountId, '2026-09-01T00:00:00.000Z');
  }
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  db = asD1(sqlite);
  addAccount('account-a');
  addAccount('account-b');
});

describe('監査 R68: 「古い順」はDBの並び替えでページを分ける', () => {
  it('sort=asc なら1ページ目がいちばん古く、ページをまたいでも逆転しない', async () => {
    for (const [id, at] of [
      ['e1', '2026-09-01T00:00:00.000Z'],
      ['e2', '2026-09-02T00:00:00.000Z'],
      ['e3', '2026-09-03T00:00:00.000Z'],
    ] as const) {
      await recordAuditEvent(db, {
        id, tenantId: TENANT, lineAccountId: 'account-a', category: 'business',
        action: 'broadcast.send', result: 'success', createdAt: at,
      });
    }
    const base = { tenantId: TENANT, allowedLineAccountIds: ['account-a'], lineAccountId: 'account-a', sort: 'asc' as const, limit: 2 };
    const page1 = await listAuditEvents(db, { ...base, offset: 0 });
    const page2 = await listAuditEvents(db, { ...base, offset: 2 });
    expect(page1.items.map((row) => row.id)).toEqual(['e1', 'e2']);
    expect(page2.items.map((row) => row.id)).toEqual(['e3']);
    // 既定は新しい順。
    const desc = await listAuditEvents(db, { ...base, sort: 'desc', offset: 0 });
    expect(desc.items.map((row) => row.id)).toEqual(['e3', 'e2']);
  });
});

describe('監査 R69: タブの絞り込みと件数の集計は同じ分類', () => {
  it('配信した は publish も拾い、設定を変えた は change/patch/put も拾う。件数と一致する', async () => {
    for (const [id, action] of [
      ['send-1', 'broadcast.send'],
      ['publish-1', 'scenarios.publish'],
      ['update-1', 'settings.update'],
      ['change-1', 'broadcasts.change'],
      ['patch-1', 'api.patch.friends'],
      ['put-1', 'api.put.tags'],
      ['other-1', 'friends.view'],
    ] as const) {
      await recordAuditEvent(db, {
        id, tenantId: TENANT, lineAccountId: 'account-a', category: 'business',
        action, result: 'success', createdAt: '2026-09-05T00:00:00.000Z',
      });
    }
    const base = { tenantId: TENANT, allowedLineAccountIds: ['account-a'], lineAccountId: 'account-a', now: '2026-09-07T00:00:00.000Z' };
    const sent = await listAuditEvents(db, { ...base, group: 'sent' });
    const changed = await listAuditEvents(db, { ...base, group: 'changed' });
    expect(sent.items.map((row) => row.id).sort()).toEqual(['publish-1', 'send-1']);
    expect(changed.items.map((row) => row.id).sort()).toEqual(['change-1', 'patch-1', 'put-1', 'update-1']);
    expect(sent.summary.sent).toBe(2);
    expect(changed.summary.changed).toBe(4);
    expect(sent.total).toBe(2);
    expect(changed.total).toBe(4);
  });
});

describe('アカウントの監査記録は保存時の所属先だけで分離する', () => {
  it('全体を見られる人にも、別アカウントと所属先不明のログイン記録を返さない', async () => {
    await recordAuditEvent(db, {
      id: 'login-unscoped', tenantId: TENANT, category: 'auth',
      action: 'auth.login', result: 'success', createdAt: '2026-09-05T00:00:00.000Z',
    });
    await recordAuditEvent(db, {
      id: 'login-a', tenantId: TENANT, lineAccountId: 'account-a', category: 'auth',
      action: 'auth.login', result: 'success', createdAt: '2026-09-05T00:30:00.000Z',
    });
    await recordAuditEvent(db, {
      id: 'login-b', tenantId: TENANT, lineAccountId: 'account-b', category: 'auth',
      action: 'auth.login', result: 'success', createdAt: '2026-09-05T00:45:00.000Z',
    });
    await recordAuditEvent(db, {
      id: 'biz-1', tenantId: TENANT, lineAccountId: 'account-a', category: 'business',
      action: 'broadcast.send', result: 'success', createdAt: '2026-09-05T01:00:00.000Z',
    });
    const result = await listAuditEvents(db, {
      tenantId: TENANT, allowedLineAccountIds: ['account-a', 'account-b'],
      lineAccountId: 'account-a',
    });
    expect(result.items.map((row) => row.id).sort()).toEqual(['biz-1', 'login-a']);
    expect(result.total).toBe(2);
    expect(result.summary.total).toBe(2);
    expect(result.summary.logins).toBe(1);
  });

  it('担当者が複数アカウントに所属していても、所属先不明の認証記録を推測して表示しない', async () => {
    addStaff('staff-a', 'account-a');
    sqlite.prepare('INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at) VALUES (?, ?, ?)')
      .run('staff-a', 'account-b', '2026-09-01T00:00:00.000Z');
    await recordAuditEvent(db, {
      id: 'login-unscoped', tenantId: TENANT, category: 'auth', actorPrincipalId: 'staff-a',
      action: 'auth.login', result: 'success', createdAt: '2026-09-05T00:00:00.000Z',
    });
    await recordAuditEvent(db, {
      id: 'login-b', tenantId: TENANT, lineAccountId: 'account-b', category: 'auth', actorPrincipalId: 'staff-a',
      action: 'auth.login', result: 'success', createdAt: '2026-09-05T01:00:00.000Z',
    });
    const result = await listAuditEvents(db, {
      tenantId: TENANT, allowedLineAccountIds: ['account-a'],
      lineAccountId: 'account-a',
    });
    expect(result.items).toEqual([]);
    expect(result.summary.total).toBe(0);
    expect(result.summary.logins).toBe(0);
  });

  it('アカウント指定がない場合や許可外の指定は空にする', async () => {
    await recordAuditEvent(db, {
      id: 'event-a', tenantId: TENANT, lineAccountId: 'account-a', category: 'business',
      action: 'broadcast.send', createdAt: '2026-09-05T00:00:00.000Z',
    });
    for (const input of [
      { tenantId: TENANT, allowedLineAccountIds: ['account-a'] },
      { tenantId: TENANT, allowedLineAccountIds: ['account-b'], lineAccountId: 'account-a' },
    ]) {
      const result = await listAuditEvents(db, input);
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.summary.total).toBe(0);
    }
  });
});

describe('監査 R72: URL分析の検索はSQL側で絞る', () => {
  it('クリック上位でなくても検索語に合うURLを返す（上位200件の外に届く）', async () => {
    const insertLink = sqlite.prepare(
      `INSERT INTO tracked_links (id, name, original_url, is_active, created_at, updated_at, line_account_id)
       VALUES (?, ?, ?, 1, '2026-09-01', '2026-09-01', 'account-a')`,
    );
    const insertClick = sqlite.prepare(
      `INSERT INTO link_clicks (id, tracked_link_id, clicked_at) VALUES (?, ?, ?)`,
    );
    // 上位は「本店キャンペーン」ばかり。目的のURLはクリック0で限界の外。
    insertLink.run('link-top', '本店キャンペーン', 'https://example.com/top');
    insertClick.run('c1', 'link-top', '2026-09-10T00:00:00.000Z');
    insertLink.run('link-target', '支店の案内', 'https://example.com/branch-info');
    insertLink.run('link-other', '支店の地図', 'https://example.com/branch-map');

    const range = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z' };
    // limit=1 では top だけが返り、target は取れない（以前の画面側検索と同じ状況）。
    const firstPage = await getTrackedLinkStats(db, 'account-a', range, 1);
    expect(firstPage.map((row) => row.trackedLinkId)).toEqual(['link-top']);
    // 検索語を渡せば、上位に入らないURLにも届く。
    const searched = await getTrackedLinkStats(db, 'account-a', range, 1, 'branch-info');
    expect(searched.map((row) => row.trackedLinkId)).toEqual(['link-target']);
    // 名前にも一致する。
    const byName = await getTrackedLinkStats(db, 'account-a', range, 10, '支店');
    expect(byName.map((row) => row.trackedLinkId).sort()).toEqual(['link-other', 'link-target']);
  });
});
