import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { createTestD1, insertFriend } from '../test-utils/d1-sqlite.js';
import {
  decideIdentityCandidate,
  getIdentityCandidate,
  IdentityCandidateError,
  listIdentityCandidates,
  undoIdentityCandidate,
  upsertIdentityCandidate,
  type IdentityCandidateDraft,
} from './identity-candidates.js';

function seed() {
  const testDb = createTestD1();
  testDb.raw.prepare(`
    INSERT INTO line_accounts (
      id, channel_id, name, channel_access_token, channel_secret, tenant_id
    ) VALUES (?, ?, ?, 'token', 'secret', ?)
  `).run('account-a', 'channel-a', '本店', DEFAULT_TENANT_ID);
  testDb.raw.prepare(`
    INSERT INTO line_accounts (
      id, channel_id, name, channel_access_token, channel_secret, tenant_id
    ) VALUES (?, ?, ?, 'token', 'secret', ?)
  `).run('account-b', 'channel-b', '支店', DEFAULT_TENANT_ID);
  insertFriend(testDb.raw, 'friend-a', { line_account_id: 'account-a', display_name: '田中 花子' });
  insertFriend(testDb.raw, 'friend-b', { line_account_id: 'account-b', display_name: '田中 はなこ' });
  insertFriend(testDb.raw, 'friend-c', { line_account_id: 'account-a', display_name: '田中 花子' });
  testDb.raw.prepare(`
    INSERT INTO ec_events (
      id, source, external_event_id, event_type, customer_id, line_user_id,
      payload, status, received_at, updated_at
    ) VALUES ('event-a', 'eccube', 'external-a', 'ec.order.confirmed', 'customer-a',
      'U00000000000000000000000000000000', '{}', 'skipped', '2026-08-30', '2026-08-30')
  `).run();
  return testDb;
}

const evidence = [
  {
    key: 'verified_email', label: '確認済みのメールアドレスが同じ',
    strength: 'strong' as const, verified: true, valuePreview: 'ta***@example.jp',
  },
  {
    key: 'similar_name', label: '表示名が似ている',
    strength: 'weak' as const, verified: false, valuePreview: null,
  },
];

function friendDraft(id = 'candidate-friend'): IdentityCandidateDraft {
  return {
    id,
    tenantId: DEFAULT_TENANT_ID,
    kind: 'friend_duplicate',
    confidenceScore: 92,
    detectorVersion: 'friends-v1',
    left: {
      kind: 'friend', id: 'friend-b', label: '田中 はなこ', detail: '支店',
      lineAccountId: 'account-b', lineAccountName: '支店', shopKey: null,
      attributes: [{ label: 'メール', valuePreview: 'ta***@example.jp', verified: true }],
    },
    right: {
      kind: 'friend', id: 'friend-a', label: '田中 花子', detail: '本店',
      lineAccountId: 'account-a', lineAccountName: '本店', shopKey: null,
      attributes: [{ label: 'メール', valuePreview: 'ta***@example.jp', verified: true }],
    },
    evidence,
    impact: [
      { key: 'duplicate_deliveries', label: '重複配信', value: 3, unit: '通', note: null },
      { key: 'orders', label: '注文', value: null, unit: '件', note: '取得元を接続後に表示' },
    ],
    detectedAt: '2026-08-30T10:00:00.000Z',
  };
}

