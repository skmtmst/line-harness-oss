import { describe, expect, it } from 'vitest'
import { getAutomationExecutionRuns } from '@line-crm/db'
import { createTestD1 } from '../test-utils/d1-sqlite'

describe('既存automation_runsのV6読み取り', () => {
  it('条件外・部分成功・未取得を壊さず一覧と集計へ返す', async () => {
    const testDb = createTestD1()
    testDb.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('acc-1', 'channel-1', '本店', 'token', 'secret')`,
    ).run()
    testDb.raw.prepare(
      `INSERT INTO friends (id, line_user_id, display_name, line_account_id)
       VALUES ('friend-1', 'U001', '田中さん', 'acc-1')`,
    ).run()
    testDb.raw.prepare(
      `INSERT INTO automation_definitions (id, line_account_id, name, status)
       VALUES ('automation-1', 'acc-1', '予約案内', 'active')`,
    ).run()
    testDb.raw.prepare(
      `INSERT INTO automation_versions
       (id, automation_id, version_number, status, trigger_type, action_config)
       VALUES ('version-1', 'automation-1', 1, 'published', 'message_received', '[]')`,
    ).run()
    testDb.raw.prepare(
      `INSERT INTO automation_runs
       (id, line_account_id, automation_id, automation_version_id, friend_id,
        source_event_id, idempotency_key, status, started_at, completed_at, created_at)
       VALUES
       ('run-1', 'acc-1', 'automation-1', 'version-1', 'friend-1',
        'event-1', 'key-1', 'partial', '2026-08-28T01:00:00.000Z', '2026-08-28T01:00:01.200Z', '2026-08-28T01:00:00.000Z'),
       ('run-2', 'acc-1', 'automation-1', 'version-1', NULL,
        'event-2', 'key-2', 'skipped_condition', NULL, NULL, '2026-08-28T00:00:00.000Z')`,
    ).run()
    testDb.raw.prepare(
      `INSERT INTO automation_run_steps
       (id, automation_run_id, step_key, action_type, idempotency_key, status, error_code, error_message)
       VALUES
       ('step-1', 'run-1', 'message', 'send_message', 'step-key-1', 'success', NULL, NULL),
       ('step-2', 'run-1', 'slack', 'send_webhook', 'step-key-2', 'failed', 'webhook_timeout', '秘密を含みうる内部エラー')`,
    ).run()

    const result = await getAutomationExecutionRuns(testDb.db, {
      allowedAccountIds: ['acc-1'],
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      limit: 20,
      offset: 0,
    })

    expect(result.total).toBe(2)
    expect(result.summary).toEqual({
      total: 2,
      executed: 1,
      skipped: 1,
      failed: 1,
      most_run_name: '予約案内',
      most_run_count: 1,
    })
    expect(result.rows[0]).toMatchObject({
      id: 'run-1', friend_name: '田中さん', account_name: '本店',
      duration_ms: 1200, successful_actions: 'send_message',
      failed_action: 'send_webhook', failure_code: 'webhook_timeout',
    })
    expect(result.rows[1]).toMatchObject({
      id: 'run-2', friend_name: null, duration_ms: null, status: 'skipped_condition',
    })
  })

  it('閲覧可能なアカウントと結果条件をSQLで絞る', async () => {
    const testDb = createTestD1()
    for (const [id, channel] of [['acc-1', 'channel-1'], ['acc-2', 'channel-2']]) {
      testDb.raw.prepare(
        `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
         VALUES (?, ?, ?, 'token', 'secret')`,
      ).run(id, channel, id)
      testDb.raw.prepare(
        `INSERT INTO automation_definitions (id, line_account_id, name, status)
         VALUES (?, ?, ?, 'active')`,
      ).run(`automation-${id}`, id, id)
      testDb.raw.prepare(
        `INSERT INTO automation_versions
         (id, automation_id, version_number, status, trigger_type, action_config)
         VALUES (?, ?, 1, 'published', 'friend_add', '[]')`,
      ).run(`version-${id}`, `automation-${id}`)
      testDb.raw.prepare(
        `INSERT INTO automation_runs
         (id, line_account_id, automation_id, automation_version_id, source_event_id,
          idempotency_key, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '2026-08-28T00:00:00.000Z')`,
      ).run(`run-${id}`, id, `automation-${id}`, `version-${id}`, `event-${id}`, `key-${id}`, id === 'acc-1' ? 'failed' : 'success')
    }

    const result = await getAutomationExecutionRuns(testDb.db, {
      allowedAccountIds: ['acc-1'],
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      status: ['failed'],
      limit: 20,
      offset: 0,
    })
    expect(result.rows.map((row) => row.id)).toEqual(['run-acc-1'])
    expect(result.total).toBe(1)
  })
})
