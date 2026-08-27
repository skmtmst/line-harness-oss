import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clearAdminStepUpFailures,
  consumeAdminStepUpGrant,
  countRecentAdminStepUpFailures,
  createAdminStepUpGrant,
  deleteOldAdminStepUpFailures,
  recordAdminStepUpFailure,
} from '../src/staff.js'
import { asD1 } from './d1-test-helper.js'

let sqlite: Database.Database
let db: D1Database

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'))
  sqlite.prepare(
    `INSERT INTO staff_members (id, name, role, api_key)
     VALUES ('owner-1', 'Owner', 'owner', 'owner-key')`,
  ).run()
  sqlite.prepare(
    `INSERT INTO admin_sessions (token_hash, staff_id, expires_at)
     VALUES ('session-1', 'owner-1', '2026-08-29T00:00:00.000Z')`,
  ).run()
  db = asD1(sqlite)
})

describe('高危険操作の短期本人確認', () => {
  it('現在のsession・本人・用途だけで、期限内に1回だけ使える', async () => {
    await createAdminStepUpGrant(db, {
      tokenHash: 'grant-1',
      staffId: 'owner-1',
      sessionTokenHash: 'session-1',
      purpose: 'operation-stop',
      expiresAt: '2026-08-28T01:05:00.000Z',
      createdAt: '2026-08-28T01:00:00.000Z',
    })

    expect(await consumeAdminStepUpGrant(db, {
      tokenHash: 'grant-1', staffId: 'owner-1', sessionTokenHash: 'session-1',
      purpose: 'operation-restore', now: '2026-08-28T01:01:00.000Z',
    })).toBe(false)
    expect(await consumeAdminStepUpGrant(db, {
      tokenHash: 'grant-1', staffId: 'owner-1', sessionTokenHash: 'session-1',
      purpose: 'operation-stop', now: '2026-08-28T01:01:00.000Z',
    })).toBe(true)
    expect(await consumeAdminStepUpGrant(db, {
      tokenHash: 'grant-1', staffId: 'owner-1', sessionTokenHash: 'session-1',
      purpose: 'operation-stop', now: '2026-08-28T01:02:00.000Z',
    })).toBe(false)
  })

  it('5分窓の失敗回数だけを数え、成功後に現在sessionの失敗を消す', async () => {
    await recordAdminStepUpFailure(db, {
      id: 'failure-old', staffId: 'owner-1', sessionTokenHash: 'session-1',
      occurredAt: '2026-08-28T00:54:59.000Z',
    })
    await recordAdminStepUpFailure(db, {
      id: 'failure-current', staffId: 'owner-1', sessionTokenHash: 'session-1',
      occurredAt: '2026-08-28T00:59:00.000Z',
    })

    const since = '2026-08-28T00:55:00.000Z'
    expect(await countRecentAdminStepUpFailures(db, 'session-1', since)).toBe(1)
    await deleteOldAdminStepUpFailures(db, since)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM admin_step_up_failures').get())
      .toEqual({ count: 1 })
    await clearAdminStepUpFailures(db, 'session-1')
    expect(await countRecentAdminStepUpFailures(db, 'session-1', since)).toBe(0)
  })
})
