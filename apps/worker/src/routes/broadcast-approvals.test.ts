/*
 * m12a 一斉配信の二者承認（v6-06 §6）。
 *
 * 見張るのは「人数の境目」と「送る人と承認する人は別人」と
 * 「期限切れは送らない」の3つ。承認済みになってから既存の送信の
 * 流れに渡すことと、二重の承認・送信を作らないことを確かめる。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index';
import type { AuthenticatedStaff } from '../middleware/auth';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite';
import { broadcasts } from './broadcasts';
import { broadcastApprovals } from './broadcast-approvals';
import {
  checkScheduledBroadcastApproval,
  enforceBroadcastSendApproval,
  sweepBroadcastApprovalExpiry,
} from '../services/broadcast-approval';
import { getBroadcastById } from '@line-crm/db';

const owner: AuthenticatedStaff = {
  id: 'owner-1', name: 'オーナー', role: 'owner', readOnly: false, tenantId: 'tenant-1',
};
const admin: AuthenticatedStaff = {
  ...owner, id: 'admin-1', name: '管理者', role: 'admin',
};
const sender: AuthenticatedStaff = {
  id: 'staff-send', name: '送る人', role: 'staff', readOnly: false, tenantId: 'tenant-1',
  permissionKeys: ['/broadcasts', 'broadcast.definition.edit', 'broadcast.definition.publish'],
};
const approver: AuthenticatedStaff = {
  id: 'staff-approve', name: '承認する人', role: 'staff', readOnly: false, tenantId: 'tenant-1',
  permissionKeys: ['/broadcasts', 'broadcast.approve'],
};
const noKeyStaff: AuthenticatedStaff = {
  id: 'staff-none', name: '鍵なし', role: 'staff', readOnly: false, tenantId: 'tenant-1',
  permissionKeys: ['/broadcasts', 'broadcast.definition.publish'],
};

function app(db: D1Database, actor: AuthenticatedStaff) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.env = { DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'default-token', WORKER_URL: 'https://worker.example' } as Env['Bindings'];
    c.set('staff', actor);
    await next();
  });
  // 承認の口を先に載せる。あとだと PUT /:id が approval-threshold を拾う。
  instance.route('/', broadcastApprovals);
  instance.route('/', broadcasts);
  return instance;
}

function json(method: string, body: unknown) {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function seedStaff(db: SqliteD1, id: string, name: string, role: string, permissionKeys: string[]) {
  db.raw.prepare(
    `INSERT INTO staff_members (id, name, role, api_key, is_active, permission_keys, invite_status)
     VALUES (?, ?, ?, ?, 1, ?, 'active')`,
  ).run(id, name, role, `key-${id}`, JSON.stringify(permissionKeys));
}

function seedBroadcast(db: SqliteD1, id: string, overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    id,
    title: `配信${id}`,
    message_type: 'text',
    message_content: '本文',
    target_type: 'all',
    status: 'draft',
    total_count: 0,
    success_count: 0,
    line_account_id: 'account-1',
    created_at: '2026-09-25T00:00:00.000',
    ...overrides,
  };
  const columns = Object.keys(row);
  db.raw.prepare(
    `INSERT INTO broadcasts (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
  ).run(...columns.map((column) => row[column] as never));
}

function approvalOf(db: SqliteD1, id: string): string {
  const row = db.raw.prepare(`SELECT approval_status FROM broadcasts WHERE id = ?`).get(id) as {
    approval_status: string;
  };
  return row.approval_status;
}

describe('二者承認の依頼・承認・差し戻し', () => {
  let testDb: SqliteD1;

  beforeEach(() => {
    testDb = createTestD1();
    testDb.raw.prepare(`INSERT INTO tenants (id, name) VALUES ('tenant-1', '統括1')`).run();
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active, tenant_id)
       VALUES ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', 1, 'tenant-1')`,
    ).run();
    // 運用者は2人（送る人・承認する人）。owner/admin は数に入れない運用担当だけ数える対象。
    seedStaff(testDb, 'staff-send', '送る人', 'staff', ['/broadcasts', 'broadcast.definition.edit', 'broadcast.definition.publish']);
    seedStaff(testDb, 'staff-approve', '承認する人', 'staff', ['/broadcasts', 'broadcast.approve']);
    for (let i = 1; i <= 5; i += 1) {
      insertFriend(testDb.raw, `friend-${i}`, { line_account_id: 'account-1' });
    }
    seedBroadcast(testDb, 'b1');
  });

  afterEach(() => {
    testDb.raw.close();
  });

  it('境目を3通にすると5人への送信は承認が要り、承認なしでは送れない', async () => {
    const saved = await app(testDb.db, owner)
      .request('/api/broadcasts/approval-threshold?lineAccountId=account-1', json('PUT', {
        lineAccountId: 'account-1', threshold: 3,
      }));
    expect(saved.status).toBe(200);

    const row = await getBroadcastById(testDb.db, 'b1');
    const gate = await enforceBroadcastSendApproval(testDb.db, row!);
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.code).toBe('APPROVAL_REQUIRED');
  });

  it('承認を依頼すると承認する人へのお知らせが1件積まれる', async () => {
    await app(testDb.db, owner)
      .request('/api/broadcasts/approval-threshold?lineAccountId=account-1', json('PUT', {
        lineAccountId: 'account-1', threshold: 3,
      }));

    const requested = await app(testDb.db, sender)
      .request('/api/broadcasts/b1/approval-request', json('POST', {
        approverStaffId: 'staff-approve', note: '秋の案内です',
      }));
    expect(requested.status).toBe(201);
    expect(approvalOf(testDb, 'b1')).toBe('pending');

    const notices = testDb.raw.prepare(
      `SELECT event_type FROM notifications WHERE event_type = 'broadcast.approval.requested'`,
    ).all() as Array<{ event_type: string }>;
    expect(notices.length).toBe(1);

    // 二重の依頼は作らない。
    const again = await app(testDb.db, sender)
      .request('/api/broadcasts/b1/approval-request', json('POST', { approverStaffId: 'staff-approve' }));
    expect(again.status).toBe(409);
  });

  it('自分の依頼は承認できない（API で拒否）', async () => {
    await app(testDb.db, owner)
      .request('/api/broadcasts/approval-threshold?lineAccountId=account-1', json('PUT', {
        lineAccountId: 'account-1', threshold: 3,
      }));
    // owner が頼んだものを owner 自身は承認できない。
    await app(testDb.db, owner)
      .request('/api/broadcasts/b1/approval-request', json('POST', { approverStaffId: 'staff-approve' }));
    const selfApprove = await app(testDb.db, owner)
      .request('/api/broadcasts/b1/approval-approve', json('POST', {}));
    expect(selfApprove.status).toBe(403);
    await expect(selfApprove.json()).resolves.toMatchObject({ code: 'SELF_APPROVAL' });

    // 承認する権限の鍵がない人は承認できない。
    const noKey = await app(testDb.db, noKeyStaff)
      .request('/api/broadcasts/b1/approval-approve', json('POST', {}));
    expect(noKey.status).toBe(403);

    // 別の承認する人が承認すると通る。二重押しは409。
    const approved = await app(testDb.db, approver)
      .request('/api/broadcasts/b1/approval-approve', json('POST', {}));
    expect(approved.status).toBe(200);
    expect(approvalOf(testDb, 'b1')).toBe('approved');
    const again = await app(testDb.db, approver)
      .request('/api/broadcasts/b1/approval-approve', json('POST', {}));
    expect(again.status).toBe(409);
  });

  it('差し戻しは理由が必須。理由があれば差し戻しになる', async () => {
    await app(testDb.db, owner)
      .request('/api/broadcasts/approval-threshold?lineAccountId=account-1', json('PUT', {
        lineAccountId: 'account-1', threshold: 3,
      }));
    await app(testDb.db, sender)
      .request('/api/broadcasts/b1/approval-request', json('POST', { approverStaffId: 'staff-approve' }));

    const noReason = await app(testDb.db, approver)
      .request('/api/broadcasts/b1/approval-reject', json('POST', { reason: '  ' }));
    expect(noReason.status).toBe(400);

    const rejected = await app(testDb.db, approver)
      .request('/api/broadcasts/b1/approval-reject', json('POST', { reason: '金額が古い' }));
    expect(rejected.status).toBe(200);
    expect(approvalOf(testDb, 'b1')).toBe('rejected');

    // 差し戻しのあとは頼み直せる。
    const rerequest = await app(testDb.db, sender)
      .request('/api/broadcasts/b1/approval-request', json('POST', { approverStaffId: 'staff-approve' }));
    expect(rerequest.status).toBe(201);
  });

  it('頼んだ人は依頼を取り消せる。もう一度知らせるで通知が増える', async () => {
    await app(testDb.db, owner)
      .request('/api/broadcasts/approval-threshold?lineAccountId=account-1', json('PUT', {
        lineAccountId: 'account-1', threshold: 3,
      }));
    await app(testDb.db, sender)
      .request('/api/broadcasts/b1/approval-request', json('POST', { approverStaffId: 'staff-approve' }));

    const reminded = await app(testDb.db, sender)
      .request('/api/broadcasts/b1/approval-remind', json('POST', {}));
    expect(reminded.status).toBe(200);
    const remindedCount = (testDb.raw.prepare(
      `SELECT COUNT(*) AS total FROM notifications WHERE event_type = 'broadcast.approval.reminded'`,
    ).get() as { total: number }).total;
    expect(remindedCount).toBe(1);

    const cancelled = await app(testDb.db, sender)
      .request('/api/broadcasts/b1/approval-cancel', json('POST', {}));
    expect(cancelled.status).toBe(200);
    expect(approvalOf(testDb, 'b1')).toBe('cancelled');
  });

  it('予約時刻を過ぎた未承認は期限切れになり、cron は送らない', async () => {
    await app(testDb.db, owner)
      .request('/api/broadcasts/approval-threshold?lineAccountId=account-1', json('PUT', {
        lineAccountId: 'account-1', threshold: 3,
      }));
    seedBroadcast(testDb, 'b2', {
      status: 'scheduled', scheduled_at: '2026-09-24T10:00:00+09:00',
    });
    await app(testDb.db, sender)
      .request('/api/broadcasts/b2/approval-request', json('POST', { approverStaffId: 'staff-approve' }));

    await sweepBroadcastApprovalExpiry(testDb.db, new Date('2026-09-25T00:00:00+09:00').getTime());
    expect(approvalOf(testDb, 'b2')).toBe('expired');

    const row = await getBroadcastById(testDb.db, 'b2');
    const check = await checkScheduledBroadcastApproval(testDb.db, row!);
    expect(check.sendable).toBe(false);
  });

  it('確認画面の出し分けに使う境目・人数・運用者数が取れる', async () => {
    const config = await app(testDb.db, sender)
      .request('/api/broadcasts/approval-config?lineAccountId=account-1');
    expect(config.status).toBe(200);
    await expect(config.json()).resolves.toMatchObject({
      success: true,
      data: { threshold: 1000, operatorCount: 2, singleOperator: false },
    });

    const candidates = await app(testDb.db, sender)
      .request('/api/broadcasts/approvals/candidates?lineAccountId=account-1');
    expect(candidates.status).toBe(200);
    const body = await candidates.json() as {
      success: boolean; data: Array<{ id: string }>;
    };
    // 自分は候補に出ない。承認する人だけ出る。
    expect(body.data.map((item) => item.id)).toEqual(['staff-approve']);
  });

  it('1人運用では承認の依頼は要らず、人数の一致で送れる', async () => {
    // 承認する人を消して1人運用にする。
    testDb.raw.prepare(`DELETE FROM staff_members WHERE id = 'staff-approve'`).run();
    await app(testDb.db, owner)
      .request('/api/broadcasts/approval-threshold?lineAccountId=account-1', json('PUT', {
        lineAccountId: 'account-1', threshold: 3,
      }));

    const requested = await app(testDb.db, sender)
      .request('/api/broadcasts/b1/approval-request', json('POST', { approverStaffId: 'staff-approve' }));
    expect(requested.status).toBe(409);
    await expect(requested.json()).resolves.toMatchObject({ code: 'SINGLE_OPERATOR' });


    const row = await getBroadcastById(testDb.db, 'b1');
    const mismatch = await enforceBroadcastSendApproval(testDb.db, row!, { confirmedRecipientCount: 4 });
    expect(mismatch.allowed).toBe(false);
    if (!mismatch.allowed) expect(mismatch.code).toBe('COUNT_MISMATCH');
    const matched = await enforceBroadcastSendApproval(testDb.db, row!, { confirmedRecipientCount: 5 });
    expect(matched.allowed).toBe(true);
  });
});
