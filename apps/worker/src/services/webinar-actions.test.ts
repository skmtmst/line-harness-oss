import { describe, expect, test, vi } from 'vitest';

import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import {
  getWebinarActionSettings,
  processDueMissedWebinarActions,
  saveWebinarActionSetting,
  startWebinarActionExecution,
  WebinarActionError,
} from './webinar-actions.js';

const NOW = '2026-08-31T03:00:00.000Z';
const SESSION = 1_788_140_400;

function seed(raw: import('better-sqlite3').Database): void {
  raw.prepare(
    `INSERT INTO line_accounts
       (id, channel_id, name, channel_access_token, channel_secret, is_active)
     VALUES ('account-1', 'channel-1', '本店', 'token-1', 'secret-1', 1),
            ('account-2', 'channel-2', '支店', 'token-2', 'secret-2', 1)`,
  ).run();
  raw.prepare(
    `INSERT INTO webinars
       (id, account_id, title, slug, status, duration_seconds, schedule_json, created_at, updated_at)
     VALUES ('webinar-1', 'account-1', '説明会', 'briefing', 'active', 3600, '[]', ?, ?)`,
  ).run(NOW, NOW);
  insertFriend(raw, 'friend-1', { line_account_id: 'account-1', line_user_id: 'U001' });
  raw.prepare(
    `INSERT INTO common_actions
       (id, line_account_id, name, status, created_at, updated_at)
     VALUES ('action-1', 'account-1', '視聴後フォロー', 'published', ?, ?),
            ('action-2', 'account-2', '別店舗の処理', 'published', ?, ?)`,
  ).run(NOW, NOW, NOW, NOW);
  raw.prepare(
    `INSERT INTO common_action_versions
       (id, common_action_id, version_number, status, action_config, created_at, published_at)
     VALUES ('action-1-v1', 'action-1', 1, 'published', ?, ?, ?),
            ('action-1-v2', 'action-1', 2, 'published', ?, ?, ?),
            ('action-2-v1', 'action-2', 1, 'published', ?, ?, ?)`,
  ).run(
    JSON.stringify([{ id: 'record-v1', type: 'record', params: { value: 1 }, onFailure: 'stop' }]), NOW, NOW,
    JSON.stringify([{ id: 'record-v2', type: 'record', params: { value: 2 }, onFailure: 'stop' }]), NOW, NOW,
    JSON.stringify([{ id: 'other', type: 'record', params: {}, onFailure: 'stop' }]), NOW, NOW,
  );
  raw.prepare(
    `UPDATE common_actions SET current_published_version_id = 'action-1-v1' WHERE id = 'action-1'`,
  ).run();
  raw.prepare(
    `UPDATE common_actions SET current_published_version_id = 'action-2-v1' WHERE id = 'action-2'`,
  ).run();
}

