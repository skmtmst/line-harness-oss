import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import type { Env } from '../index.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { EMERGENCY_CONTROL_PERMISSION, operations } from './operations.js';

function app(
  role: 'owner' | 'admin' | 'staff' = 'owner',
  emergencyControl = role !== 'staff',
  tenantId?: string,
) {
  const instance = new Hono<Env>();
  instance.use('*', async (c, next) => {
    c.set('staff', {
      id: `${role}-1`,
      name: role,
      role,
      readOnly: false,
      permissionKeys: emergencyControl ? [EMERGENCY_CONTROL_PERMISSION] : [],
      tenantId,
    });
    await next();
  });
  instance.route('/', operations);
  return instance;
}

let testDb: ReturnType<typeof createTestD1>;

beforeEach(() => {
  testDb = createTestD1();
  testDb.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', 'LINE 1', 'token', 'secret')`,
  ).run();
});

function bindings(): Env['Bindings'] {
  return { DB: testDb.db } as Env['Bindings'];
}

function stopRequest(lineAccountId: string | null = 'account-1'): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-confirm-irreversible': 'operation-stop',
    },
    body: JSON.stringify({
      lineAccountId,
      capabilities: ['broadcast_dispatch', 'scenario_dispatch'],
      reason: '誤配信の防止',
      expectedVersion: 0,
      confirmation: '停止',
    }),
  };
}

