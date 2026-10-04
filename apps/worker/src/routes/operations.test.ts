import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { Env } from '../index.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { signOperationsEvent } from '../services/operations-signature.js';
import { DELIVERY_DISPATCH_JOB_NAMES } from '../services/feature-enforcement.js';
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

async function hash(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

beforeEach(async () => {
  testDb = createTestD1();
  testDb.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', 'LINE 1', 'token', 'secret')`,
  ).run();
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  testDb.raw.prepare(
    `INSERT INTO auth_step_up_grants (token_hash, staff_id, purpose, expires_at, created_at)
     VALUES (?, 'owner-1', 'operations.control', ?, ?),
            (?, 'admin-1', 'operations.control', ?, ?)`
  ).run(
    await hash('step-up-stop'), expiresAt, new Date().toISOString(),
    await hash('step-up-admin'), expiresAt, new Date().toISOString(),
  );
  testDb.raw.prepare(
    `INSERT INTO auth_step_up_grants (token_hash, staff_id, purpose, expires_at, created_at)
     VALUES (?, 'owner-1', 'operations.control', ?, ?),
            (?, 'owner-1', 'operations.control', ?, ?),
            (?, 'owner-1', 'operations.control', ?, ?)`
  ).run(
    await hash('step-up-restore'), expiresAt, new Date().toISOString(),
    await hash('step-up-restore-b'), expiresAt, new Date().toISOString(),
    await hash('step-up-restore-c'), expiresAt, new Date().toISOString(),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function bindings(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return { DB: testDb.db, ...overrides } as Env['Bindings'];
}

function stopRequest(lineAccountId: string | null = 'account-1', stepUpToken = 'step-up-stop'): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-confirm-irreversible': 'operation-stop',
      'x-step-up-token': stepUpToken,
      'idempotency-key': 'stop-request-1',
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
  it('step-up tokenと再実行キーがない重要操作を拒否する', async () => {
    const request = stopRequest();
    const headers = { ...(request.headers as Record<string, string>) };
    delete headers['x-step-up-token'];
    request.headers = headers;
    const noStepUp = await app().request('/api/operations/incidents', request, bindings());
    expect(noStepUp.status).toBe(401);
    /*
     * #1058: 再認証のやり直しは画面が自分で案内する通常の状態。
     * 管理画面がセッション喪失モーダルと区別できるよう機械コードを付ける。
     */
    await expect(noStepUp.json()).resolves.toMatchObject({
      success: false,
      code: 'STEP_UP_REQUIRED',
    });

    const noKey = stopRequest();
    const noKeyHeaders = { ...(noKey.headers as Record<string, string>) };
    delete noKeyHeaders['idempotency-key'];
    noKey.headers = noKeyHeaders;
    expect((await app().request('/api/operations/incidents', noKey, bindings())).status).toBe(400);
  });

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
      '/api/operations/incidents', stopRequest('account-1', 'step-up-admin'), bindings(),
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
          'x-step-up-token': 'step-up-restore',
          'idempotency-key': 'restore-request-1',
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

  it('影響人数の読み取りGETを繰り返しても監査記録を増やさない', async () => {
    for (let i = 0; i < 3; i += 1) {
      const response = await app('owner').request(
        '/api/operations/control/preview?account_id=account-1', {}, bindings(),
      );
      expect(response.status).toBe(200);
    }

    const auditCount = () => (testDb.raw.prepare(
      `SELECT COUNT(*) AS n FROM operation_audit WHERE target_kind = 'emergency_control'`,
    ).get() as { n: number }).n;
    expect(auditCount()).toBe(0);

    // 操作・判断を伴う更新(停止)は従来どおり操作履歴へ記録する
    const stopped = await app('owner').request(
      '/api/operations/incidents', stopRequest('account-1'), bindings(),
    );
    expect(stopped.status).toBe(201);
    const incidents = testDb.raw.prepare(
      `SELECT COUNT(*) AS n FROM operation_incidents WHERE line_account_id = 'account-1'`,
    ).get() as { n: number };
    expect(incidents.n).toBeGreaterThan(0);
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
          'x-step-up-token': 'step-up-restore',
          'idempotency-key': 'restore-request-1',
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

  it('同じ停止要求を二重実行せず、LINEとメールを別キューへ積む', async () => {
    const first = await app().request('/api/operations/incidents', stopRequest(), bindings());
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { data: { incident: { id: string } } };

    const replay = await app().request('/api/operations/incidents', stopRequest(), bindings());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      success: true,
      duplicate: true,
      data: { incident: { id: firstBody.data.incident.id } },
    });
    const jobs = testDb.raw.prepare(
      `SELECT channel, status FROM operation_notification_outbox
        WHERE incident_id = ? ORDER BY channel`,
    ).all(firstBody.data.incident.id) as Array<{ channel: string; status: string }>;
    expect(jobs).toEqual([
      { channel: 'email', status: 'queued' },
      { channel: 'line', status: 'queued' },
    ]);
  });
});

describe('N-451 復旧前検査と安全な復旧', () => {
  function addBroadcast(id: string, scheduledAt: string | null = '2099-01-01T00:00:00.000Z', accountId = 'account-1') {
    testDb.raw.prepare(
      `INSERT INTO broadcasts (id, title, message_type, message_content, status, scheduled_at, line_account_id)
       VALUES (?, ?, 'text', 'body', 'scheduled', ?, ?)`,
    ).run(id, `broadcast-${id}`, scheduledAt, accountId);
  }

  async function stopNow(capabilities = ['broadcast_dispatch']) {
    const response = await app().request('/api/operations/incidents', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-confirm-irreversible': 'operation-stop',
        'x-step-up-token': 'step-up-stop',
        'idempotency-key': `stop-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        lineAccountId: 'account-1',
        capabilities,
        reason: '誤配信の防止',
        expectedVersion: 0,
        confirmation: '停止',
      }),
    }, bindings());
    expect(response.status).toBe(201);
    return (await response.json()) as {
      data: { control: { version: number }; incident: { id: string } };
    };
  }

  function restoreRequest(incidentId: string, expectedVersion: number, key: string, token: string): RequestInit {
    return {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-confirm-irreversible': 'operation-restore',
        'x-step-up-token': token,
        'idempotency-key': key,
      },
      body: JSON.stringify({ expectedVersion, confirmation: '復旧' }),
    };
  }

  it('restore-preview が停止中の編集・追加・期限切れを実routeで返す', async () => {
    addBroadcast('b-changed');
    addBroadcast('b-expired');
    const stopped = await stopNow(['broadcast_dispatch', 'scenario_dispatch']);
    const incidentId = stopped.data.incident.id;
    // 停止中の編集・追加・期限切れ（期限切れは停止時に存在した予約が時間切れになる）
    testDb.raw.prepare(`UPDATE broadcasts SET title = 'edited', lock_version = lock_version + 1 WHERE id = 'b-changed'`).run();
    addBroadcast('b-added');
    testDb.raw.prepare(`UPDATE broadcasts SET scheduled_at = '2000-01-01T00:00:00.000Z' WHERE id = 'b-expired'`).run();

    const preview = await app('admin').request(
      `/api/operations/incidents/${incidentId}/restore-preview`,
      { method: 'POST' },
      bindings(),
    );
    expect(preview.status).toBe(200);
    const body = await preview.json() as {
      data: {
        drift: {
          resumable: string[];
          capabilities: Array<{ capability: string; blocked: boolean; drift: Array<{ id: string; kind: string }> }>;
        };
      };
    };
    const broadcast = body.data.drift.capabilities.find((entry) => entry.capability === 'broadcast_dispatch')!;
    expect(broadcast.blocked).toBe(true);
    expect(broadcast.drift).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'b-changed', kind: 'changed' }),
      expect.objectContaining({ id: 'b-added', kind: 'added' }),
      expect.objectContaining({ id: 'b-expired', kind: 'expired' }),
    ]));
    // 変更の無いシナリオは再開可能
    expect(body.data.drift.resumable).toEqual(['scenario_dispatch']);
  });

  it('復旧も再認証grantが無効なら401にSTEP_UP_REQUIREDを付ける(#1058)', async () => {
    const stopped = await stopNow();
    // 期限切れ・別人のgrantなど、consumeできないtokenはすべて同じ口で弾く。
    const res = await app().request(
      `/api/operations/incidents/${stopped.data.incident.id}/restore`,
      restoreRequest(stopped.data.incident.id, stopped.data.control.version, 'restore-no-grant', 'no-such-grant'),
      bindings(),
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      code: 'STEP_UP_REQUIRED',
    });
  });

  it('restore-preview は権限・範囲・停止中以外を拒否する', async () => {
    const stopped = await stopNow();
    const incidentId = stopped.data.incident.id;
    const request = { method: 'POST' } as const;

    expect((await app('staff').request(
      `/api/operations/incidents/${incidentId}/restore-preview`, request, bindings(),
    )).status).toBe(403);
    expect((await app('admin', false).request(
      `/api/operations/incidents/${incidentId}/restore-preview`, request, bindings(),
    )).status).toBe(403);
    expect((await app().request(
      '/api/operations/incidents/no-such/restore-preview', request, bindings(),
    )).status).toBe(404);

    // 復旧済みのincidentは検査対象ではない
    await app().request(
      `/api/operations/incidents/${incidentId}/restore`,
      restoreRequest(incidentId, stopped.data.control.version, 'restore-done', 'step-up-restore'),
      bindings(),
    );
    expect((await app().request(
      `/api/operations/incidents/${incidentId}/restore-preview`, request, bindings(),
    )).status).toBe(409);
  });

  it('変更のある能力だけを止めたままにし、残りは実routeで復旧する', async () => {
    addBroadcast('b-1');
    const stopped = await stopNow(['broadcast_dispatch', 'scenario_dispatch']);
    testDb.raw.prepare(`UPDATE broadcasts SET title = 'edited', lock_version = lock_version + 1 WHERE id = 'b-1'`).run();

    const restored = await app().request(
      `/api/operations/incidents/${stopped.data.incident.id}/restore`,
      restoreRequest(stopped.data.incident.id, stopped.data.control.version, 'restore-partial', 'step-up-restore'),
      bindings(),
    );
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      success: true,
      data: {
        status: 'partial',
        control: { states: { broadcast_dispatch: 'stopped', scenario_dispatch: 'running' } },
        report: { resumed: ['scenario_dispatch'], remaining: ['broadcast_dispatch'] },
      },
    });
    // incidentは停止中のまま
    const incident = await app().request(
      `/api/operations/incidents/${stopped.data.incident.id}`, {}, bindings(),
    );
    expect(await incident.json()).toMatchObject({ data: { status: 'stopped' } });
  });

  it('全ての能力がずれているときは409で理由を返し、直せば同じキーで再試行できる', async () => {
    addBroadcast('b-1');
    const stopped = await stopNow(['broadcast_dispatch']);
    testDb.raw.prepare(`UPDATE broadcasts SET title = 'edited', lock_version = lock_version + 1 WHERE id = 'b-1'`).run();

    const blocked = await app().request(
      `/api/operations/incidents/${stopped.data.incident.id}/restore`,
      restoreRequest(stopped.data.incident.id, stopped.data.control.version, 'restore-blocked', 'step-up-restore'),
      bindings(),
    );
    expect(blocked.status).toBe(409);
    const blockedBody = await blocked.json() as {
      code: string;
      data: { report: { drift: { capabilities: Array<{ capability: string; drift: Array<{ kind: string }> }> } } };
    };
    expect(blockedBody.code).toBe('OPERATION_RESTORE_BLOCKED');
    expect(blockedBody.data.report.drift.capabilities[0].drift).toEqual([
      expect.objectContaining({ kind: 'changed' }),
    ]);
    // 制御状態もincidentも変えない
    const control = await app().request('/api/operations/control?account_id=account-1', {}, bindings());
    expect(await control.json()).toMatchObject({
      data: { states: { broadcast_dispatch: 'stopped' }, activeIncidentId: stopped.data.incident.id },
    });

    // 運用者が対象を下書きへ戻す（=稼働対象から外れる）と、同じキーの再試行が復旧できる
    testDb.raw.prepare(`UPDATE broadcasts SET status = 'draft', scheduled_at = NULL WHERE id = 'b-1'`).run();
    const retry = await app().request(
      `/api/operations/incidents/${stopped.data.incident.id}/restore`,
      restoreRequest(stopped.data.incident.id, stopped.data.control.version, 'restore-blocked', 'step-up-restore-b'),
      bindings(),
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ data: { status: 'restored', incident: { status: 'resolved' } } });
  });

  it('期限切れの予約は下書きへ戻し、復旧しても過去時刻を送らせない', async () => {
    addBroadcast('b-expired');
    const stopped = await stopNow(['broadcast_dispatch']);
    testDb.raw.prepare(`UPDATE broadcasts SET scheduled_at = '2000-01-01T00:00:00.000Z' WHERE id = 'b-expired'`).run();

    const restored = await app().request(
      `/api/operations/incidents/${stopped.data.incident.id}/restore`,
      restoreRequest(stopped.data.incident.id, stopped.data.control.version, 'restore-expired', 'step-up-restore'),
      bindings(),
    );
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      data: { status: 'restored', report: { heldExpired: [{ id: 'b-expired' }] } },
    });
    expect(testDb.raw.prepare(`SELECT status FROM broadcasts WHERE id = 'b-expired'`).get())
      .toMatchObject({ status: 'draft' });
  });

  it('復旧の冪等再実行は完了済みの結果をそのまま返し、別内容の同キーは拒否する', async () => {
    const stopped = await stopNow(['broadcast_dispatch']);
    const incidentId = stopped.data.incident.id;
    const version = stopped.data.control.version;

    const first = await app().request(
      `/api/operations/incidents/${incidentId}/restore`,
      restoreRequest(incidentId, version, 'restore-same', 'step-up-restore'),
      bindings(),
    );
    expect(first.status).toBe(200);

    // 同じ内容の再実行は step-up 不要で前回の結果を返す
    const replay = await app().request(
      `/api/operations/incidents/${incidentId}/restore`,
      restoreRequest(incidentId, version, 'restore-same', 'no-step-up-needed'),
      bindings(),
    );
    expect(replay.status).toBe(200);
    // N-451: 再実行でも最初の検査結果（report）を返す。落とすと画面が成功と誤認する。
    expect(await replay.json()).toMatchObject({
      duplicate: true,
      data: {
        status: 'restored',
        incident: { id: incidentId, status: 'resolved' },
        report: { resumed: ['broadcast_dispatch'], remaining: [] },
      },
    });

    // 同じキーで別内容（別の版）は拒否する
    const other = await app().request(
      `/api/operations/incidents/${incidentId}/restore`,
      restoreRequest(incidentId, version + 1, 'restore-same', 'step-up-restore-b'),
      bindings(),
    );
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});

describe('運用状態checkと配備履歴', () => {
  function seedFreshDispatcherHeartbeats(now: string): void {
    const insert = testDb.raw.prepare(
      `INSERT INTO operation_dispatcher_heartbeats
         (job_name, last_started_at, last_completed_at, last_status, updated_at)
       VALUES (?, ?, ?, 'succeeded', ?)`,
    );
    for (const jobName of DELIVERY_DISPATCH_JOB_NAMES) insert.run(jobName, now, now, now);
  }

  it('未実行はunknown/stale、権限外scopeは403で返す', async () => {
    const empty = await app('admin').request(
      '/api/operations/health?account_id=account-1', {}, bindings(),
    );
    expect(await empty.json()).toMatchObject({
      success: true,
      data: { latestRun: null, overallStatus: 'stale', lastCheckedAt: null, nextCheckAt: null },
    });

    testDb.raw.prepare("INSERT INTO tenants (id, name) VALUES ('tenant-2', '統括2')").run();
    testDb.raw.prepare("UPDATE line_accounts SET tenant_id = 'tenant-2' WHERE id = 'account-1'").run();
    expect((await app('admin', true, 'tenant-1').request(
      '/api/operations/health?account_id=account-1', {}, bindings(),
    )).status).toBe(403);
  });

  it('同じ5分窓の手動checkを冪等化し、9項目を実データで保存する', async () => {
    const now = new Date().toISOString();
    testDb.raw.prepare(
      `INSERT INTO account_health_logs
         (id, line_account_id, error_code, error_count, check_period, risk_level, created_at)
       VALUES ('health-1', 'account-1', NULL, 0, '5m', 'normal', ?)`,
    ).run(now);
    testDb.raw.prepare(
      `INSERT INTO friend_daily_snapshots
         (date, line_account_id, active, total, added, blocked)
       VALUES ('2026-09-06', 'account-1', 100, 100, 2, 1),
              ('2026-09-07', 'account-1', 102, 102, 3, 1)`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO line_webhook_events
         (webhook_event_id, line_account_id, event_type, status, received_at, updated_at)
       VALUES ('webhook-1', 'account-1', 'message', 'succeeded', ?, ?)`,
    ).run(now, now);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/quota/consumption')) return Response.json({ totalUsage: 100 });
      return Response.json({ type: 'limited', value: 1_000 });
    }));

    const request = {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-1' }),
    };
    const first = await app('admin').request('/api/operations/health/runs', request, bindings());
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { data: { latestRun: { id: string; results: unknown[] } } };
    expect(firstBody.data.latestRun.results).toHaveLength(9);
    const second = await app('admin').request('/api/operations/health/runs', request, bindings());
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      success: true,
      duplicate: true,
      data: { latestRun: { id: firstBody.data.latestRun.id } },
    });
  });

  it('実routeでもautomation以外の配信遅延をdangerで返す', async () => {
    const now = '2026-09-15T03:00:00.000Z';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    seedFreshDispatcherHeartbeats(now);
    testDb.raw.prepare(
      `INSERT INTO broadcasts
         (id, title, message_type, message_content, target_type, status, scheduled_at,
          created_at, line_account_id)
       VALUES ('broadcast-delayed', '遅延', 'text', '{}', 'all', 'scheduled', ?, ?, 'account-1')`,
    ).run('2026-09-15T01:00:00.000Z', '2026-09-15T01:00:00.000Z');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      return String(input).endsWith('/quota/consumption')
        ? Response.json({ totalUsage: 100 })
        : Response.json({ type: 'limited', value: 1_000 });
    }));

    const response = await app('admin').request('/api/operations/health/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-1', now }),
    }, bindings());
    expect(response.status).toBe(201);
    const body = await response.json() as {
      data: { latestRun: { results: Array<{ checkKey: string; status: string; value: unknown }> } };
    };
    expect(body.data.latestRun.results.find(({ checkKey }) => checkKey === 'dispatch_jobs'))
      .toMatchObject({ status: 'danger', value: { pendingCount: 1, delayMinutes: 120 } });
  });

  it('配信jobの取得失敗を実routeでnormalにしない', async () => {
    const now = '2026-09-15T03:00:00.000Z';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    seedFreshDispatcherHeartbeats(now);
    testDb.raw.exec('DROP TABLE broadcasts');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ type: 'limited', value: 1_000 })));

    const response = await app('admin').request('/api/operations/health/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-1', now }),
    }, bindings());
    expect(response.status).toBe(201);
    const body = await response.json() as {
      data: { latestRun: { results: Array<{ checkKey: string; status: string }> } };
    };
    expect(body.data.latestRun.results.find(({ checkKey }) => checkKey === 'dispatch_jobs'))
      .toMatchObject({ status: 'unknown' });
  });

  it('署名なしの配備eventを拒否し、署名済みeventを履歴へ一度だけ追加する', async () => {
    const body = JSON.stringify({
      deploymentId: 'deploy-1', phase: 'succeeded', environment: 'staging',
      toCommit: 'abc123', version: 'v1.2.3', migrations: ['314'],
      rollbackAvailable: true, pullRequest: 1133, releaseSummary: '運用状態を更新',
      actor: 'github-actions', occurredAt: new Date().toISOString(), smokeCheck: { status: 'ok' },
    });
    const secret = 'operations-signing-secret-is-at-least-32-bytes';
    expect((await app().request('/api/internal/deployments/events', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    }, bindings({ OPERATIONS_DEPLOYMENT_SIGNING_SECRET: secret }))).status).toBe(401);

    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await signOperationsEvent(secret, timestamp, body);
    const signed = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-operations-timestamp': timestamp,
        'x-operations-signature': signature,
      },
      body,
    };
    expect((await app().request(
      '/api/internal/deployments/events', signed, bindings({ OPERATIONS_DEPLOYMENT_SIGNING_SECRET: secret }),
    )).status).toBe(201);
    expect((await app().request(
      '/api/internal/deployments/events', signed, bindings({ OPERATIONS_DEPLOYMENT_SIGNING_SECRET: secret }),
    )).status).toBe(200);
    const history = await app('admin').request('/api/operations/history', {}, bindings());
    expect(await history.json()).toMatchObject({
      success: true,
      data: [expect.objectContaining({ historyKind: 'deployment', reason: '運用状態を更新' })],
    });
  });
});