describe('webinar common action contract', () => {
  test('同じアカウントの公開版だけを選択肢へ返す', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const result = await getWebinarActionSettings(db, 'webinar-1', 'account-1');
    expect(result.settings).toEqual([
      { trigger: 'completed', version: 0, action: null, updatedAt: null },
      { trigger: 'cta_click', version: 0, action: null, updatedAt: null },
      { trigger: 'missed', version: 0, action: null, updatedAt: null },
    ]);
    expect(result.availableActions).toEqual([
      { id: 'action-1', name: '視聴後フォロー', versionId: 'action-1-v1', versionNumber: 1 },
    ]);
    await expect(getWebinarActionSettings(db, 'webinar-1', 'account-2'))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  test('利用先へ公開版を固定し、新版公開で勝手に切り替えない', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const saved = await saveWebinarActionSetting(db, {
      webinarId: 'webinar-1', lineAccountId: 'account-1', trigger: 'completed',
      commonActionVersionId: 'action-1-v1', expectedVersion: 0, now: NOW,
    });
    expect(saved).toMatchObject({
      trigger: 'completed', version: 1,
      action: { id: 'action-1', versionId: 'action-1-v1', versionNumber: 1 },
    });
    raw.prepare(
      `UPDATE common_actions SET current_published_version_id = 'action-1-v2' WHERE id = 'action-1'`,
    ).run();
    const loaded = await getWebinarActionSettings(db, 'webinar-1', 'account-1');
    expect(loaded.settings[0]?.action?.versionId).toBe('action-1-v1');
    expect(raw.prepare(
      `SELECT common_action_version_id, consumer_type, consumer_path
         FROM common_action_bindings WHERE consumer_id = 'webinar-1'`,
    ).get()).toEqual({
      common_action_version_id: 'action-1-v1', consumer_type: 'webinar', consumer_path: 'completed',
    });
  });

  test('別アカウントの版を拒み、古い版番号には最新内容を付けて409相当にする', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    await expect(saveWebinarActionSetting(db, {
      webinarId: 'webinar-1', lineAccountId: 'account-1', trigger: 'cta_click',
      commonActionVersionId: 'action-2-v1', expectedVersion: 0, now: NOW,
    })).rejects.toMatchObject({ code: 'version_not_found' });

    await saveWebinarActionSetting(db, {
      webinarId: 'webinar-1', lineAccountId: 'account-1', trigger: 'cta_click',
      commonActionVersionId: 'action-1-v1', expectedVersion: 0, now: NOW,
    });
    const bindingBefore = raw.prepare(
      `SELECT id, created_at FROM common_action_bindings
        WHERE consumer_id = 'webinar-1' AND consumer_path = 'cta_click'`,
    ).get();
    const conflict = await saveWebinarActionSetting(db, {
      webinarId: 'webinar-1', lineAccountId: 'account-1', trigger: 'cta_click',
      commonActionVersionId: null, expectedVersion: 0, now: NOW,
    }).catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(WebinarActionError);
    expect(conflict).toMatchObject({
      code: 'version_conflict',
      current: { version: 1, action: { versionId: 'action-1-v1' } },
    });

    const identicalConflict = await saveWebinarActionSetting(db, {
      webinarId: 'webinar-1', lineAccountId: 'account-1', trigger: 'cta_click',
      commonActionVersionId: 'action-1-v1', expectedVersion: 0, now: NOW,
    }).catch((error: unknown) => error);
    expect(identicalConflict).toMatchObject({ code: 'version_conflict' });
    expect(raw.prepare(
      `SELECT id, created_at FROM common_action_bindings
        WHERE consumer_id = 'webinar-1' AND consumer_path = 'cta_click'`,
    ).get()).toEqual(bindingBefore);
  });

  test('同じ人・同じ回・同じきっかけは既存実行台帳で一度だけ動く', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    await saveWebinarActionSetting(db, {
      webinarId: 'webinar-1', lineAccountId: 'account-1', trigger: 'missed',
      commonActionVersionId: 'action-1-v1', expectedVersion: 0, now: NOW,
    });
    const executor = vi.fn(async () => ({ output: { ok: true } }));
    const input = {
      webinarId: 'webinar-1', lineAccountId: 'account-1', trigger: 'missed' as const,
      friendId: 'friend-1', sessionStartAt: SESSION,
      sourceEventId: 'notification-job-1', now: NOW,
      executors: { record: executor },
    };
    const first = await startWebinarActionExecution(db, input);
    const second = await startWebinarActionExecution(db, input);
    expect(first).toMatchObject({ kind: 'created', status: 'success' });
    expect(second).toMatchObject({ kind: 'existing', runId: first.runId, status: 'success' });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(raw.prepare(`SELECT COUNT(*) AS count FROM automation_runs`).get()).toEqual({ count: 1 });
    expect(raw.prepare(`SELECT COUNT(*) AS count FROM webinar_action_executions`).get()).toEqual({ count: 1 });
    expect(raw.prepare(
      `SELECT common_action_version_id, status FROM automation_run_steps
        WHERE action_type = 'common_action_marker'`,
    ).get()).toEqual({ common_action_version_id: 'action-1-v1', status: 'success' });
  });

  test('未設定は実行行を作らず、解除後も新しい行を作らない', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    const input = {
      webinarId: 'webinar-1', lineAccountId: 'account-1', trigger: 'completed' as const,
      friendId: 'friend-1', sessionStartAt: SESSION, sourceEventId: 'heartbeat-1', now: NOW,
    };
    expect(await startWebinarActionExecution(db, input)).toEqual({
      kind: 'not_configured', runId: null, status: null,
    });
    const saved = await saveWebinarActionSetting(db, {
      webinarId: 'webinar-1', lineAccountId: 'account-1', trigger: 'completed',
      commonActionVersionId: 'action-1-v1', expectedVersion: 0, now: NOW,
    });
    await saveWebinarActionSetting(db, {
      webinarId: 'webinar-1', lineAccountId: 'account-1', trigger: 'completed',
      commonActionVersionId: null, expectedVersion: saved.version, now: NOW,
    });
    expect(await startWebinarActionExecution(db, input)).toEqual({
      kind: 'not_configured', runId: null, status: null,
    });
    expect(raw.prepare(`SELECT COUNT(*) AS count FROM automation_runs`).get()).toEqual({ count: 0 });
  });

  test('未視聴は通知をOFFのままでも翌日に一度だけ動き、見た人は除く', async () => {
    const { db, raw } = createTestD1();
    seed(raw);
    insertFriend(raw, 'friend-2', { line_account_id: 'account-1', line_user_id: 'U002' });
    raw.prepare(
      `INSERT INTO webinar_registrations
         (id, webinar_id, friend_id, session_start_at, created_at, status)
       VALUES ('registration-1', 'webinar-1', 'friend-1', ?, ?, 'active'),
              ('registration-2', 'webinar-1', 'friend-2', ?, ?, 'active')`,
    ).run(SESSION, NOW, SESSION, NOW);
    raw.prepare(
      `INSERT INTO webinar_viewers
         (id, webinar_id, friend_id, session_start_at, joined_at, last_position_seconds)
       VALUES ('viewer-2', 'webinar-1', 'friend-2', ?, ?, 1)`,
    ).run(SESSION, NOW);
    await saveWebinarActionSetting(db, {
      webinarId: 'webinar-1', lineAccountId: 'account-1', trigger: 'missed',
      commonActionVersionId: 'action-1-v1', expectedVersion: 0, now: NOW,
    });
    expect(raw.prepare(`SELECT COUNT(*) AS count FROM webinar_notification_settings`).get())
      .toEqual({ count: 0 });
    const executor = vi.fn(async () => ({ output: { ok: true } }));
    const due = new Date((SESSION + 2 * 24 * 60 * 60) * 1000);

    expect(await processDueMissedWebinarActions(db, {
      now: due, executors: { record: executor },
    })).toEqual({ processed: 1, failed: 0 });
    expect(await processDueMissedWebinarActions(db, {
      now: due, executors: { record: executor },
    })).toEqual({ processed: 0, failed: 0 });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(raw.prepare(
      `SELECT friend_id, trigger_type FROM webinar_action_executions`,
    ).all()).toEqual([{ friend_id: 'friend-1', trigger_type: 'missed' }]);
  });
});
