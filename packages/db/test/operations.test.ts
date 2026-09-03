import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  getOperationControlSet,
  isOperationCapabilityStopped,
  listOperationIncidents,
  restoreOperationIncident,
  stopOperationCapabilities,
} from '../src/operations.js';
import { asD1 } from './d1-test-helper.js';

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
     VALUES ('account-1', 'channel-1', 'LINE 1', 'token', 'secret')`,
  ).run();
  db = asD1(sqlite);
});

describe('緊急停止のサーバースナップショット', () => {
  it('停止前と停止後をサーバーで保存し、別の取得から同じ状態を読める', async () => {
    const result = await stopOperationCapabilities(db, {
      lineAccountId: 'account-1',
      capabilities: ['broadcast_dispatch', 'scenario_dispatch'],
      expectedVersion: 0,
      actorId: 'owner-1',
      reason: '誤配信の防止',
    });

    expect(result.status).toBe('changed');
    if (result.status !== 'changed') throw new Error('stop failed');
    expect(result.incident.beforeSnapshot).toMatchObject({
      version: 0,
      states: { broadcast_dispatch: 'running', scenario_dispatch: 'running' },
    });
    expect(result.incident.stoppedSnapshot).toMatchObject({
      version: 1,
      states: { broadcast_dispatch: 'stopped', scenario_dispatch: 'stopped' },
    });
    expect(await getOperationControlSet(db, 'account-1')).toMatchObject({
      version: 1,
      activeIncidentId: result.incident.id,
      states: { broadcast_dispatch: 'stopped', scenario_dispatch: 'stopped' },
    });
  });

  it('全体停止は個別アカウントにも効き、選んでいない処理は止めない', async () => {
    await stopOperationCapabilities(db, {
      lineAccountId: null,
      capabilities: ['broadcast_dispatch'],
      expectedVersion: 0,
      actorId: 'owner-1',
      reason: '障害対応',
    });

    expect(await isOperationCapabilityStopped(db, 'account-1', 'broadcast_dispatch')).toBe(true);
    expect(await isOperationCapabilityStopped(db, 'account-1', 'automation_actions')).toBe(false);
  });

  it('古い版の停止を拒否し、先に保存した状態を上書きしない', async () => {
    await stopOperationCapabilities(db, {
      lineAccountId: 'account-1',
      capabilities: ['broadcast_dispatch'],
      expectedVersion: 0,
      actorId: 'owner-1',
      reason: '障害対応',
    });
    const stale = await stopOperationCapabilities(db, {
      lineAccountId: 'account-1',
      capabilities: ['scenario_dispatch'],
      expectedVersion: 0,
      actorId: 'owner-2',
      reason: '別の停止',
    });

    expect(stale.status).toBe('conflict');
    expect(await getOperationControlSet(db, 'account-1')).toMatchObject({
      version: 1,
      states: { broadcast_dispatch: 'stopped', scenario_dispatch: 'running' },
    });
    const history = await listOperationIncidents(db, {
      accountIds: ['account-1'],
      includeGlobal: false,
    });
    expect(history).toHaveLength(2);
    expect(history.some((item) => item.status === 'failed')).toBe(true);
  });

  it('復旧後も停止履歴を消さず、復旧後のスナップショットを残す', async () => {
    const stopped = await stopOperationCapabilities(db, {
      lineAccountId: 'account-1',
      capabilities: ['broadcast_dispatch', 'reminder_dispatch'],
      expectedVersion: 0,
      actorId: 'owner-1',
      reason: 'メンテナンス',
    });
    if (stopped.status !== 'changed') throw new Error('stop failed');

    const restored = await restoreOperationIncident(db, {
      incidentId: stopped.incident.id,
      expectedVersion: stopped.control.version,
      actorId: 'owner-2',
    });

    expect(restored.status).toBe('changed');
    if (restored.status !== 'changed') throw new Error('restore failed');
    expect(restored.incident).toMatchObject({
      status: 'resolved',
      actorId: 'owner-1',
      resolvedByActorId: 'owner-2',
      restoredSnapshot: {
        version: 2,
        activeIncidentId: null,
        states: { broadcast_dispatch: 'running', reminder_dispatch: 'running' },
      },
    });
    expect(await listOperationIncidents(db, {
      accountIds: ['account-1'],
      includeGlobal: false,
    })).toHaveLength(1);
  });

  it('復旧時は、対象だけを動作中にせず停止前の状態全体を戻す', async () => {
    sqlite.prepare(
      `INSERT INTO operation_control_sets
         (scope_key, line_account_id, version, states_json, updated_at)
       VALUES ('account-1', 'account-1', 1, ?, ?)`,
    ).run(JSON.stringify({ ...defaultStates(), automation_actions: 'stopped' }), new Date().toISOString());
    const stopped = await stopOperationCapabilities(db, {
      lineAccountId: 'account-1',
      capabilities: ['broadcast_dispatch'],
      expectedVersion: 1,
      actorId: 'owner-1',
      reason: '誤配信防止',
    });
    if (stopped.status !== 'changed') throw new Error('stop failed');

    const restored = await restoreOperationIncident(db, {
      incidentId: stopped.incident.id,
      expectedVersion: stopped.control.version,
      actorId: 'owner-2',
    });

    expect(restored.status).toBe('changed');
    if (restored.status !== 'changed') throw new Error('restore failed');
    expect(restored.control.states).toMatchObject({
      broadcast_dispatch: 'running',
      automation_actions: 'stopped',
    });
  });
});

function defaultStates() {
  return {
    broadcast_dispatch: 'running',
    scenario_dispatch: 'running',
    reminder_dispatch: 'running',
    automation_actions: 'running',
    auto_reply_dispatch: 'running',
    webhook_outgoing: 'running',
    ad_postback: 'running',
  };
}
