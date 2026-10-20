import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  completeOperationHealthRun,
  consumeStepUpGrant,
  createStepUpGrant,
  enqueueOperationNotifications,
  getLatestOperationHealthRun,
  listOperationDeploymentEvents,
  recordOperationDeploymentEvent,
  startOperationHealthRun,
} from '../src/operations-health.js';
import { stopOperationCapabilities } from '../src/operations.js';
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

describe('migration 314 operation data contracts', () => {
  it('同じアカウントの同じ5分窓は1runだけ保存する', async () => {
    const now = '2026-09-07T01:02:03.000Z';
    const first = await startOperationHealthRun(db, {
      lineAccountId: 'account-1', source: 'manual', actorId: 'owner-1', now,
    });
    const duplicate = await startOperationHealthRun(db, {
      lineAccountId: 'account-1', source: 'scheduled', now: '2026-09-07T01:04:59.000Z',
    });
    expect(first.created).toBe(true);
    expect(duplicate).toMatchObject({ created: false, run: { id: first.run.id } });

    await completeOperationHealthRun(db, first.run.id, [{
      checkKey: 'line_connection', status: 'normal', summary: '正常',
      source: 'account_health_logs', observedAt: now,
    }], now);
    expect(await getLatestOperationHealthRun(db, 'account-1')).toMatchObject({
      id: first.run.id,
      overallStatus: 'normal',
      results: [{ checkKey: 'line_connection', status: 'normal' }],
    });
  });

  it('step-up grantはactor・目的・期限を照合して一度だけ消費する', async () => {
    await createStepUpGrant(db, {
      tokenHash: 'hash-1', staffId: 'owner-1', purpose: 'operations.control',
      expiresAt: '2026-09-07T02:00:00.000Z', now: '2026-09-07T01:00:00.000Z',
    });
    expect(await consumeStepUpGrant(db, {
      tokenHash: 'hash-1', staffId: 'owner-2', purpose: 'operations.control', now: '2026-09-07T01:01:00.000Z',
    })).toBe(false);
    expect(await consumeStepUpGrant(db, {
      tokenHash: 'hash-1', staffId: 'owner-1', purpose: 'operations.control', now: '2026-09-07T01:01:00.000Z',
    })).toBe(true);
    expect(await consumeStepUpGrant(db, {
      tokenHash: 'hash-1', staffId: 'owner-1', purpose: 'operations.control', now: '2026-09-07T01:02:00.000Z',
    })).toBe(false);
  });

  it('配備eventをdeploymentとphaseで冪等化する', async () => {
    const input = {
      deploymentId: 'deploy-1', phase: 'succeeded' as const, environment: 'staging',
      actor: 'github-actions', occurredAt: '2026-09-07T01:00:00.000Z',
    };
    expect((await recordOperationDeploymentEvent(db, input)).created).toBe(true);
    expect((await recordOperationDeploymentEvent(db, input)).created).toBe(false);
    expect(await listOperationDeploymentEvents(db)).toHaveLength(1);
  });

  it('停止の成否と独立してLINE/emailを別outboxへ積む', async () => {
    const stopped = await stopOperationCapabilities(db, {
      lineAccountId: 'account-1', capabilities: ['broadcast_dispatch'], expectedVersion: 0,
      actorId: 'owner-1', reason: '障害対応',
    });
    if (stopped.status !== 'changed') throw new Error('stop failed');
    await enqueueOperationNotifications(db, {
      incidentId: stopped.incident.id, eventKind: 'stopped', payload: { actorId: 'owner-1' },
    });
    expect(sqlite.prepare(
      'SELECT channel, status FROM operation_notification_outbox ORDER BY channel',
    ).all()).toEqual([
      { channel: 'email', status: 'queued' },
      { channel: 'line', status: 'queued' },
    ]);
  });
});
