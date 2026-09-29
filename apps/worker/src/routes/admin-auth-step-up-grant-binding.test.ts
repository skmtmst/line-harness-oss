import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { consumeStepUpGrant } from '@line-crm/db'
import { createTestD1 } from '../test-utils/d1-sqlite.js'

/*
 * 監査第155回・オーナー決定: 使っていない確認票（step-up grant）が、
 * ログアウトや権限の更新の後でも新しいログインで使えていた不具合。
 *
 * 確認票を「発行したセッション」と「発行時の権限の版」に結び付け、
 * ログアウト・セッション終了・権限の更新のどれかが起きたら使えない。
 */

const NOW = '2026-09-08T01:00:00.000Z'
const LATER = '2026-09-08T01:05:00.000Z'
let testDb: ReturnType<typeof createTestD1>

function seedStaff() {
  testDb.raw.prepare(
    `INSERT INTO staff_members (id, name, email, role, api_key, is_active) VALUES ('staff-1', 'Staff One', 's1@example.com', 'admin', 's1-key', 1)`,
  ).run()
}

function seedSession(tokenHash: string) {
  testDb.raw.prepare(
    `INSERT INTO admin_sessions (token_hash, staff_id, expires_at, created_at) VALUES (?, 'staff-1', ?, ?)`,
  ).run(tokenHash, LATER, NOW)
}

function seedGrant(tokenHash: string, sessionHash: string | null = 'session-1', version: number | null = 1) {
  testDb.raw.prepare(
    `INSERT INTO auth_step_up_grants (token_hash, staff_id, purpose, expires_at, consumed_at, created_at, session_token_hash, issued_policy_version)
     VALUES (?, 'staff-1', 'staff.permissions.change', ?, NULL, ?, ?, ?)`,
  ).run(tokenHash, LATER, NOW, sessionHash, version)
}

function consume(tokenHash: string, sessionTokenHash: string | null) {
  return consumeStepUpGrant(testDb.db, {
    tokenHash, staffId: 'staff-1', purpose: 'staff.permissions.change', sessionTokenHash,
  })
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
  testDb = createTestD1()
  seedStaff()
})

afterEach(() => {
  testDb.raw.close()
  vi.useRealTimers()
})

describe('確認票は発行したセッションと権限の版に結び付く', () => {
  it('同じセッションで権限が変わっていなければ使える（一度だけ）', async () => {
    seedSession('session-1')
    seedGrant('grant-1')
    expect(await consume('grant-1', 'session-1')).toBe(true)
    expect(await consume('grant-1', 'session-1')).toBe(false)
  })

  it('ログアウト後（セッション終了後）は使えない', async () => {
    seedSession('session-1')
    seedGrant('grant-1')
    testDb.raw.prepare(`DELETE FROM admin_sessions WHERE token_hash = ?`).run('session-1')
    expect(await consume('grant-1', 'session-1')).toBe(false)
  })

  it('権限の更新後（版が進んだら）は使えない', async () => {
    seedSession('session-1')
    seedGrant('grant-1')
    testDb.raw.prepare(`UPDATE staff_members SET policy_version = 2 WHERE id = 'staff-1'`).run()
    expect(await consume('grant-1', 'session-1')).toBe(false)
  })

  it('別セッションでは使えない', async () => {
    seedSession('session-1')
    seedSession('session-2')
    seedGrant('grant-1')
    expect(await consume('grant-1', 'session-2')).toBe(false)
    // 本来のセッションではまだ使える。
    expect(await consume('grant-1', 'session-1')).toBe(true)
  })
})
