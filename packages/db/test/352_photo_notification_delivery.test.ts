import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyBulkPhotoDecisions,
  claimPhotoNotificationDelivery,
  completePhotoNotificationDelivery,
  getPhotoNotificationState,
  reconcileBulkNotificationOutcomes,
  recordBulkDecisionNotificationResult,
  type BulkPhotoDecisionItem,
} from '../src/nen-photo-operations.js';
import { asD1 } from './d1-test-helper.js';

let sqlite: Database.Database;
let db: D1Database;

const NOW = '2026-09-02T00:00:00.000Z';
const LATER = '2026-09-02T00:01:00.000Z';
const LEASE = '2026-09-02T00:05:00.000Z';
const EXPIRED = '2026-09-02T01:00:00.000Z';

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', 'A店', 'token', 'secret'),
           ('account-b', 'channel-b', 'B店', 'token', 'secret');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('friend-a', 'Ua', 'Aさん', 'account-a');
    INSERT INTO nen_pet_profiles (id, friend_id, name, created_at, updated_at)
    VALUES ('pet-a', 'friend-a', 'ハナ', '2026-09-01', '2026-09-01');
    INSERT INTO nen_photo_submissions
      (id, friend_id, pet_id, r2_key, image_url, content_type, status, created_at,
       reviewed_at, updated_at, line_account_id, review_image_url, public_image_url, review_version)
    VALUES
      ('photo-a', 'friend-a', 'pet-a', 'original/a.jpg', 'legacy-a', 'image/jpeg',
       'pending', '2026-09-01T00:00:00.000Z', NULL, '2026-09-01T00:00:00.000Z',
       'account-a', 'https://cdn.test/review-a.jpg', NULL, 1),
      ('photo-b', 'friend-a', 'pet-a', 'original/b.jpg', 'legacy-b', 'image/jpeg',
       'pending', '2026-09-01T01:00:00.000Z', NULL, '2026-09-01T01:00:00.000Z',
       'account-a', 'https://cdn.test/review-b.jpg', NULL, 1);
    INSERT INTO nen_photo_risk_assessments
      (id, photo_id, line_account_id, flag, confidence, assessed_at, created_at)
    VALUES ('risk-a', 'photo-a', 'account-a', 'safe', 0.99, '2026-09-01', '2026-09-01'),
           ('risk-b', 'photo-b', 'account-a', 'safe', 0.98, '2026-09-01', '2026-09-01');
  `);
  db = asD1(sqlite);
});

async function decide(photoId: string, keySuffix: string) {
  const created = await applyBulkPhotoDecisions(db, {
    id: `bulk-${keySuffix}`, lineAccountId: 'account-a', actorId: 'staff-a', actorName: '担当者',
    idempotencyKey: `bulk-key-${keySuffix}`, requestFingerprint: `bulk-fp-${keySuffix}`,
    decisions: [{ photoId, decision: 'approve', expectedVersion: 1, reasonCode: null, reasonNote: null }],
    now: NOW,
  });
  if (created.kind !== 'created') throw new Error(`setup decide failed: ${created.kind}`);
  const result = created.result as { items: BulkPhotoDecisionItem[] };
  return result.items[0];
}

describe('migration 352 photo notification delivery', () => {
  it('claimと世代条件付き確定で送達を往復する', async () => {
    const item = await decide('photo-a', 'roundtrip');
    const claimed = await claimPhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
      leaseId: 'lease-1', leaseExpiresAt: LEASE, now: NOW,
    });
    expect(claimed).toEqual({ generation: 1 });
    await expect(getPhotoNotificationState(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
    })).resolves.toMatchObject({ status: 'sending', generation: 1, attemptCount: 1 });
    await expect(completePhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
      generation: 1, status: 'sent', now: LATER,
    })).resolves.toBe(true);
    await expect(getPhotoNotificationState(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
    })).resolves.toMatchObject({ status: 'sent', error: null });
  });

  it('遅れて届いた失敗は成功を上書きしない', async () => {
    const item = await decide('photo-a', 'late-failure');
    await claimPhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
      leaseId: 'lease-1', leaseExpiresAt: LEASE, now: NOW,
    });
    await completePhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
      generation: 1, status: 'sent', now: LATER,
    });
    // 古い世代の失敗は確定できない。
    await expect(completePhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
      generation: 1, status: 'failed', error: 'late boom', now: EXPIRED,
    })).resolves.toBe(false);
    await expect(getPhotoNotificationState(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
    })).resolves.toMatchObject({ status: 'sent', error: null });
  });

  it('lease保持中の二重claimは敗者が取れず、切れ後は取れる', async () => {
    const item = await decide('photo-a', 'lease');
    await expect(claimPhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
      leaseId: 'lease-1', leaseExpiresAt: LEASE, now: NOW,
    })).resolves.toEqual({ generation: 1 });
    await expect(claimPhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
      leaseId: 'lease-2', leaseExpiresAt: EXPIRED, now: LATER,
    })).resolves.toBeNull();
    await expect(claimPhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
      leaseId: 'lease-3', leaseExpiresAt: EXPIRED, now: EXPIRED,
    })).resolves.toEqual({ generation: 2 });
  });

  it('failedは再claimで再試行でき、試行回数が増える', async () => {
    const item = await decide('photo-a', 'retry');
    const first = await claimPhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
      leaseId: 'lease-1', leaseExpiresAt: LEASE, now: NOW,
    });
    await completePhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
      generation: first!.generation, status: 'failed', error: 'LINE unavailable', now: LATER,
    });
    const second = await claimPhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
      leaseId: 'lease-2', leaseExpiresAt: EXPIRED, now: LATER,
    });
    expect(second).toEqual({ generation: 2 });
    await expect(completePhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
      generation: 2, status: 'sent', now: EXPIRED,
    })).resolves.toBe(true);
    await expect(getPhotoNotificationState(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
    })).resolves.toMatchObject({ status: 'sent', attemptCount: 2 });
  });

  it('別アカウントのclaimと確定は届かない', async () => {
    const item = await decide('photo-a', 'scope');
    await expect(claimPhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-b',
      leaseId: 'lease-x', leaseExpiresAt: LEASE, now: NOW,
    })).resolves.toBeNull();
    await expect(completePhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-b',
      generation: 1, status: 'sent', now: NOW,
    })).resolves.toBe(false);
    await expect(getPhotoNotificationState(db, {
      decisionId: item.decisionId, lineAccountId: 'account-b',
    })).resolves.toBeNull();
  });

  it('送達台帳から一括結果を作り直して受付票へ保存できる', async () => {
    const itemA = await decide('photo-a', 'reconcile-a');
    const itemB = await decide('photo-b', 'reconcile-b');
    const claimA = await claimPhotoNotificationDelivery(db, {
      decisionId: itemA.decisionId, lineAccountId: 'account-a',
      leaseId: 'lease-a', leaseExpiresAt: LEASE, now: NOW,
    });
    await completePhotoNotificationDelivery(db, {
      decisionId: itemA.decisionId, lineAccountId: 'account-a',
      generation: claimA!.generation, status: 'sent', now: LATER,
    });
    const claimB = await claimPhotoNotificationDelivery(db, {
      decisionId: itemB.decisionId, lineAccountId: 'account-a',
      leaseId: 'lease-b', leaseExpiresAt: LEASE, now: NOW,
    });
    await completePhotoNotificationDelivery(db, {
      decisionId: itemB.decisionId, lineAccountId: 'account-a',
      generation: claimB!.generation, status: 'failed', error: 'LINE unavailable', now: LATER,
    });
    const healed = await reconcileBulkNotificationOutcomes(db, {
      lineAccountId: 'account-a', items: [itemA, itemB],
    });
    expect(healed.items.map((item) => item.notificationStatus)).toEqual(['sent', 'failed']);
    expect(healed.notificationFailures).toEqual([{ photoId: 'photo-b', error: 'LINE unavailable' }]);
    // 記録に失敗した想定（保存せず）→ 後から保存し、再送時は保存済みを返す。
    await expect(recordBulkDecisionNotificationResult(db, {
      receiptId: 'bulk-reconcile-a', lineAccountId: 'account-a', actorId: 'staff-a',
      idempotencyKey: 'bulk-key-reconcile-a',
      result: { updatedCount: 1, ...healed, reconciled: true },
      now: EXPIRED,
    })).resolves.toBe(true);
  });
});
