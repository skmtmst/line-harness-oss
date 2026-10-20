import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getFriendAddRoutingDraftVersion,
  publishFriendAddRoutingDraftVersion,
  recordFriendAddRoutingDraftTest,
  saveFriendAddRoutingDraftVersion,
} from '../src/friend-add-routing-versions.js'
import { asD1 } from './d1-test-helper.js'

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '256_friend_add_routing_versions.sql'),
  'utf8',
)

const initialRouting = {
  firstTime: { scenarioId: 'scenario-first', timing: 'immediate', actions: [] },
  returning: {
    scenarioId: null,
    mode: 'same',
    startPosition: 'beginning',
    actions: [],
  },
  criteria: { firstTime: 'unfollow_count_zero' },
}

const changedRouting = {
  ...initialRouting,
  returning: {
    ...initialRouting.returning,
    mode: 'none',
    actions: [{ type: 'add_tag', tagId: 'tag-returning' }],
  },
}

function setup() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE line_accounts (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE account_settings (
      line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (line_account_id, key)
    );
  `)
  sqlite.prepare('INSERT INTO line_accounts (id) VALUES (?)').run('account-1')
  sqlite.prepare(`
    INSERT INTO account_settings (line_account_id, key, value, created_at, updated_at)
    VALUES (?, 'friend_add_routing', ?, '2026-08-01T09:00:00', '2026-08-01T09:00:00')
  `).run('account-1', JSON.stringify(initialRouting))
  sqlite.exec(migration)
  return sqlite
}

describe('migration 256 friend-add routing versions', () => {
  it('imports the current setting as immutable published version 1', () => {
    const sqlite = setup()
    const published = sqlite.prepare(`
      SELECT version_number, definition_snapshot, status
      FROM friend_add_routing_versions
      WHERE line_account_id = ?
    `).get('account-1')

    expect(published).toEqual({
      version_number: 1,
      definition_snapshot: JSON.stringify(initialRouting),
      status: 'published',
    })
    expect(() => sqlite.prepare(`
      UPDATE friend_add_routing_versions SET definition_snapshot = '{}'
      WHERE line_account_id = ? AND status = 'published'
    `).run('account-1')).toThrow(/immutable/)
  })

  it('keeps draft edits out of production and publishes one tested snapshot idempotently', async () => {
    const sqlite = setup()
    const db = asD1(sqlite)

    const draft = await saveFriendAddRoutingDraftVersion(db, 'account-1', changedRouting)
    expect(draft.version_number).toBe(2)
    expect(draft.status).toBe('draft')
    expect(JSON.parse(sqlite.prepare(`
      SELECT value FROM account_settings
      WHERE line_account_id = ? AND key = 'friend_add_routing'
    `).pluck().get('account-1') as string)).toEqual(initialRouting)

    await recordFriendAddRoutingDraftTest(db, draft.id, {
      succeeded: true,
      staffId: 'staff-1',
    })
    expect((await getFriendAddRoutingDraftVersion(db, 'account-1'))?.last_test_status)
      .toBe('succeeded')

    await saveFriendAddRoutingDraftVersion(db, 'account-1', {
      ...changedRouting,
      firstTime: { ...changedRouting.firstTime, timing: 'next_day' },
    })
    expect((await getFriendAddRoutingDraftVersion(db, 'account-1'))?.last_test_status).toBeNull()
    await expect(publishFriendAddRoutingDraftVersion(db, 'account-1', {
      idempotencyKey: 'publish-key-00000001',
      staffId: 'staff-1',
    })).rejects.toThrow('FRIEND_ADD_ROUTING_DRAFT_NOT_TESTED')

    const edited = await getFriendAddRoutingDraftVersion(db, 'account-1')
    expect(edited).not.toBeNull()
    await recordFriendAddRoutingDraftTest(db, edited!.id, {
      succeeded: true,
      staffId: 'staff-1',
    })
    const first = await publishFriendAddRoutingDraftVersion(db, 'account-1', {
      idempotencyKey: 'publish-key-00000001',
      staffId: 'staff-1',
    })
    const replay = await publishFriendAddRoutingDraftVersion(db, 'account-1', {
      idempotencyKey: 'publish-key-00000001',
      staffId: 'staff-1',
    })

    expect(first.status).toBe('published')
    expect(replay.id).toBe(first.id)
    expect(sqlite.prepare(`
      SELECT status FROM friend_add_routing_versions
      WHERE line_account_id = ? AND version_number = 1
    `).pluck().get('account-1')).toBe('retired')
    expect(JSON.parse(sqlite.prepare(`
      SELECT value FROM account_settings
      WHERE line_account_id = ? AND key = 'friend_add_routing'
    `).pluck().get('account-1') as string)).toEqual({
      ...changedRouting,
      firstTime: { ...changedRouting.firstTime, timing: 'next_day' },
    })
    expect(() => sqlite.prepare('DELETE FROM friend_add_routing_versions WHERE id = ?')
      .run(first.id)).toThrow(/cannot be deleted/)
  })
})