function ecDraft(id = 'candidate-ec'): IdentityCandidateDraft {
  return {
    id,
    tenantId: DEFAULT_TENANT_ID,
    kind: 'ec_member',
    confidenceScore: 88,
    detectorVersion: 'ec-v1',
    sourceKey: 'eccube',
    externalCustomerId: 'customer-a',
    left: {
      kind: 'ec_event', id: 'event-a', label: '注文 NEN-1001', detail: '2026/08/30',
      lineAccountId: 'account-a', lineAccountName: '本店', shopKey: 'shop-a',
      attributes: [{ label: '電話番号', valuePreview: '090-****-0001', verified: true }],
    },
    right: {
      kind: 'friend', id: 'friend-c', label: '田中 花子', detail: '本店',
      lineAccountId: 'account-a', lineAccountName: '本店', shopKey: 'shop-a',
      attributes: [{ label: '電話番号', valuePreview: '090-****-0001', verified: true }],
    },
    evidence,
    impact: [
      { key: 'orders', label: '結び付く注文', value: 24, unit: '件', note: null },
      { key: 'past_messages', label: '過去のLINE送信', value: 0, unit: '通', note: '再送しません' },
    ],
    detectedAt: '2026-08-30T11:00:00.000Z',
  };
}

const actor = { id: 'owner-a', name: '担当者', tenantId: DEFAULT_TENANT_ID };

