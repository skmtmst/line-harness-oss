import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(import.meta.dirname, '..', 'migrations', '257_identity_candidates.sql'),
  'utf8',
)

function setup() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE tenants (id TEXT PRIMARY KEY);
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE friends (id TEXT PRIMARY KEY);
    INSERT INTO tenants VALUES ('tenant-a');
    INSERT INTO line_accounts VALUES ('account-a');
    INSERT INTO line_accounts VALUES ('account-b');
    INSERT INTO friends VALUES ('friend-a');
    INSERT INTO friends VALUES ('friend-b');
  `)
  sqlite.exec(migration)
  return sqlite
}

function insertFriendCandidate(sqlite: Database.Database, id = 'candidate-a') {
  sqlite.prepare(`
    INSERT INTO identity_candidates (
      id, tenant_id, kind, confidence_score, detector_version,
      left_subject_kind, left_subject_id, left_line_account_id, left_snapshot_json,
      right_subject_kind, right_subject_id, right_line_account_id, right_snapshot_json,
      evidence_fingerprint, evidence_json, impact_json, detected_at, created_at, updated_at
    ) VALUES (?, 'tenant-a', 'friend_duplicate', 90, 'v1',
      'friend', 'friend-a', 'account-a', '{}',
      'friend', 'friend-b', 'account-b', '{}',
      'evidence-a', '[]', '[]', '2026-08-30', '2026-08-30', '2026-08-30')
  `).run(id)
}

describe('migration 257 identity candidates', () => {
  it('stores a canonical friend pair and immutable versioned decision history', () => {
    const sqlite = setup()
    insertFriendCandidate(sqlite)
    sqlite.prepare(`
      INSERT INTO identity_candidate_decisions (
        id, candidate_id, candidate_version, from_status, to_status, actor_name,
        reason, evidence_fingerprint, impact_snapshot_json, decided_at
      ) VALUES ('decision-a', 'candidate-a', 2, 'pending', 'different', '担当者',
        '別人と確認', 'evidence-a', '[]', '2026-08-30')
    `).run()

    expect(sqlite.prepare(
      'SELECT candidate_version, to_status, reason FROM identity_candidate_decisions',
    ).get()).toEqual({ candidate_version: 2, to_status: 'different', reason: '別人と確認' })
    expect(() => sqlite.prepare(`
      INSERT INTO identity_candidate_decisions (
        id, candidate_id, candidate_version, from_status, to_status, actor_name,
        reason, evidence_fingerprint, impact_snapshot_json, decided_at
      ) VALUES ('decision-b', 'candidate-a', 2, 'pending', 'linked', '別の担当者',
        '同一人物', 'evidence-a', '[]', '2026-08-30')
    `).run()).toThrow()
  })

  it('rejects a non-canonical friend pair and an EC candidate across accounts', () => {
    const sqlite = setup()
    expect(() => sqlite.prepare(`
      INSERT INTO identity_candidates (
        id, tenant_id, kind, confidence_score, detector_version,
        left_subject_kind, left_subject_id, left_line_account_id, left_snapshot_json,
        right_subject_kind, right_subject_id, right_line_account_id, right_snapshot_json,
        evidence_fingerprint, evidence_json, impact_json, detected_at, created_at, updated_at
      ) VALUES ('bad-pair', 'tenant-a', 'friend_duplicate', 50, 'v1',
        'friend', 'friend-b', 'account-b', '{}',
        'friend', 'friend-a', 'account-a', '{}',
        'x', '[]', '[]', '2026-08-30', '2026-08-30', '2026-08-30')
    `).run()).toThrow()

    expect(() => sqlite.prepare(`
      INSERT INTO identity_candidates (
        id, tenant_id, kind, confidence_score, detector_version,
        left_subject_kind, left_subject_id, left_line_account_id, left_shop_key, left_snapshot_json,
        right_subject_kind, right_subject_id, right_line_account_id, right_snapshot_json,
        source_key, external_customer_id, evidence_fingerprint, evidence_json, impact_json,
        detected_at, created_at, updated_at
      ) VALUES ('bad-ec', 'tenant-a', 'ec_member', 80, 'v1',
        'ec_event', 'event-a', 'account-a', 'shop-a', '{}',
        'friend', 'friend-a', 'account-b', '{}',
        'eccube', 'customer-a', 'x', '[]', '[]',
        '2026-08-30', '2026-08-30', '2026-08-30')
    `).run()).toThrow()
  })

  it('keeps link rows after unlinking and allows only one active link per subject', () => {
    const sqlite = setup()
    insertFriendCandidate(sqlite)
    sqlite.prepare("INSERT INTO users VALUES ('user-a')").run()
    sqlite.prepare(`
      INSERT INTO friend_identity_links (
        id, tenant_id, candidate_id, user_id, friend_id, link_method,
        evidence_snapshot_json, confidence_score, linked_at
      ) VALUES ('link-a', 'tenant-a', 'candidate-a', 'user-a', 'friend-a',
        'operator_review', '[]', 90, '2026-08-30')
    `).run()
    expect(() => sqlite.prepare(`
      INSERT INTO friend_identity_links (
        id, tenant_id, candidate_id, user_id, friend_id, link_method,
        evidence_snapshot_json, confidence_score, linked_at
      ) VALUES ('link-b', 'tenant-a', 'candidate-a', 'user-a', 'friend-a',
        'operator_review', '[]', 90, '2026-08-30')
    `).run()).toThrow()

    sqlite.prepare(`
      UPDATE friend_identity_links
         SET unlinked_at = '2026-08-31', unlink_reason = '判定を取り消した'
       WHERE id = 'link-a'
    `).run()
    sqlite.prepare(`
      INSERT INTO friend_identity_links (
        id, tenant_id, candidate_id, user_id, friend_id, link_method,
        evidence_snapshot_json, confidence_score, linked_at
      ) VALUES ('link-b', 'tenant-a', 'candidate-a', 'user-a', 'friend-a',
        'operator_review', '[]', 90, '2026-09-01')
    `).run()
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM friend_identity_links').get())
      .toEqual({ count: 2 })
  })
})