describe('運用異常alertのaccount境界と受領', () => {
  function seedAlert(): void {
    testDb.raw.prepare(
      `INSERT INTO operation_health_runs
         (id, scope_key, line_account_id, window_started_at, source, status, overall_status, started_at, completed_at)
       VALUES ('run-alert-1', 'account-1', 'account-1', '2026-09-16T00:00:00.000Z',
               'scheduled', 'completed', 'warning', '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO operation_alerts
         (id, line_account_id, check_key, status, severity, summary, source_run_id,
          first_detected_at, last_detected_at, version, reopened_count, created_at, updated_at)
       VALUES ('alert-1', 'account-1', 'webhook', 'open', 'warning', 'Webhook受信に失敗があります',
               'run-alert-1', '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z', 1, 0,
               '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO operation_alert_events
         (id, alert_id, line_account_id, source_run_id, action, severity, summary, alert_version, created_at)
       VALUES ('alert-event-1', 'alert-1', 'account-1', 'run-alert-1', 'opened', 'warning',
               'Webhook受信に失敗があります', 1, '2026-09-16T00:00:00.000Z')`,
    ).run();
  }

  function seedScopedAdmin(accountId: string): void {
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, role, api_key, account_scope)
       VALUES ('admin-1', 'Admin', 'admin', 'admin-alert-key', 'accounts')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
       VALUES ('admin-1', ?, '2026-09-16T00:00:00.000Z')`,
    ).run(accountId);
  }

  it('owner/admin以外には一覧も受領も返さない', async () => {
    seedAlert();
    expect((await app('staff').request(
      '/api/operations/alerts?account_id=account-1', {}, bindings(),
    )).status).toBe(403);
    expect((await app('staff').request('/api/operations/alerts/alert-1/acknowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-1', expectedVersion: 1 }),
    }, bindings())).status).toBe(403);
  });

  it('割当account内だけ一覧と受領を許可し、actor/noteを保存する', async () => {
    seedAlert();
    seedScopedAdmin('account-1');

    const listed = await app('admin').request(
      '/api/operations/alerts?account_id=account-1', {}, bindings(),
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      success: true,
      data: [expect.objectContaining({ id: 'alert-1', status: 'open', version: 1 })],
    });

    const acknowledged = await app('admin').request('/api/operations/alerts/alert-1/acknowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-1', expectedVersion: 1, note: 'Webhook設定を確認中' }),
    }, bindings());
    expect(acknowledged.status).toBe(200);
    expect(await acknowledged.json()).toMatchObject({
      success: true,
      data: {
        status: 'acknowledged', version: 2,
        acknowledgedById: 'admin-1', acknowledgementNote: 'Webhook設定を確認中',
      },
    });

    const conflicting = await app('owner').request('/api/operations/alerts/alert-1/acknowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-1', expectedVersion: 2, note: '別の担当内容' }),
    }, bindings());
    expect(conflicting.status).toBe(409);
    expect(await conflicting.json()).toMatchObject({ success: false, code: 'VERSION_CONFLICT' });
  });

  it('別accountだけを割り当てたadminの一覧・受領・通知再開を構造化403にする', async () => {
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-2', 'channel-2', 'LINE 2', 'token', 'secret')`,
    ).run();
    seedAlert();
    seedScopedAdmin('account-2');

    const list = await app('admin').request(
      '/api/operations/alerts?account_id=account-1', {}, bindings(),
    );
    expect(list.status).toBe(403);
    expect(await list.json()).toMatchObject({ success: false, code: 'EMERGENCY_SCOPE_FORBIDDEN' });

    for (const path of [
      '/api/operations/alerts/alert-1/acknowledge',
      '/api/operations/alerts/alert-1/notifications/retry',
    ]) {
      const response = await app('admin').request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lineAccountId: 'account-1', expectedVersion: 1 }),
      }, bindings());
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ success: false, code: 'EMERGENCY_SCOPE_FORBIDDEN' });
    }
  });

  it('別accountの実在alert IDと架空IDを、受領・通知再開とも同じ404にする', async () => {
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-2', 'channel-2', 'LINE 2', 'token', 'secret')`,
    ).run();
    seedAlert();

    for (const suffix of ['acknowledge', 'notifications/retry']) {
      const responses = await Promise.all(['alert-1', 'alert-does-not-exist'].map((id) =>
        app('owner').request(`/api/operations/alerts/${id}/${suffix}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lineAccountId: 'account-2', expectedVersion: 1 }),
        }, bindings()),
      ));
      expect(responses.map(({ status }) => status)).toEqual([404, 404]);
      expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
        { success: false, error: '異常の記録が見つかりません' },
        { success: false, error: '異常の記録が見つかりません' },
      ]);
    }
  });

  it('解消済みalertの通知失敗も取得し、運用画面から再送待ちへ戻す', async () => {
    seedAlert();
    testDb.raw.prepare(
      "UPDATE operation_alerts SET status = 'resolved', resolved_at = '2026-09-16T00:10:00.000Z', version = 2 WHERE id = 'alert-1'",
    ).run();
    testDb.raw.prepare(
      `INSERT INTO operation_alert_notification_outbox
         (id, event_id, line_account_id, staff_id, channel, status, attempt_count,
          next_attempt_at, last_error, created_at, updated_at)
       VALUES ('alert-outbox-1', 'alert-event-1', 'account-1', 'owner-1', 'email', 'failed', 1,
               '2026-09-16T00:05:00.000Z', 'provider unavailable',
               '2026-09-16T00:00:00.000Z', '2026-09-16T00:05:00.000Z')`,
    ).run();

    const activeOnly = await app('owner').request(
      '/api/operations/alerts?account_id=account-1', {}, bindings(),
    );
    expect(await activeOnly.json()).toMatchObject({ success: true, data: [] });
    const withResolved = await app('owner').request(
      '/api/operations/alerts?account_id=account-1&include_resolved=1', {}, bindings(),
    );
    const withResolvedBody = await withResolved.json() as {
      success: boolean;
      data: Array<{ id: string; status: string; notification: { failed: number; total: number } }>;
    };
    expect(withResolvedBody.success).toBe(true);
    expect(withResolvedBody.data).toHaveLength(1);
    expect(withResolvedBody.data[0]).toMatchObject({
      id: 'alert-1', status: 'resolved', notification: { failed: 1, total: 1 },
    });

    const retried = await app('owner').request('/api/operations/alerts/alert-1/notifications/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-1' }),
    }, bindings());
    expect(await retried.json()).toMatchObject({ success: true, data: { retried: 1 } });
    expect(testDb.raw.prepare(
      "SELECT status, last_error FROM operation_alert_notification_outbox WHERE id = 'alert-outbox-1'",
    ).get()).toEqual({ status: 'queued', last_error: null });
  });
});

describe('停止不可理由の機械コード(N-453/N-455)', () => {
  async function grant(token: string, staffId: string): Promise<void> {
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    testDb.raw.prepare(
      `INSERT INTO auth_step_up_grants (token_hash, staff_id, purpose, expires_at, created_at)
       VALUES (?, ?, 'operations.control', ?, ?)`,
    ).run(await hash(token), staffId, expiresAt, new Date().toISOString());
  }

  function stopBody(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      lineAccountId: 'account-1',
      capabilities: ['broadcast_dispatch'],
      reason: '障害対応',
      expectedVersion: 0,
      confirmation: '停止',
      ...overrides,
    });
  }

  function stopInit(stepUpToken: string, key: string, body: string): RequestInit {
    return {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-confirm-irreversible': 'operation-stop',
        'x-step-up-token': stepUpToken,
        'idempotency-key': key,
      },
      body,
    };
  }

  it('停止可のときpreviewは理由コードなし、停止不可のとき理由コード付きで返す', async () => {
    const ownerPreview = await app('owner').request(
      '/api/operations/control/preview?account_id=account-1', {}, bindings(),
    );
    expect(ownerPreview.status).toBe(200);
    expect(await ownerPreview.json()).toMatchObject({
      success: true,
      data: { permissions: { canControl: true, reasonCode: null } },
    });

    const blockedPreview = await app('admin', false).request(
      '/api/operations/control/preview?account_id=account-1', {}, bindings(),
    );
    expect(blockedPreview.status).toBe(200);
    expect(await blockedPreview.json()).toMatchObject({
      success: true,
      data: { permissions: { canControl: false, reasonCode: 'EMERGENCY_CONTROL_FORBIDDEN' } },
    });
  });

  it('停止不可の403に機械コードを付けて返す', async () => {
    const forbidden = await app('admin', false).request(
      '/api/operations/incidents', stopRequest('account-1'), bindings(),
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({
      success: false,
      code: 'EMERGENCY_CONTROL_FORBIDDEN',
    });

    const outOfScope = await app('admin').request(
      '/api/operations/incidents', stopRequest(null, 'step-up-admin'), bindings(),
    );
    expect(outOfScope.status).toBe(403);
    expect(await outOfScope.json()).toMatchObject({
      success: false,
      code: 'EMERGENCY_SCOPE_FORBIDDEN',
    });
  });

  it('古い版の停止を409と最新状態で返す', async () => {
    const first = await app().request(
      '/api/operations/incidents', stopRequest('account-1'), bindings(),
    );
    expect(first.status).toBe(201);

    await grant('step-up-stop-2', 'owner-1');
    const stale = await app().request(
      '/api/operations/incidents',
      stopInit('step-up-stop-2', 'stop-request-2', stopBody({ expectedVersion: 0 })),
      bindings(),
    );
    expect(stale.status).toBe(409);
    const staleBody = await stale.json() as {
      success: boolean; code: string; data: { version: number };
    };
    expect(staleBody).toMatchObject({
      success: false,
      code: 'VERSION_CONFLICT',
      data: { version: 1 },
    });
  });

  it('停止→復旧のあと古い版で停止すると、activeIncidentIdに頼らず版比較だけで409になる', async () => {
    // 1. 停止(expectedVersion:0) → version=1, activeIncidentIdが付く。
    const stopped = await app().request(
      '/api/operations/incidents', stopRequest('account-1'), bindings(),
    );
    expect(stopped.status).toBe(201);
    const stoppedBody = await stopped.json() as {
      data: { control: { version: number }; incident: { id: string } };
    };
    expect(stoppedBody.data.control.version).toBe(1);

    // 2. 復旧(expectedVersion:1) → version=2, activeIncidentIdはnullへ戻る。
    const restored = await app().request(
      `/api/operations/incidents/${stoppedBody.data.incident.id}/restore`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-confirm-irreversible': 'operation-restore',
          'x-step-up-token': 'step-up-restore',
          'idempotency-key': 'restore-request-1',
        },
        body: JSON.stringify({ expectedVersion: 1, confirmation: '復旧' }),
      },
      bindings(),
    );
    expect(restored.status).toBe(200);
    const restoredBody = await restored.json() as {
      data: { control: { version: number; activeIncidentId: string | null } };
    };
    expect(restoredBody.data.control.version).toBe(2);
    expect(restoredBody.data.control.activeIncidentId).toBeNull();

    // 3. activeIncidentIdがnullのまま、古い版(1)で再び停止を試みる。
    //    ここでの409はactiveIncidentIdの門を通らないので、版比較だけが理由になる。
    await grant('step-up-stop-3', 'owner-1');
    const stale = await app().request(
      '/api/operations/incidents',
      stopInit('step-up-stop-3', 'stop-request-3', stopBody({ expectedVersion: 1 })),
      bindings(),
    );
    expect(stale.status).toBe(409);
    const staleBody = await stale.json() as {
      success: boolean; code: string; data: { version: number; activeIncidentId: string | null };
    };
    expect(staleBody).toMatchObject({ success: false, code: 'VERSION_CONFLICT' });
    // 版比較だけが効いたことの証拠: 競合を返した時点でactiveIncidentIdはnullのまま。
    expect(staleBody.data.activeIncidentId).toBeNull();
    expect(staleBody.data.version).toBe(2);
  });

  it('再実行キーの使い回しを409と機械コードで返す', async () => {
    expect((await app().request(
      '/api/operations/incidents', stopRequest('account-1'), bindings(),
    )).status).toBe(201);

    await grant('step-up-stop-2', 'owner-1');
    const reused = await app().request(
      '/api/operations/incidents',
      stopInit('step-up-stop-2', 'stop-request-1', stopBody({ reason: '別の理由' })),
      bindings(),
    );
    expect(reused.status).toBe(409);
    expect(await reused.json()).toMatchObject({
      success: false,
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('停止していない復旧を409と機械コードで返す', async () => {
    const stopped = await app().request(
      '/api/operations/incidents', stopRequest('account-1'), bindings(),
    );
    const stoppedBody = await stopped.json() as {
      data: { control: { version: number }; incident: { id: string } };
    };
    const restoreHeaders = {
      'content-type': 'application/json',
      'x-confirm-irreversible': 'operation-restore',
      'x-step-up-token': 'step-up-restore',
      'idempotency-key': 'restore-request-1',
    };
    const restored = await app().request(
      `/api/operations/incidents/${stoppedBody.data.incident.id}/restore`,
      {
        method: 'POST',
        headers: restoreHeaders,
        body: JSON.stringify({
          expectedVersion: stoppedBody.data.control.version,
          confirmation: '復旧',
        }),
      },
      bindings(),
    );
    expect(restored.status).toBe(200);

    await grant('step-up-restore-2', 'owner-1');
    const again = await app().request(
      `/api/operations/incidents/${stoppedBody.data.incident.id}/restore`,
      {
        method: 'POST',
        headers: {
          ...restoreHeaders,
          'x-step-up-token': 'step-up-restore-2',
          'idempotency-key': 'restore-request-2',
        },
        body: JSON.stringify({ expectedVersion: 2, confirmation: '復旧' }),
      },
      bindings(),
    );
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({
      success: false,
      code: 'OPERATION_NOT_STOPPED',
    });
  });
});

describe('W: 運用状態の確認項目の追加（v6-32）', () => {
  it('月間配信数はLINEとHarnessの小さい方を送れる数にし、予定分と翌月1日(JST)のresetを返す', async () => {
    const now = '2026-09-15T05:00:00.000Z';
    testDb.raw.prepare(
      `INSERT INTO tenants (id, name, plan_key, plan_status) VALUES ('tenant-1', '統括', 'light', 'active')`,
    ).run();
    testDb.raw.prepare("UPDATE line_accounts SET tenant_id = 'tenant-1' WHERE id = 'account-1'").run();
    testDb.raw.prepare("INSERT INTO friends (id, line_account_id, line_user_id, display_name) VALUES ('f-1', 'account-1', 'U-f1', '友人1')").run();
    // light は月5,000通。Harness側で4,900通送信済みなら Harness が小さい側になる。
    const insertMessage = testDb.raw.prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, line_account_id, created_at)
       VALUES (?, 'f-1', 'outgoing', 'text', '{}', 'account-1', '2026-09-10T10:00:00')`,
    );
    for (let i = 0; i < 10; i += 1) insertMessage.run(`msg-${i}`);
    // 予定済み配信の見込み通数
    testDb.raw.prepare(
      `INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, scheduled_at, created_at, line_account_id, total_count)
       VALUES ('bc-scheduled', '予定', 'text', '{}', 'all', 'scheduled', '2026-09-16T01:00:00.000Z', '2026-09-15T01:00:00.000Z', 'account-1', 200)`,
    ).run();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/quota/consumption')) return Response.json({ totalUsage: 100 });
      return Response.json({ type: 'limited', value: 1_000 });
    }));

    const checked = await import('../services/operations-health.js').then(({ runOperationHealthChecks }) =>
      runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now }));
    const quota = checked.run.results.find((result) => result.checkKey === 'message_quota');
    // LINE: 残900。Harness: 5,000-10=4,990。小さい方はLINEの900。forecast=900-200=700。
    expect(quota?.value).toMatchObject({
      line: { used: 100, limit: 1_000, remaining: 900 },
      harness: { used: 10, limit: 5_000, remaining: 4_990 },
      sendable: 900,
      scheduledPlanned: 200,
      forecastRemaining: 700,
      timezone: 'Asia/Tokyo',
    });
    expect(String(quota?.value?.resetAt)).toBe('2026-10-01T00:00:00+09:00');
    expect(quota?.status).toBe('normal');
  });

  it('予定分を入れて送れる数がマイナスならdanger、Harness側が小さいならそちらで判定する', async () => {
    const now = '2026-09-15T05:00:00.000Z';
    testDb.raw.prepare(
      `INSERT INTO tenants (id, name, plan_key, plan_status) VALUES ('tenant-1', '統括', 'light', 'active')`,
    ).run();
    testDb.raw.prepare("UPDATE line_accounts SET tenant_id = 'tenant-1' WHERE id = 'account-1'").run();
    testDb.raw.prepare("INSERT INTO friends (id, line_account_id, line_user_id, display_name) VALUES ('f-1', 'account-1', 'U-f1', '友人1')").run();
    const insertMessage = testDb.raw.prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, line_account_id, created_at)
       VALUES (?, 'f-1', 'outgoing', 'text', '{}', 'account-1', '2026-09-10T10:00:00')`,
    );
    for (let i = 0; i < 4_800; i += 1) insertMessage.run(`msg-${i}`);
    testDb.raw.prepare(
      `INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status, scheduled_at, created_at, line_account_id, total_count)
       VALUES ('bc-big', '予定', 'text', '{}', 'all', 'scheduled', '2026-09-16T01:00:00.000Z', '2026-09-15T01:00:00.000Z', 'account-1', 500)`,
    ).run();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/quota/consumption')) return Response.json({ totalUsage: 10 });
      return Response.json({ type: 'limited', value: 100_000 });
    }));

    const checked = await import('../services/operations-health.js').then(({ runOperationHealthChecks }) =>
      runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now }));
    const quota = checked.run.results.find((result) => result.checkKey === 'message_quota');
    // Harness: 残200。予定500で forecast=-300 → danger。
    expect(quota?.status).toBe('danger');
    expect(quota?.value).toMatchObject({ sendable: 200, forecastRemaining: -300 });
  });

  it('鍵の期限は切れていればdanger、14日以内ならwarning、未記録ならunknown', async () => {
    const { runOperationHealthChecks } = await import('../services/operations-health.js');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ type: 'unlimited' })));

    testDb.raw.prepare("UPDATE line_accounts SET token_expires_at = '2026-09-01T00:00:00.000Z' WHERE id = 'account-1'").run();
    let checked = await runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now: '2026-09-15T00:00:00.000Z' });
    expect(checked.run.results.find((r) => r.checkKey === 'credential_expiry')).toMatchObject({ status: 'danger' });

    testDb.raw.prepare("UPDATE line_accounts SET token_expires_at = '2026-09-25T05:00:00.000Z' WHERE id = 'account-1'").run();
    checked = await runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now: '2026-09-15T05:00:00.000Z' });
    expect(checked.run.results.find((r) => r.checkKey === 'credential_expiry')).toMatchObject({ status: 'warning', value: { daysLeft: 10 } });

    testDb.raw.prepare('UPDATE line_accounts SET token_expires_at = NULL WHERE id = ?').bind('account-1').run();
    checked = await runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now: '2026-09-15T10:00:00.000Z' });
    expect(checked.run.results.find((r) => r.checkKey === 'credential_expiry')).toMatchObject({ status: 'unknown' });
  });

  it('裏の仕組みの試しは1-2回の失敗では知らせず、3回連続でdangerになる', async () => {
    const { runOperationHealthChecks } = await import('../services/operations-health.js');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ type: 'unlimited' })));
    const failingR2 = {
      put: async () => { throw new Error('r2 down'); },
      get: async () => null,
      delete: async () => undefined,
    } as unknown as R2Bucket;
    const deps = { r2: failingR2 };

    const runAt = async (at: string) =>
      (await runOperationHealthChecks(testDb.db, {
        lineAccountId: 'account-1', source: 'scheduled', now: at, deps,
      })).run.results.find((result) => result.checkKey === 'infra_canary');

    // 5分窓をずらして3回実行。1・2回目は正常扱い（記録のみ）、3回目でdanger。
    expect(await runAt('2026-09-15T00:00:00.000Z')).toMatchObject({ status: 'normal', value: { consecutive: 1 } });
    expect(await runAt('2026-09-15T00:05:00.000Z')).toMatchObject({ status: 'normal', value: { consecutive: 2 } });
    expect(await runAt('2026-09-15T00:10:00.000Z')).toMatchObject({ status: 'danger', value: { consecutive: 3 } });
  });

  it('見張り自体のheartbeatを別項目として返す', async () => {
    const { runOperationHealthChecks } = await import('../services/operations-health.js');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ type: 'unlimited' })));

    // 完了した scheduled run が無い → unknown
    let checked = await runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now: '2026-09-15T00:00:00.000Z' });
    expect(checked.run.results.find((r) => r.checkKey === 'monitoring_heartbeat')).toMatchObject({ status: 'unknown' });

    // 直近10分以内に完了していれば normal
    testDb.raw.prepare(
      `INSERT INTO operation_health_runs
         (id, scope_key, line_account_id, window_started_at, source, status, overall_status, started_at, completed_at)
       VALUES ('hb-1', 'account-1', 'account-1', '2026-09-15T00:10:00.000Z', 'scheduled', 'completed', 'normal', '2026-09-15T00:10:00.000Z', '2026-09-15T00:12:00.000Z')`,
    ).run();
    checked = await runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now: '2026-09-15T00:15:00.000Z' });
    expect(checked.run.results.find((r) => r.checkKey === 'monitoring_heartbeat')).toMatchObject({ status: 'normal' });

    // 最後の完了から10分超 → danger
    checked = await runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now: '2026-09-15T00:30:00.000Z' });
    expect(checked.run.results.find((r) => r.checkKey === 'monitoring_heartbeat')).toMatchObject({ status: 'danger' });
  });

  it('友だち変化は同曜日baselineが元に戻っていれば異常にせず、小規模な減少は人数下限で止める', async () => {
    const { runOperationHealthChecks } = await import('../services/operations-health.js');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ type: 'unlimited' })));

    // 前日比 -6% だが絶対数6人 < 10 → normal（小規模は人数下限を併用）
    testDb.raw.prepare(
      `INSERT INTO friend_daily_snapshots (date, line_account_id, active, total, added, blocked)
       VALUES ('2026-09-08', 'account-1', 100, 100, 1, 0),
              ('2026-09-14', 'account-1', 100, 100, 1, 0),
              ('2026-09-15', 'account-1', 94, 94, 0, 6)`,
    ).run();
    let checked = await runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now: '2026-09-15T00:00:00.000Z' });
    expect(checked.run.results.find((r) => r.checkKey === 'friend_change')).toMatchObject({ status: 'normal' });

    // 1,000→900（-10%・100人）だが同曜日(9/8)も900台で元に戻っている → webhook欠損ではなく推移としてbaseline内
    testDb.raw.prepare('DELETE FROM friend_daily_snapshots').run();
    testDb.raw.prepare(
      `INSERT INTO friend_daily_snapshots (date, line_account_id, active, total, added, blocked)
       VALUES ('2026-09-08', 'account-1', 905, 905, 1, 0),
              ('2026-09-14', 'account-1', 1000, 1000, 1, 0),
              ('2026-09-15', 'account-1', 900, 900, 0, 100)`,
    ).run();
    checked = await runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now: '2026-09-15T05:00:00.000Z' });
    expect(checked.run.results.find((r) => r.checkKey === 'friend_change')).toMatchObject({ status: 'normal' });

    // 前日比も同曜日比も大きな減少 → danger
    testDb.raw.prepare('DELETE FROM friend_daily_snapshots').run();
    testDb.raw.prepare(
      `INSERT INTO friend_daily_snapshots (date, line_account_id, active, total, added, blocked)
       VALUES ('2026-09-08', 'account-1', 1000, 1000, 1, 0),
              ('2026-09-14', 'account-1', 1000, 1000, 1, 0),
              ('2026-09-15', 'account-1', 890, 890, 0, 110)`,
    ).run();
    checked = await runOperationHealthChecks(testDb.db, { lineAccountId: 'account-1', source: 'manual', now: '2026-09-15T10:00:00.000Z' });
    expect(checked.run.results.find((r) => r.checkKey === 'friend_change')).toMatchObject({ status: 'danger' });
  });
});

describe('繰り返し通知の止め方（同じ知らせが5分ごとに鳴らない）', () => {
  function unlimitedQuota(): void {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/quota/consumption')) return Response.json({ totalUsage: 0 });
      return Response.json({ type: 'unlimited' });
    }));
  }

  it('Webhookは受信ゼロだけでは知らせず、普段あるのに24時間止まったときだけ注意にする', async () => {
    const { runOperationHealthChecks } = await import('../services/operations-health.js');
    unlimitedQuota();

    // 誰も送ってこなかっただけの状態。静かな時間帯ごとに鳴らさない。
    const quiet = await runOperationHealthChecks(testDb.db, {
      lineAccountId: 'account-1', source: 'scheduled', now: '2026-09-15T00:00:00.000Z',
    });
    expect(quiet.run.results.find((r) => r.checkKey === 'webhook')).toMatchObject({
      status: 'normal',
      value: { eventCount: 0, received24h: 0, received7d: 0, lastReceivedAt: null },
    });

    // 3日前までは受信があるのに、直近24時間は1件も無い → 本当に止まっている疑い。
    testDb.raw.prepare(
      `INSERT INTO line_webhook_events
         (webhook_event_id, line_account_id, event_type, status, received_at, updated_at)
       VALUES ('wh-old', 'account-1', 'message', 'succeeded', '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z')`,
    ).run();
    const silent = await runOperationHealthChecks(testDb.db, {
      lineAccountId: 'account-1', source: 'scheduled', now: '2026-09-15T00:05:00.000Z',
    });
    expect(silent.run.results.find((r) => r.checkKey === 'webhook')).toMatchObject({
      status: 'warning',
      value: { eventCount: 0, received24h: 0, received7d: 1, lastReceivedAt: '2026-09-12T00:00:00.000Z' },
    });
  });

  it('配信枠は使用率の高い側で判定し、残数の小さい側が入れ替わっても正常↔注意を往復しない', async () => {
    const { runOperationHealthChecks } = await import('../services/operations-health.js');
    testDb.raw.prepare(
      `INSERT INTO tenants (id, name, plan_key, plan_status) VALUES ('tenant-1', '統括', 'light', 'active')`,
    ).run();
    testDb.raw.prepare("UPDATE line_accounts SET tenant_id = 'tenant-1' WHERE id = 'account-1'").run();
    testDb.raw.prepare("INSERT INTO friends (id, line_account_id, line_user_id, display_name) VALUES ('f-1', 'account-1', 'U-f1', '友人1')").run();
    // light は月5,000通。4,150通送信済みで使用率83%（注意の域）、残り850通。
    const insertMessage = testDb.raw.prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, line_account_id, created_at)
       VALUES (?, 'f-1', 'outgoing', 'text', '{}', 'account-1', '2026-09-10T10:00:00')`,
    );
    for (let i = 0; i < 4_150; i += 1) insertMessage.run(`msg-${i}`);

    let lineUsed = 100;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/quota/consumption')) return Response.json({ totalUsage: lineUsed });
      return Response.json({ type: 'limited', value: 1_000 });
    }));

    // 1回目: LINE残900 > Harness残850。小さい側はHarness（使用率83%）。
    const first = await runOperationHealthChecks(testDb.db, {
      lineAccountId: 'account-1', source: 'scheduled', now: '2026-09-15T05:00:00.000Z',
    });
    expect(first.run.results.find((r) => r.checkKey === 'message_quota')).toMatchObject({
      status: 'warning', value: { sendable: 850 },
    });

    // 2回目: LINEを100通使って残800。小さい側がLINE（使用率20%）へ入れ替わるが、
    // Harnessの使用率83%は変わっていないので注意のまま（ここで正常に戻ると鳴り続ける）。
    lineUsed = 200;
    const second = await runOperationHealthChecks(testDb.db, {
      lineAccountId: 'account-1', source: 'scheduled', now: '2026-09-15T05:05:00.000Z',
    });
    expect(second.run.results.find((r) => r.checkKey === 'message_quota')).toMatchObject({
      status: 'warning', value: { sendable: 800 },
    });
  });

  it('データの置き場は、遅いだけなら注意にし、失敗はエラーにする', async () => {
    const { runOperationHealthChecks } = await import('../services/operations-health.js');
    unlimitedQuota();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T00:00:00.000Z'));
    // つながるが4秒かかるR2。失敗ではないので「注意」側。
    const slowR2 = {
      put: async () => { vi.advanceTimersByTime(4_000); },
      get: async () => ({ key: 'probe' }),
      delete: async () => undefined,
    } as unknown as R2Bucket;

    const runAt = async (at: string) =>
      (await runOperationHealthChecks(testDb.db, {
        lineAccountId: 'account-1', source: 'scheduled', now: at, deps: { r2: slowR2 },
      })).run.results.find((result) => result.checkKey === 'infra_canary');

    expect(await runAt('2026-09-15T00:00:00.000Z')).toMatchObject({ status: 'normal', value: { consecutive: 1 } });
    expect(await runAt('2026-09-15T00:05:00.000Z')).toMatchObject({ status: 'normal', value: { consecutive: 2 } });
    const third = await runAt('2026-09-15T00:10:00.000Z');
    expect(third).toMatchObject({ status: 'warning', value: { consecutive: 3 } });
    expect(String(third?.summary)).toContain('遅く');
  });

  it('データの置き場の異常は、3回続けて成功するまで解消にしない', async () => {
    const { runOperationHealthChecks } = await import('../services/operations-health.js');
    unlimitedQuota();
    let broken = true;
    const flakyR2 = {
      put: async () => { if (broken) throw new Error('r2 down'); },
      get: async () => ({ key: 'probe' }),
      delete: async () => undefined,
    } as unknown as R2Bucket;

    const runAt = async (at: string) =>
      (await runOperationHealthChecks(testDb.db, {
        lineAccountId: 'account-1', source: 'scheduled', now: at, deps: { r2: flakyR2 },
      })).run.results.find((result) => result.checkKey === 'infra_canary');

    await runAt('2026-09-15T00:00:00.000Z');
    await runAt('2026-09-15T00:05:00.000Z');
    expect(await runAt('2026-09-15T00:10:00.000Z')).toMatchObject({ status: 'danger' });

    // 1回・2回の成功では解消にしない（ここで解消にすると「解消→再発」が繰り返される）。
    broken = false;
    expect(await runAt('2026-09-15T00:15:00.000Z')).toMatchObject({
      status: 'danger', value: { failed: false, cleanStreak: 1 },
    });
    expect(await runAt('2026-09-15T00:20:00.000Z')).toMatchObject({
      status: 'danger', value: { failed: false, cleanStreak: 2 },
    });
    // 3回続けて成功したら正常へ戻す。
    expect(await runAt('2026-09-15T00:25:00.000Z')).toMatchObject({
      status: 'normal', value: { failed: false, cleanStreak: 3 },
    });

    // 途中で1回失敗しても、3回に届かないうちは異常のまま保つ（正常へ往復させない）。
    broken = true;
    expect(await runAt('2026-09-15T00:30:00.000Z')).toMatchObject({ status: 'normal', value: { consecutive: 1 } });
  });
});