describe('identity candidate contract', () => {
  it('uses one response contract for friend duplicates and EC members', async () => {
    const { db } = seed();
    await upsertIdentityCandidate(db, friendDraft());
    await upsertIdentityCandidate(db, ecDraft());

    const friend = await getIdentityCandidate(db, DEFAULT_TENANT_ID, 'candidate-friend');
    const ec = await getIdentityCandidate(db, DEFAULT_TENANT_ID, 'candidate-ec');
    expect(Object.keys(friend).sort()).toEqual(Object.keys(ec).sort());
    expect(friend).toMatchObject({ kind: 'friend_duplicate', status: 'pending', version: 1 });
    expect(ec).toMatchObject({ kind: 'ec_member', status: 'pending', version: 1 });
    expect(friend.impact[1].value).toBeNull();
    expect(ec.impact[1].value).toBe(0);
    expect(JSON.stringify([friend, ec])).not.toContain('tanaka@example.jp');
  });

  it('keeps a different decision and does not put it back in the pending queue', async () => {
    const { db } = seed();
    await upsertIdentityCandidate(db, friendDraft());
    await decideIdentityCandidate(db, actor, 'candidate-friend', {
      expectedVersion: 1, decision: 'different', reason: '本人へ確認し、別人でした',
    });
    await upsertIdentityCandidate(db, friendDraft());

    const pending = await listIdentityCandidates(db, {
      tenantId: DEFAULT_TENANT_ID, kind: 'friend_duplicate', status: 'pending',
      allowedAccountIds: ['account-a', 'account-b'], limit: 20, offset: 0,
    });
    const different = await listIdentityCandidates(db, {
      tenantId: DEFAULT_TENANT_ID, kind: 'friend_duplicate', status: 'different',
      allowedAccountIds: ['account-a', 'account-b'], limit: 20, offset: 0,
    });
    expect(pending.total).toBe(0);
    expect(different.total).toBe(1);
    expect(different.items[0].version).toBe(2);
  });

  it('invalidates the same candidate when its evidence changes', async () => {
    const { db } = seed();
    const id = await upsertIdentityCandidate(db, friendDraft());
    const changed = friendDraft('ignored-new-id');
    changed.evidence = [{ ...evidence[0], label: '確認済みの電話番号も同じ' }];
    const sameId = await upsertIdentityCandidate(db, changed);
    const detail = await getIdentityCandidate(db, DEFAULT_TENANT_ID, id);
    expect(sameId).toBe(id);
    expect(detail).toMatchObject({ status: 'invalidated', version: 2 });
    expect(detail.history[0]).toMatchObject({
      fromStatus: 'pending', toStatus: 'invalidated', actorName: 'システム',
    });
  });

  it('links friends non-destructively and can undo without deleting rows or history', async () => {
    const { db, raw } = seed();
    await upsertIdentityCandidate(db, friendDraft());
    const linked = await decideIdentityCandidate(db, actor, 'candidate-friend', {
      expectedVersion: 1, decision: 'linked', reason: '本人確認済みのメールが一致しました',
    });
    expect(linked).toMatchObject({ status: 'linked', version: 2, canUndo: true });
    const friendRows = raw.prepare(
      "SELECT id, user_id FROM friends WHERE id IN ('friend-a','friend-b') ORDER BY id",
    ).all() as Array<{ id: string; user_id: string | null }>;
    expect(friendRows).toHaveLength(2);
    expect(friendRows[0].user_id).toBe(friendRows[1].user_id);
    expect(raw.prepare(
      "SELECT COUNT(*) AS count FROM friend_identity_links WHERE unlinked_at IS NULL",
    ).get()).toEqual({ count: 2 });

    const undone = await undoIdentityCandidate(db, actor, 'candidate-friend', {
      expectedVersion: 2, reason: '本人から別人だと連絡がありました',
    });
    expect(undone).toMatchObject({ status: 'invalidated', version: 3, canDecide: true });
    expect(raw.prepare('SELECT COUNT(*) AS count FROM friends').get()).toEqual({ count: 3 });
    expect(raw.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 1 });
    expect(raw.prepare(
      'SELECT COUNT(*) AS count FROM friend_identity_links WHERE unlinked_at IS NOT NULL',
    ).get()).toEqual({ count: 2 });
    expect(undone.history).toHaveLength(2);
  });

  it('rejects a stale decision and prevents two existing users from being merged silently', async () => {
    const { db, raw } = seed();
    await upsertIdentityCandidate(db, friendDraft());
    await decideIdentityCandidate(db, actor, 'candidate-friend', {
      expectedVersion: 1, decision: 'deferred', reason: '本人へ確認しています',
    });
    await expect(decideIdentityCandidate(db, actor, 'candidate-friend', {
      expectedVersion: 1, decision: 'different', reason: '古い画面からの判定です',
    })).rejects.toMatchObject({ code: 'STALE_CANDIDATE', status: 409 });

    await undoIdentityCandidate(db, actor, 'candidate-friend', {
      expectedVersion: 2, reason: '確認をやり直します',
    });
    raw.prepare("INSERT INTO users (id, display_name) VALUES ('user-a','A'),('user-b','B')").run();
    raw.prepare("UPDATE friends SET user_id='user-a' WHERE id='friend-a'").run();
    raw.prepare("UPDATE friends SET user_id='user-b' WHERE id='friend-b'").run();
    await expect(decideIdentityCandidate(db, actor, 'candidate-friend', {
      expectedVersion: 3, decision: 'linked', reason: '同じ人に見えます',
    })).rejects.toMatchObject({ code: 'IDENTITY_USER_CONFLICT', status: 409 });
  });

  it('records an EC link and past-event scope without replaying LINE or changing event state', async () => {
    const { db, raw } = seed();
    await upsertIdentityCandidate(db, ecDraft());
    const linked = await decideIdentityCandidate(db, actor, 'candidate-ec', {
      expectedVersion: 1,
      decision: 'linked',
      reason: '確認済みの電話番号が一致しました',
      reprocess: { mode: 'analytics_snapshot', from: '2026-08-01', to: '2026-08-30' },
    });
    expect(linked.history[0].reprocessMode).toBe('analytics_snapshot');
    expect(raw.prepare(
      'SELECT source_key, shop_key, external_customer_id, friend_id FROM ec_identity_links',
    ).get()).toEqual({
      source_key: 'eccube', shop_key: 'shop-a', external_customer_id: 'customer-a',
      friend_id: 'friend-c',
    });
    expect(raw.prepare('SELECT status, friend_id FROM ec_events WHERE id = ?').get('event-a'))
      .toEqual({ status: 'skipped', friend_id: null });
  });

  it('rejects an EC candidate that crosses a LINE account boundary', async () => {
    const { db } = seed();
    const bad = ecDraft();
    bad.left.lineAccountId = 'account-b';
    await expect(upsertIdentityCandidate(db, bad)).rejects.toBeInstanceOf(IdentityCandidateError);
    await expect(upsertIdentityCandidate(db, bad)).rejects.toMatchObject({
      code: 'EC_ACCOUNT_MISMATCH', status: 422,
    });
  });
});
