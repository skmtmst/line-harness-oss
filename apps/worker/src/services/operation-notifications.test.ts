import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushMessage = vi.hoisted(() => vi.fn(async () => ({})));
const sendViaXServerRelay = vi.hoisted(() => vi.fn(async () => {
  throw new Error('email provider unavailable');
}));

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: class { pushMessage = pushMessage; },
}));
vi.mock('./support-relay.js', () => ({ sendViaXServerRelay }));

import { enqueueOperationNotifications, stopOperationCapabilities } from '@line-crm/db';
import type { Env } from '../index.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { processOperationNotificationOutbox } from './operation-notifications.js';

describe('operation notification outbox', () => {
  beforeEach(() => {
    pushMessage.mockClear();
    sendViaXServerRelay.mockClear();
  });

  it('メール障害でもLINE通知を完了し、メールだけ再試行へ残す', async () => {
    const testDb = createTestD1();
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-1', 'channel-1', 'LINE 1', 'token', 'secret')`,
    ).run();
    testDb.raw.prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, line_user_id)
       VALUES ('owner-1', 'Owner', 'owner@example.test', 'owner', 'api-key', 'U-owner')`,
    ).run();
    const stopped = await stopOperationCapabilities(testDb.db, {
      lineAccountId: 'account-1', capabilities: ['broadcast_dispatch'], expectedVersion: 0,
      actorId: 'owner-1', reason: '障害対応',
    });
    if (stopped.status !== 'changed') throw new Error('stop failed');
    await enqueueOperationNotifications(testDb.db, {
      incidentId: stopped.incident.id, eventKind: 'stopped', payload: { reason: '障害対応' },
    });

    const env = {
      DB: testDb.db,
      LINE_CHANNEL_ACCESS_TOKEN: 'token',
      XSERVER_RELAY_URL: 'https://relay.example.test',
      XSERVER_RELAY_SECRET: 'secret',
    } as Env['Bindings'];
    await expect(processOperationNotificationOutbox(env)).resolves.toEqual({ sent: 1, failed: 1 });
    expect(pushMessage).toHaveBeenCalledOnce();
    expect(sendViaXServerRelay).toHaveBeenCalledOnce();
    expect(testDb.raw.prepare(
      'SELECT channel, status FROM operation_notification_outbox ORDER BY channel',
    ).all()).toEqual([
      { channel: 'email', status: 'failed' },
      { channel: 'line', status: 'sent' },
    ]);
  });
});