describe('m26f: 緊急対応の失敗後回復', () => {
  function failAt(pattern: RegExp): D1Database {
    return new Proxy(testDb.db, {
      get(target, property) {
        if (property === 'prepare') {
          return (sql: string) => {
            if (pattern.test(sql)) throw new Error(`m26f injected failure: ${pattern}`);
            return (target.prepare as (sql: string) => unknown)(sql);
          };
        }
        return Reflect.get(target, property);
      },
    }) as D1Database;
  }

  async function grantStepUp(token: string, staffId = 'owner-1'): Promise<void> {
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    testDb.raw.prepare(
      `INSERT INTO auth_step_up_grants (token_hash, staff_id, purpose, expires_at, created_at)
       VALUES (?, ?, 'operations.control', ?, ?)`,
    ).run(await hash(token), staffId, expiresAt, new Date().toISOString());
  }

  function seedOpenAlert(): void {
    testDb.raw.prepare(
      `INSERT INTO operation_health_runs
         (id, scope_key, line_account_id, window_started_at, source, status, overall_status, started_at, completed_at)
       VALUES ('run-m26f', 'account-1', 'account-1', '2026-09-16T00:00:00.000Z',
               'scheduled', 'completed', 'warning', '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO operation_alerts
         (id, line_account_id, check_key, status, severity, summary, source_run_id,
          first_detected_at, last_detected_at, version, reopened_count, created_at, updated_at)
       VALUES ('alert-m26f', 'account-1', 'webhook', 'open', 'warning', 'Webhook受信に失敗があります',
               'run-m26f', '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z', 1, 0,
               '2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO operation_alert_events
         (id, alert_id, line_account_id, source_run_id, action, severity, summary, alert_version, created_at)
       VALUES ('alert-event-m26f', 'alert-m26f', 'account-1', 'run-m26f', 'opened', 'warning',
               'Webhook受信に失敗があります', 1, '2026-09-16T00:00:00.000Z')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, role, api_key, line_user_id)
       VALUES ('owner-1', 'Owner', 'owner', 'owner-m26f-key', 'U-owner-m26f')`,
    ).run();
  }

  function ackInit(): RequestInit {
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-1', expectedVersion: 1, note: '受領テスト' }),
    };
  }

  function stopInit(stepUpToken: string, key: string, capabilities: string[] = ['broadcast_dispatch']): RequestInit {
    return {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-confirm-irreversible': 'operation-stop',
        'x-step-up-token': stepUpToken,
        'idempotency-key': key,
      },
      body: JSON.stringify({
        lineAccountId: 'account-1',
        capabilities,
        reason: '障害対応テスト',
        expectedVersion: 0,
        confirmation: '停止',
      }),
    };
  }

  function restoreInit(stepUpToken: string, key: string, incidentId: string, expectedVersion: number): { path: string; init: RequestInit } {
    return {
      path: `/api/operations/incidents/${incidentId}/restore`,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-confirm-irreversible': 'operation-restore',
          'x-step-up-token': stepUpToken,
          'idempotency-key': key,
        },
        body: JSON.stringify({ expectedVersion, confirmation: '復旧' }),
      },
    };
  }

  it('R571: 結果保存の失敗後に同じ5分枠で押し直すと確認処理を再実行する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ type: 'unlimited' })));
    const healthInit: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-1' }),
    };

    const failed = await app().request(
      '/api/operations/health/runs', healthInit,
      bindings({ DB: failAt(/INSERT OR REPLACE INTO operation_health_results/) }),
    );
    expect(failed.status).toBe(500);
    expect(testDb.raw.prepare('SELECT status FROM operation_health_runs').get()).toEqual({ status: 'failed' });

    const retried = await app().request('/api/operations/health/runs', healthInit, bindings());
    expect(retried.status).toBe(201);
    expect(await retried.json()).toMatchObject({ success: true, duplicate: false });
    expect(testDb.raw.prepare('SELECT status FROM operation_health_runs').get()).toEqual({ status: 'completed' });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM operation_health_runs').get()).toEqual({ n: 1 });
    expect(
      (testDb.raw.prepare('SELECT COUNT(*) AS n FROM operation_health_results').get() as { n: number }).n,
    ).toBeGreaterThan(0);
  });

  it('R572: 受領イベント保存の失敗後に同じ版で送り直すとイベントと通知準備が揃う', async () => {
    seedOpenAlert();

    const failed = await app().request(
      '/api/operations/alerts/alert-m26f/acknowledge', ackInit(),
      bindings({ DB: failAt(/INSERT OR IGNORE INTO operation_alert_events/) }),
    );
    expect(failed.status).toBe(500);
    expect(testDb.raw.prepare(
      "SELECT status, version FROM operation_alerts WHERE id = 'alert-m26f'",
    ).get()).toEqual({ status: 'acknowledged', version: 2 });
    expect(testDb.raw.prepare(
      "SELECT COUNT(*) AS n FROM operation_alert_events WHERE alert_id = 'alert-m26f' AND action = 'acknowledged'",
    ).get()).toEqual({ n: 0 });

    const retried = await app().request(
      '/api/operations/alerts/alert-m26f/acknowledge', ackInit(), bindings(),
    );
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({
      success: true,
      duplicate: true,
      data: { status: 'acknowledged', version: 2 },
    });
    const event = testDb.raw.prepare(
      "SELECT alert_version, notification_enqueued_at FROM operation_alert_events WHERE alert_id = 'alert-m26f' AND action = 'acknowledged'",
    ).get() as { alert_version: number; notification_enqueued_at: string | null };
    expect(event.alert_version).toBe(2);
    expect(event.notification_enqueued_at).not.toBeNull();
    expect(
      (testDb.raw.prepare(
        `SELECT COUNT(*) AS n FROM operation_alert_notification_outbox o
          JOIN operation_alert_events e ON e.id = o.event_id
         WHERE e.alert_id = 'alert-m26f' AND e.action = 'acknowledged'`,
      ).get() as { n: number }).n,
    ).toBeGreaterThan(0);
  });

  it('R573: 停止のreceipt保存の失敗後に同じキーで送り直すと通知準備まで揃う', async () => {
    await grantStepUp('m26f-stop-token-1');
    const failed = await app().request(
      '/api/operations/incidents', stopInit('m26f-stop-token-1', 'm26f-stop-key-1'),
      bindings({ DB: failAt(/INSERT OR IGNORE INTO operation_request_receipts/) }),
    );
    expect(failed.status).toBe(500);
    const control = testDb.raw.prepare(
      "SELECT version, active_incident_id FROM operation_control_sets WHERE scope_key = 'account-1'",
    ).get() as { version: number; active_incident_id: string | null };
    expect(control.version).toBe(1);
    expect(control.active_incident_id).not.toBeNull();
    expect(testDb.raw.prepare(
      "SELECT COUNT(*) AS n FROM operation_request_receipts WHERE action = 'stop'",
    ).get()).toEqual({ n: 0 });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM operation_notification_outbox').get()).toEqual({ n: 0 });

    await grantStepUp('m26f-stop-token-2');
    const retried = await app().request(
      '/api/operations/incidents', stopInit('m26f-stop-token-2', 'm26f-stop-key-1'), bindings(),
    );
    expect(retried.status).toBe(200);
    const body = await retried.json() as {
      success: boolean; duplicate: boolean;
      data: { status: string; incident: { id: string } };
    };
    expect(body).toMatchObject({ success: true, duplicate: true, data: { status: 'changed' } });
    expect(body.data.incident.id).toBe(control.active_incident_id);
    expect(testDb.raw.prepare(
      "SELECT COUNT(*) AS n FROM operation_request_receipts WHERE action = 'stop'",
    ).get()).toEqual({ n: 1 });
    expect(
      (testDb.raw.prepare(
        'SELECT COUNT(*) AS n FROM operation_notification_outbox WHERE incident_id = ?',
      ).get(control.active_incident_id) as { n: number }).n,
    ).toBe(2);
  });

  it('R573: 復旧のreceipt保存の失敗後に同じキーで送り直すと通知準備まで揃う', async () => {
    await grantStepUp('m26f-restore-stop-token');
    const stopped = await app().request(
      '/api/operations/incidents', stopInit('m26f-restore-stop-token', 'm26f-restore-stop-key'), bindings(),
    );
    expect(stopped.status).toBe(201);
    const stoppedBody = await stopped.json() as {
      data: { control: { version: number }; incident: { id: string } };
    };
    const incidentId = stoppedBody.data.incident.id;
    const version = stoppedBody.data.control.version;

    await grantStepUp('m26f-restore-token-1');
    const first = restoreInit('m26f-restore-token-1', 'm26f-restore-key-1', incidentId, version);
    const failed = await app().request(
      first.path, first.init,
      bindings({ DB: failAt(/INSERT OR IGNORE INTO operation_request_receipts/) }),
    );
    expect(failed.status).toBe(500);
    expect(testDb.raw.prepare(
      'SELECT status FROM operation_incidents WHERE id = ?',
    ).bind(incidentId).get()).toEqual({ status: 'resolved' });
    expect(testDb.raw.prepare(
      'SELECT COUNT(*) AS n FROM operation_request_receipts WHERE action = ? AND resource_id = ?',
    ).bind(`restore:${incidentId}`, incidentId).get()).toEqual({ n: 0 });
    expect(testDb.raw.prepare(
      "SELECT COUNT(*) AS n FROM operation_notification_outbox WHERE incident_id = ? AND event_kind = 'restored'",
    ).bind(incidentId).get()).toEqual({ n: 0 });

    await grantStepUp('m26f-restore-token-2');
    const second = restoreInit('m26f-restore-token-2', 'm26f-restore-key-1', incidentId, version);
    const retried = await app().request(second.path, second.init, bindings());
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({
      success: true,
      duplicate: true,
      data: { status: 'restored' },
    });
    expect(testDb.raw.prepare(
      'SELECT COUNT(*) AS n FROM operation_request_receipts WHERE action = ? AND resource_id = ?',
    ).bind(`restore:${incidentId}`, incidentId).get()).toEqual({ n: 1 });
    expect(testDb.raw.prepare(
      "SELECT COUNT(*) AS n FROM operation_request_receipts WHERE action = 'stop' AND resource_id = ?",
    ).bind(incidentId).get()).toEqual({ n: 1 });
    expect(
      (testDb.raw.prepare(
        "SELECT COUNT(*) AS n FROM operation_notification_outbox WHERE incident_id = ? AND event_kind = 'restored'",
      ).bind(incidentId).get() as { n: number }).n,
    ).toBe(2);
  });

  it('R573: 部分復旧のreceipt保存の失敗後に同じキーで送り直すと一度だけ補い、他人・異内容は409のまま', async () => {
    await grantStepUp('m26f-partial-stop-token');
    const stopped = await app().request(
      '/api/operations/incidents',
      stopInit('m26f-partial-stop-token', 'm26f-partial-stop-key', ['broadcast_dispatch', 'scenario_dispatch']),
      bindings(),
    );
    expect(stopped.status).toBe(201);
    const stoppedBody = await stopped.json() as {
      data: { control: { version: number }; incident: { id: string } };
    };
    const incidentId = stoppedBody.data.incident.id;
    const version = stoppedBody.data.control.version;

    // 停止後に追加された稼働シナリオは復旧前検査で追加ずれになり、
    // その能力だけ止まったままの部分復旧になる。
    testDb.raw.prepare(
      `INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
       VALUES ('sc-m26f-partial', '停止後追加', 'manual', 1, 'account-1')`,
    ).run();

    await grantStepUp('m26f-partial-restore-token-1');
    const first = restoreInit('m26f-partial-restore-token-1', 'm26f-partial-restore-key-1', incidentId, version);
    const failed = await app().request(
      first.path, first.init,
      bindings({ DB: failAt(/INSERT OR IGNORE INTO operation_request_receipts/) }),
    );
    expect(failed.status).toBe(500);
    // 版だけ進み、停止記録は動いたまま、記録と通知準備が欠けた状態。
    expect(testDb.raw.prepare(
      'SELECT version, active_incident_id FROM operation_control_sets WHERE scope_key = ?',
    ).bind('account-1').get()).toEqual({ version: version + 1, active_incident_id: incidentId });
    expect(testDb.raw.prepare(
      'SELECT status FROM operation_incidents WHERE id = ?',
    ).bind(incidentId).get()).toEqual({ status: 'stopped' });
    expect(testDb.raw.prepare(
      'SELECT restore_report_json FROM operation_incidents WHERE id = ?',
    ).bind(incidentId).get()).not.toEqual({ restore_report_json: null });
    expect(testDb.raw.prepare(
      'SELECT COUNT(*) AS n FROM operation_request_receipts WHERE action = ? AND resource_id = ?',
    ).bind(`restore:${incidentId}`, incidentId).get()).toEqual({ n: 0 });
    expect(testDb.raw.prepare(
      "SELECT COUNT(*) AS n FROM operation_notification_outbox WHERE incident_id = ? AND event_kind = 'restored'",
    ).bind(incidentId).get()).toEqual({ n: 0 });

    await grantStepUp('m26f-partial-restore-token-2');
    const second = restoreInit('m26f-partial-restore-token-2', 'm26f-partial-restore-key-1', incidentId, version);
    const retried = await app().request(second.path, second.init, bindings());
    expect(retried.status).toBe(200);
    const retriedBody = await retried.json() as {
      success: boolean; duplicate: boolean;
      data: { status: string; report: unknown };
    };
    expect(retriedBody).toMatchObject({ success: true, duplicate: true, data: { status: 'partial' } });
    expect(retriedBody.data.report).not.toBeNull();
    // 記録と通知準備は一度だけ補われる。
    expect(testDb.raw.prepare(
      'SELECT COUNT(*) AS n FROM operation_request_receipts WHERE action = ? AND resource_id = ?',
    ).bind(`restore:${incidentId}`, incidentId).get()).toEqual({ n: 1 });
    expect(
      (testDb.raw.prepare(
        "SELECT COUNT(*) AS n FROM operation_notification_outbox WHERE incident_id = ? AND event_kind = 'restored'",
      ).bind(incidentId).get() as { n: number }).n,
    ).toBe(2);

    // 異内容（進んだ版と違う版）の再送は競合のまま。
    await grantStepUp('m26f-partial-restore-token-3');
    const mismatched = restoreInit('m26f-partial-restore-token-3', 'm26f-partial-restore-key-2', incidentId, version + 99);
    const conflicted = await app().request(mismatched.path, mismatched.init, bindings());
    expect(conflicted.status).toBe(409);
    expect(await conflicted.json()).toMatchObject({ success: false, code: 'VERSION_CONFLICT' });

    // 他人（確定させた担当者と違う）の再送は競合のまま。
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, role, api_key, account_scope)
       VALUES ('admin-1', 'Admin', 'admin', 'admin-m26f-partial-key', 'accounts')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
       VALUES ('admin-1', 'account-1', '2026-09-16T00:00:00.000Z')`,
    ).run();
    await grantStepUp('m26f-partial-restore-token-4', 'admin-1');
    const foreign = restoreInit('m26f-partial-restore-token-4', 'm26f-partial-restore-key-3', incidentId, version);
    const rejected = await app('admin').request(foreign.path, foreign.init, bindings());
    expect(rejected.status).toBe(409);

    // 409の再送では記録も通知準備も増えない。
    expect(testDb.raw.prepare(
      'SELECT COUNT(*) AS n FROM operation_request_receipts WHERE action = ? AND resource_id = ?',
    ).bind(`restore:${incidentId}`, incidentId).get()).toEqual({ n: 1 });
    expect(
      (testDb.raw.prepare(
        "SELECT COUNT(*) AS n FROM operation_notification_outbox WHERE incident_id = ? AND event_kind = 'restored'",
      ).bind(incidentId).get() as { n: number }).n,
    ).toBe(2);
  });
});
