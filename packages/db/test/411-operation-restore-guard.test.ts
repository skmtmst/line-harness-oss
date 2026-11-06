import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  getOperationControlSet,
  getOperationIncident,
  restoreOperationIncident,
  stopOperationCapabilities,
} from '../src/operations.js';
import { inspectIncidentRestoreDrift } from '../src/operation-restore-guard.js';
import { asD1 } from './d1-test-helper.js';

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', 'LINE 1', 'token', 'secret'),
            ('account-2', 'channel-2', 'LINE 2', 'token', 'secret')`,
  ).run();
  db = asD1(sqlite);
});

function addBroadcast(id: string, accountId = 'account-1', scheduledAt: string | null = '2099-01-01T00:00:00.000Z') {
  sqlite.prepare(
    `INSERT INTO broadcasts (id, title, message_type, message_content, status, scheduled_at, line_account_id)
     VALUES (?, ?, 'text', 'body', 'scheduled', ?, ?)`,
  ).run(id, `broadcast-${id}`, scheduledAt, accountId);
}

function addScenario(id: string, accountId = 'account-1') {
  sqlite.prepare(
    `INSERT INTO scenarios (id, name, trigger_type, is_active, line_account_id)
     VALUES (?, ?, 'manual', 1, ?)`,
  ).run(id, `scenario-${id}`, accountId);
}

async function stopAccount(capabilities: ('broadcast_dispatch' | 'scenario_dispatch' | 'reminder_dispatch')[], accountId = 'account-1') {
  const stopped = await stopOperationCapabilities(db, {
    lineAccountId: accountId,
    capabilities,
    expectedVersion: (await getOperationControlSet(db, accountId)).version,
    actorId: 'owner-1',
    reason: '誤配信の防止',
  });
  if (stopped.status !== 'changed') throw new Error(`stop failed: ${stopped.status}`);
  return stopped;
}

describe('N-451 停止時snapshotと復旧前検査', () => {
  it('停止した瞬間の稼働定義の版と期限を incident へ保存する', async () => {
    addBroadcast('b-1');
    addScenario('s-1');
    const stopped = await stopAccount(['broadcast_dispatch', 'scenario_dispatch']);

    const incident = (await getOperationIncident(db, stopped.incident.id))!;
    const definitions = JSON.parse(incident.stoppedDefinitionsJson!) as Record<string, { id: string; version: string | null; expiresAt: string | null }[]>;
    expect(definitions.broadcast_dispatch).toEqual([
      { id: 'b-1', version: '1', expiresAt: '2099-01-01T00:00:00.000Z', status: 'scheduled' },
    ]);
    expect(definitions.scenario_dispatch?.map((entry) => entry.id)).toEqual(['s-1']);
  });

  it('ずれが無ければ全部を停止前へ戻して resolved にし、検査結果を残す', async () => {
    addBroadcast('b-1');
    const stopped = await stopAccount(['broadcast_dispatch']);

    const restored = await restoreOperationIncident(db, {
      incidentId: stopped.incident.id,
      expectedVersion: stopped.control.version,
      actorId: 'owner-2',
    });

    expect(restored.status).toBe('restored');
    if (restored.status !== 'restored') throw new Error('restore failed');
    expect(restored.control.states.broadcast_dispatch).toBe('running');
    expect(restored.control.activeIncidentId).toBeNull();
    expect(restored.report.resumed).toEqual(['broadcast_dispatch']);
    const incident = (await getOperationIncident(db, stopped.incident.id))!;
    expect(incident.status).toBe('resolved');
    expect(JSON.parse(incident.restoreReportJson!).resumed).toEqual(['broadcast_dispatch']);
  });

  it('停止中に編集された定義は再開せず、その能力だけを止めたままにする', async () => {
    addBroadcast('b-1');
    addScenario('s-1');
    const stopped = await stopAccount(['broadcast_dispatch', 'scenario_dispatch']);
    // 停止中に予約配信を編集（版が上がる）
    sqlite.prepare(`UPDATE broadcasts SET title = 'edited', lock_version = lock_version + 1 WHERE id = 'b-1'`).run();

    const restored = await restoreOperationIncident(db, {
      incidentId: stopped.incident.id,
      expectedVersion: stopped.control.version,
      actorId: 'owner-2',
    });

    expect(restored.status).toBe('partial');
    if (restored.status !== 'partial') throw new Error('unexpected status');
    // 変更の無いシナリオだけ再開し、編集された一斉配信は止まったまま
    expect(restored.control.states.scenario_dispatch).toBe('running');
    expect(restored.control.states.broadcast_dispatch).toBe('stopped');
    expect(restored.control.activeIncidentId).toBe(stopped.incident.id);
    expect(restored.report.remaining).toEqual(['broadcast_dispatch']);
    const drift = restored.report.drift.capabilities.find((entry) => entry.capability === 'broadcast_dispatch')!;
    expect(drift.blocked).toBe(true);
    expect(drift.drift).toEqual([
      expect.objectContaining({ id: 'b-1', kind: 'changed', beforeVersion: '1', currentVersion: '2' }),
    ]);
    // incident は停止中のまま残り、検査結果が保存される
    const incident = (await getOperationIncident(db, stopped.incident.id))!;
    expect(incident.status).toBe('stopped');
  });

  it('停止中に追加された定義は誤って再開しない（追加だけで再開を止める）', async () => {
    addBroadcast('b-1');
    const stopped = await stopAccount(['broadcast_dispatch']);
    addBroadcast('b-added');

    const drift = await inspectIncidentRestoreDrift(db, (await getOperationIncident(db, stopped.incident.id))!);
    const broadcastDrift = drift.capabilities.find((entry) => entry.capability === 'broadcast_dispatch')!;
    expect(broadcastDrift.drift).toEqual([
      expect.objectContaining({ id: 'b-added', kind: 'added' }),
    ]);
    expect(broadcastDrift.blocked).toBe(true);

    const restored = await restoreOperationIncident(db, {
      incidentId: stopped.incident.id,
      expectedVersion: stopped.control.version,
      actorId: 'owner-2',
    });
    expect(restored.status).toBe('blocked');
    expect((await getOperationControlSet(db, 'account-1')).states.broadcast_dispatch).toBe('stopped');

    // 追加物を取り除けば次の試行では復旧できる
    sqlite.prepare(`DELETE FROM broadcasts WHERE id = 'b-added'`).run();
    const retry = await restoreOperationIncident(db, {
      incidentId: stopped.incident.id,
      expectedVersion: (await getOperationControlSet(db, 'account-1')).version,
      actorId: 'owner-2',
    });
    expect(retry.status).toBe('restored');
  });

  it('停止中に削除・人が止めた定義は再開を止めず、ずれとして記録だけする', async () => {
    addScenario('s-deleted');
    addScenario('s-inactive');
    addBroadcast('b-1');
    const stopped = await stopAccount(['scenario_dispatch', 'broadcast_dispatch']);
    sqlite.prepare(`DELETE FROM scenarios WHERE id = 's-deleted'`).run();
    sqlite.prepare(`UPDATE scenarios SET is_active = 0 WHERE id = 's-inactive'`).run();

    const restored = await restoreOperationIncident(db, {
      incidentId: stopped.incident.id,
      expectedVersion: stopped.control.version,
      actorId: 'owner-2',
    });

    expect(restored.status).toBe('restored');
    if (restored.status !== 'restored') throw new Error('unexpected status');
    const scenarioDrift = restored.report.drift.capabilities.find((entry) => entry.capability === 'scenario_dispatch')!;
    expect(scenarioDrift.drift).toEqual([
      expect.objectContaining({ id: 's-deleted', kind: 'deleted' }),
      expect.objectContaining({ id: 's-inactive', kind: 'inactive' }),
    ]);
    expect(scenarioDrift.blocked).toBe(false);
  });

  it('停止中に期限を過ぎた予約配信は下書きへ戻し、過去時刻を送らせない', async () => {
    addBroadcast('b-ok', 'account-1', '2099-01-01T00:00:00.000Z');
    addBroadcast('b-expired', 'account-1', '2099-01-01T00:00:00.000Z');
    const stopped = await stopAccount(['broadcast_dispatch']);
    // 停止中に予約時刻が過ぎた
    sqlite.prepare(`UPDATE broadcasts SET scheduled_at = '2000-01-01T00:00:00.000Z' WHERE id = 'b-expired'`).run();

    const restored = await restoreOperationIncident(db, {
      incidentId: stopped.incident.id,
      expectedVersion: stopped.control.version,
      actorId: 'owner-2',
    });

    expect(restored.status).toBe('restored');
    if (restored.status !== 'restored') throw new Error('unexpected status');
    expect(restored.report.heldExpired).toEqual([
      expect.objectContaining({ id: 'b-expired', capability: 'broadcast_dispatch' }),
    ]);
    const held = sqlite.prepare(`SELECT status, scheduled_at, stopped_at, stopped_by FROM broadcasts WHERE id = 'b-expired'`).get() as Record<string, unknown>;
    expect(held.status).toBe('draft');
    expect(held.scheduled_at).toBeNull();
    expect(held.stopped_at).not.toBeNull();
    expect(held.stopped_by).toBe('owner-2');
    // 期限内の予約はそのまま再開される
    const kept = sqlite.prepare(`SELECT status, scheduled_at FROM broadcasts WHERE id = 'b-ok'`).get() as Record<string, unknown>;
    expect(kept.status).toBe('scheduled');
    expect(kept.scheduled_at).toBe('2099-01-01T00:00:00.000Z');
  });

  it('対象アカウントが停止中に無効化されたら全ての再開を止める', async () => {
    addBroadcast('b-1');
    const stopped = await stopAccount(['broadcast_dispatch']);
    sqlite.prepare(`UPDATE line_accounts SET is_active = 0 WHERE id = 'account-1'`).run();

    const restored = await restoreOperationIncident(db, {
      incidentId: stopped.incident.id,
      expectedVersion: stopped.control.version,
      actorId: 'owner-2',
    });

    expect(restored.status).toBe('blocked');
    if (restored.status !== 'blocked') throw new Error('unexpected status');
    expect(restored.report.drift.accountInactive).toBe(true);
    expect(restored.report.drift.resumable).toEqual([]);
    expect(restored.control.states.broadcast_dispatch).toBe('stopped');
  });

  it('他アカウントの定義は snapshot にもずれにも混ざらない', async () => {
    addBroadcast('b-1', 'account-1');
    addBroadcast('b-other', 'account-2');
    addScenario('s-other', 'account-2');
    const stopped = await stopAccount(['broadcast_dispatch', 'scenario_dispatch'], 'account-1');

    const incident = (await getOperationIncident(db, stopped.incident.id))!;
    const definitions = JSON.parse(incident.stoppedDefinitionsJson!) as Record<string, { id: string }[]>;
    expect(definitions.broadcast_dispatch?.map((entry) => entry.id)).toEqual(['b-1']);
    expect(definitions.scenario_dispatch ?? []).toEqual([]);

    // 他アカウント側の追加・編集は account-1 の復旧を止めない
    sqlite.prepare(`UPDATE broadcasts SET lock_version = lock_version + 1 WHERE id = 'b-other'`).run();
    addBroadcast('b-other-added', 'account-2');
    const drift = await inspectIncidentRestoreDrift(db, incident);
    expect(drift.capabilities.every((entry) => !entry.blocked)).toBe(true);
    const restored = await restoreOperationIncident(db, {
      incidentId: stopped.incident.id,
      expectedVersion: stopped.control.version,
      actorId: 'owner-2',
    });
    expect(restored.status).toBe('restored');
  });

  it('版がずれていても競合があれば復旧しない（従来の競合検査は残る）', async () => {
    addBroadcast('b-1');
    const stopped = await stopAccount(['broadcast_dispatch']);
    const conflict = await restoreOperationIncident(db, {
      incidentId: stopped.incident.id,
      expectedVersion: 99,
      actorId: 'owner-2',
    });
    expect(conflict.status).toBe('conflict');
    expect((await getOperationControlSet(db, 'account-1')).states.broadcast_dispatch).toBe('stopped');
  });
});