describe('緊急停止の保存API', () => {
  it('確認ヘッダーと合言葉がない停止を拒否する', async () => {
    const noHeader = await app().request('/api/operations/incidents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        lineAccountId: 'account-1',
        capabilities: ['broadcast_dispatch'],
        reason: '障害対応',
        expectedVersion: 0,
        confirmation: '停止',
      }),
    }, bindings());
    expect(noHeader.status).toBe(428);

    const wrongWord = await app().request('/api/operations/incidents', {
      ...stopRequest(),
      body: JSON.stringify({
        lineAccountId: 'account-1',
        capabilities: ['broadcast_dispatch'],
        reason: '障害対応',
        expectedVersion: 0,
        confirmation: '止める',
      }),
    }, bindings());
    expect(wrongWord.status).toBe(400);
  });

  it('スタッフを拒否し、全体停止の操作はownerだけに限定する', async () => {
    expect((await app('staff').request(
      '/api/operations/incidents', stopRequest(), bindings(),
    )).status).toBe(403);
    expect((await app('admin').request(
      '/api/operations/incidents', stopRequest(null), bindings(),
    )).status).toBe(403);
    expect((await app('admin').request(
      '/api/operations/incidents', stopRequest('account-1'), bindings(),
    )).status).toBe(201);
  });

  it('ownerでも停止範囲の省略を全体停止として扱わない', async () => {
    const request = stopRequest(null);
    request.body = JSON.stringify({
      capabilities: ['broadcast_dispatch'],
      reason: '障害対応',
      expectedVersion: 0,
      confirmation: '停止',
    });
    expect((await app('owner').request(
      '/api/operations/incidents', request, bindings(),
    )).status).toBe(400);
  });

  it('管理者は専用permissionがなければ影響を見られても停止できない', async () => {
    const preview = await app('admin', false).request(
      '/api/operations/control/preview?account_id=account-1', {}, bindings(),
    );
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      success: true,
      data: { permissions: { canControl: false } },
    });
    const stopped = await app('admin', false).request(
      '/api/operations/incidents', stopRequest('account-1'), bindings(),
    );
    expect(stopped.status).toBe(403);
    expect(await stopped.json()).toMatchObject({ error: expect.stringContaining('専用権限') });

    const ownerStopped = await app('owner').request(
      '/api/operations/incidents', stopRequest('account-1'), bindings(),
    );
    const ownerStoppedBody = await ownerStopped.json() as {
      data: { control: { version: number }; incident: { id: string } };
    };
    const restored = await app('admin', false).request(
      `/api/operations/incidents/${ownerStoppedBody.data.incident.id}/restore`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-confirm-irreversible': 'operation-restore',
        },
        body: JSON.stringify({
          expectedVersion: ownerStoppedBody.data.control.version,
          confirmation: '復旧',
        }),
      },
      bindings(),
    );
    expect(restored.status).toBe(403);
  });

  it('全アカウントの影響数はownerだけに返す', async () => {
    expect((await app('admin').request(
      '/api/operations/control/preview', {}, bindings(),
    )).status).toBe(403);
    expect((await app('owner').request(
      '/api/operations/control/preview', {}, bindings(),
    )).status).toBe(200);
  });

  it('影響人数の再計算を操作者と対象範囲付きで記録する', async () => {
    const response = await app('owner').request(
      '/api/operations/control/preview?account_id=account-1', {}, bindings(),
    );
    expect(response.status).toBe(200);

    const row = testDb.raw.prepare(
      `SELECT target_kind, target_id, action, actor_id, detail_json
         FROM operation_audit
        WHERE target_kind = 'emergency_control'`,
    ).get() as {
      target_kind: string;
      target_id: string;
      action: string;
      actor_id: string;
      detail_json: string;
    };
    expect(row).toMatchObject({
      target_kind: 'emergency_control',
      target_id: 'account-1',
      action: 'previewed',
      actor_id: 'owner-1',
    });
    expect(JSON.parse(row.detail_json)).toMatchObject({
      counts: { broadcast_dispatch: 0 },
      hasUnknownAudience: true,
      calculatedAt: expect.any(String),
    });
  });

  it('別統括のアカウント影響数を返さない', async () => {
    testDb.raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-2', '統括2')").run();
    testDb.raw.prepare("UPDATE line_accounts SET tenant_id = 'tenant-2' WHERE id = 'account-1'").run();

    const response = await app('admin', true, 'tenant-1').request(
      '/api/operations/control/preview?account_id=account-1', {}, bindings(),
    );
    expect(response.status).toBe(403);
  });

  it('管理者も全体停止の現在状態を確認できる', async () => {
    expect((await app('owner').request(
      '/api/operations/incidents', stopRequest(null), bindings(),
    )).status).toBe(201);

    const control = await app('admin').request('/api/operations/control', {}, bindings());
    expect(control.status).toBe(200);
    expect(await control.json()).toMatchObject({
      success: true,
      data: { states: { broadcast_dispatch: 'stopped', scenario_dispatch: 'stopped' } },
    });
  });

  it('別端末相当のGETで停止状態・スナップショット・履歴を取得できる', async () => {
    const stopped = await app().request(
      '/api/operations/incidents', stopRequest('account-1'), bindings(),
    );
    expect(stopped.status).toBe(201);
    const stoppedBody = await stopped.json() as {
      data: { incident: { id: string; stoppedSnapshot: { version: number } } };
    };
    expect(stoppedBody.data.incident.stoppedSnapshot.version).toBe(1);

    const control = await app('admin').request(
      '/api/operations/control?account_id=account-1', {}, bindings(),
    );
    expect(await control.json()).toMatchObject({
      success: true,
      data: {
        version: 1,
        states: { broadcast_dispatch: 'stopped', scenario_dispatch: 'stopped' },
      },
    });

    const history = await app('admin').request('/api/operations/history', {}, bindings());
    expect(await history.json()).toMatchObject({
      success: true,
      data: [expect.objectContaining({
        id: stoppedBody.data.incident.id,
        reason: '誤配信の防止',
        status: 'stopped',
      })],
    });

    const incident = await app('admin').request(
      `/api/operations/incidents/${stoppedBody.data.incident.id}`, {}, bindings(),
    );
    expect(await incident.json()).toMatchObject({
      success: true,
      data: { id: stoppedBody.data.incident.id, stoppedSnapshot: { version: 1 } },
    });
  });

  it('復旧後の状態を保存し、停止履歴を残す', async () => {
    const stopped = await app().request(
      '/api/operations/incidents', stopRequest('account-1'), bindings(),
    );
    const stoppedBody = await stopped.json() as {
      data: { control: { version: number }; incident: { id: string } };
    };
    const restored = await app().request(
      `/api/operations/incidents/${stoppedBody.data.incident.id}/restore`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-confirm-irreversible': 'operation-restore',
        },
        body: JSON.stringify({ expectedVersion: stoppedBody.data.control.version, confirmation: '復旧' }),
      },
      bindings(),
    );

    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      success: true,
      data: {
        control: { version: 2, activeIncidentId: null },
        incident: { status: 'resolved', restoredSnapshot: { version: 2 } },
      },
    });
    const history = await app().request('/api/operations/history', {}, bindings());
    expect(await history.json()).toMatchObject({
      success: true,
      data: [expect.objectContaining({ id: stoppedBody.data.incident.id, status: 'resolved' })],
    });
  });
});
