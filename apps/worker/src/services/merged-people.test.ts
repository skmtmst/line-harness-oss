import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import {
  getMergedPerson,
  mergedPersonAccountIds,
  updateMergedPerson,
  updateMergedPersonDeliveryPriorities,
} from './merged-people.js';

const actor = { id: 'owner-a', name: '担当者', tenantId: DEFAULT_TENANT_ID };

function seed() {
  const testDb = createTestD1();
  const { raw } = testDb;
  raw.prepare(`
    INSERT OR IGNORE INTO tenants (id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(DEFAULT_TENANT_ID, '既定統括', '2026-08-30', '2026-08-30');
  for (const [id, name] of [['account-a', '本店'], ['account-b', '支店']]) {
    raw.prepare(`
      INSERT INTO line_accounts (
        id, channel_id, name, channel_access_token, channel_secret, tenant_id
      ) VALUES (?, ?, ?, 'token', 'secret', ?)
    `).run(id, `channel-${id}`, name, DEFAULT_TENANT_ID);
  }
  insertFriend(raw, 'friend-a', {
    line_account_id: 'account-a', display_name: '田中 花子', user_id: 'user-a',
  });
  insertFriend(raw, 'friend-b', {
    line_account_id: 'account-b', display_name: '田中 はなこ', user_id: 'user-a',
  });
  insertFriend(raw, 'friend-c', {
    line_account_id: 'account-a', display_name: '別の人', user_id: null,
  });
  raw.prepare(`
    INSERT INTO users (
      id, tenant_id, status, display_name, primary_display_name, revision,
      created_by, created_at, updated_at
    ) VALUES ('user-a', ?, 'active', '田中 花子', '田中 花子', 1,
      'owner-a', '2026-08-30T09:00:00.000Z', '2026-08-30T09:00:00.000Z')
  `).run(DEFAULT_TENANT_ID);
  raw.prepare(`
    INSERT INTO identity_candidates (
      id, tenant_id, kind, status, version, confidence_score, detector_version,
      left_subject_kind, left_subject_id, left_line_account_id, left_snapshot_json,
      right_subject_kind, right_subject_id, right_line_account_id, right_snapshot_json,
      evidence_fingerprint, evidence_json, impact_json, detected_at, reviewed_at,
      created_at, updated_at
    ) VALUES ('candidate-a', ?, 'friend_duplicate', 'linked', 2, 92, 'v1',
      'friend', 'friend-a', 'account-a', '{}', 'friend', 'friend-b', 'account-b',
      '{}', 'fingerprint-a', '[]', '[]', '2026-08-30T09:00:00.000Z',
      '2026-08-30T09:10:00.000Z', '2026-08-30T09:00:00.000Z',
      '2026-08-30T09:10:00.000Z')
  `).run(DEFAULT_TENANT_ID);
  raw.prepare(`
    INSERT INTO identity_candidate_decisions (
      id, candidate_id, candidate_version, from_status, to_status, actor_name,
      reason, evidence_fingerprint, impact_snapshot_json, decided_at
    ) VALUES ('decision-a', 'candidate-a', 2, 'pending', 'linked', '担当者',
      '本人へ確認済みです', 'fingerprint-a', '[]', '2026-08-30T09:10:00.000Z')
  `).run();
  for (const [id, friendId] of [['link-a', 'friend-a'], ['link-b', 'friend-b']]) {
    raw.prepare(`
      INSERT INTO friend_identity_links (
        id, tenant_id, candidate_id, user_id, friend_id, link_method,
        evidence_snapshot_json, confidence_score, linked_by, linked_at
      ) VALUES (?, ?, 'candidate-a', 'user-a', ?, 'operator_review', '[]', 92,
        'owner-a', '2026-08-30T09:10:00.000Z')
    `).run(id, DEFAULT_TENANT_ID, friendId);
  }
  raw.prepare(`
    INSERT INTO user_profile_values (
      id, tenant_id, user_id, field_key, field_label, value_json, value_preview,
      source_type, source_id, source_label, source_friend_id, verified_at,
      selected_by, selected_by_name, selected_at, update_mode, is_active,
      created_at, updated_at
    ) VALUES ('profile-a', ?, 'user-a', 'email', 'メール', '"tanaka@example.jp"',
      'ta***@example.jp', 'form', 'form-a', '来店アンケート', 'friend-a',
      '2026-08-29T12:00:00.000Z', 'owner-a', '担当者',
      '2026-08-30T09:20:00.000Z', 'fixed', 1,
      '2026-08-30T09:20:00.000Z', '2026-08-30T09:20:00.000Z')
  `).run(DEFAULT_TENANT_ID);
  raw.prepare(`
    INSERT INTO user_delivery_priorities (
      id, tenant_id, user_id, purpose, friend_id, priority, is_active,
      reason, selected_by, selected_at, created_at, updated_at
    ) VALUES ('priority-a', ?, 'user-a', 'broadcast', 'friend-a', 1, 1,
      '本店を優先します', 'owner-a', '2026-08-30T09:30:00.000Z',
      '2026-08-30T09:30:00.000Z', '2026-08-30T09:30:00.000Z')
  `).run(DEFAULT_TENANT_ID);
  return testDb;
}

describe('merged person detail contract', () => {
  it('returns links, safe adopted values, priorities, and link history without raw PII', async () => {
    const { db } = seed();
    const detail = await getMergedPerson(db, DEFAULT_TENANT_ID, 'user-a');
    expect(detail).toMatchObject({
      id: 'user-a', status: 'active', revision: 1, primaryDisplayName: '田中 花子',
    });
    expect(detail.linkedFriends).toHaveLength(2);
    expect(detail.linkedFriends[0]).toMatchObject({ confidence: 92, candidateId: 'candidate-a' });
    expect(detail.profileValues[0]).toMatchObject({
      fieldKey: 'email', valuePreview: 'ta***@example.jp', sourceLabel: '来店アンケート',
    });
    expect(detail.deliveryPriorities[0]).toMatchObject({
      purpose: 'broadcast', lineAccountName: '本店', priority: 1,
    });
    expect(detail.history[0]).toMatchObject({ eventType: 'link', actorName: '担当者' });
    expect(JSON.stringify(detail)).not.toContain('tanaka@example.jp');
  });

  it('derives legacy tenant scope from every linked LINE account and rejects cross-tenant users', async () => {
    const { db, raw } = seed();
    raw.prepare('UPDATE users SET tenant_id = NULL WHERE id = ?').run('user-a');
    expect((await mergedPersonAccountIds(db, DEFAULT_TENANT_ID, 'user-a')).sort())
      .toEqual(['account-a', 'account-b']);

    raw.prepare('INSERT INTO tenants (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('tenant-b', '別統括', '2026-08-30', '2026-08-30');
    raw.prepare(`
      INSERT INTO line_accounts (
        id, channel_id, name, channel_access_token, channel_secret, tenant_id
      ) VALUES ('account-c', 'channel-c', '別統括店', 'token', 'secret', 'tenant-b')
    `).run();
    insertFriend(raw, 'friend-d', {
      line_account_id: 'account-c', display_name: '別統括の友だち', user_id: 'user-a',
    });
    await expect(getMergedPerson(db, DEFAULT_TENANT_ID, 'user-a'))
      .rejects.toMatchObject({ code: 'PERSON_NOT_FOUND', status: 404 });
  });

  it('updates adopted values with revision control and never returns the stored raw value', async () => {
    const { db, raw } = seed();
    const updated = await updateMergedPerson(db, actor, 'user-a', {
      expectedRevision: 1,
      primaryDisplayName: '田中 はなこ',
      profileSelections: [{
        fieldKey: 'phone', fieldLabel: '電話番号', value: '090-1234-5678',
        valuePreview: '090-****-5678', sourceType: 'friend_field', sourceId: 'field-phone',
        sourceLabel: '本店の友だち情報', sourceFriendId: 'friend-a',
        verifiedAt: '2026-08-30T09:40:00.000Z', updateMode: 'fixed',
      }],
    });
    expect(updated).toMatchObject({ revision: 2, primaryDisplayName: '田中 はなこ' });
    expect(updated.profileValues.find((item) => item.fieldKey === 'phone')).toMatchObject({
      valuePreview: '090-****-5678', sourceFriendId: 'friend-a',
    });
    expect(JSON.stringify(updated)).not.toContain('090-1234-5678');
    expect(raw.prepare(
      "SELECT value_json FROM user_profile_values WHERE field_key='phone' AND is_active=1",
    ).get()).toEqual({ value_json: '"090-1234-5678"' });
    await expect(updateMergedPerson(db, actor, 'user-a', {
      expectedRevision: 1, primaryDisplayName: '古い画面',
    })).rejects.toMatchObject({ code: 'STALE_PERSON', status: 409 });
  });

  it('rejects raw previews and profile sources that are not linked to the person', async () => {
    const { db } = seed();
    await expect(updateMergedPerson(db, actor, 'user-a', {
      expectedRevision: 1,
      profileSelections: [{
        fieldKey: 'email', fieldLabel: 'メール', value: 'tanaka@example.jp',
        valuePreview: 'tanaka@example.jp', sourceType: 'form', sourceId: 'form-a',
        sourceLabel: '来店アンケート', sourceFriendId: 'friend-a',
        verifiedAt: null, updateMode: 'auto',
      }],
    })).rejects.toMatchObject({ code: 'UNMASKED_PROFILE_VALUE', status: 422 });
    await expect(updateMergedPerson(db, actor, 'user-a', {
      expectedRevision: 1,
      profileSelections: [{
        fieldKey: 'plan', fieldLabel: '継続予定', value: '継続', valuePreview: '継続',
        sourceType: 'friend_field', sourceId: 'field-plan', sourceLabel: '別の人',
        sourceFriendId: 'friend-c', verifiedAt: null, updateMode: 'fixed',
      }],
    })).rejects.toMatchObject({ code: 'PROFILE_SOURCE_NOT_LINKED', status: 422 });
  });

  it('replaces delivery priorities atomically and distinguishes an empty list from stale data', async () => {
    const { db, raw } = seed();
    const updated = await updateMergedPersonDeliveryPriorities(db, actor, 'user-a', {
      expectedRevision: 1,
      priorities: [
        { purpose: 'broadcast', friendId: 'friend-b', priority: 1, isActive: true, reason: '支店を優先します' },
        { purpose: 'broadcast', friendId: 'friend-a', priority: 2, isActive: true, reason: '送れないときの代替です' },
      ],
    });
    expect(updated.revision).toBe(2);
    expect(updated.deliveryPriorities.map((item) => [item.lineAccountName, item.priority]))
      .toEqual([['支店', 1], ['本店', 2]]);
    expect(raw.prepare(
      'SELECT COUNT(*) AS count FROM user_delivery_priorities WHERE retired_at IS NOT NULL',
    ).get()).toEqual({ count: 1 });

    const cleared = await updateMergedPersonDeliveryPriorities(db, actor, 'user-a', {
      expectedRevision: 2, priorities: [],
    });
    expect(cleared.revision).toBe(3);
    expect(cleared.deliveryPriorities).toEqual([]);
    await expect(updateMergedPersonDeliveryPriorities(db, actor, 'user-a', {
      expectedRevision: 2, priorities: [],
    })).rejects.toMatchObject({ code: 'STALE_PERSON', status: 409 });
  });
});
