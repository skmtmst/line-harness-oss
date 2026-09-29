import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyBulkPhotoDecisions,
  claimPhotoNotificationDelivery,
  completePhotoNotificationDelivery,
  getBulkDecisionReceipt,
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

  it('友だちが他アカウント所属の写真は確定前に404相当で止める', async () => {
    sqlite.exec(`
      INSERT INTO friends (id, line_user_id, display_name, line_account_id)
      VALUES ('friend-b', 'Ub', 'Bさん', 'account-b');
      INSERT INTO nen_photo_submissions
        (id, friend_id, pet_id, r2_key, image_url, content_type, status, created_at,
         reviewed_at, updated_at, line_account_id, review_image_url, public_image_url, review_version)
      VALUES
        ('photo-c', 'friend-b', 'pet-a', 'original/c.jpg', 'legacy-c', 'image/jpeg',
         'pending', '2026-09-01T02:00:00.000Z', NULL, '2026-09-01T02:00:00.000Z',
         'account-a', 'https://cdn.test/review-c.jpg', NULL, 1);
      INSERT INTO nen_photo_risk_assessments
        (id, photo_id, line_account_id, flag, confidence, assessed_at, created_at)
      VALUES ('risk-c', 'photo-c', 'account-a', 'safe', 0.97, '2026-09-01', '2026-09-01');
    `);
    // 写真行はaccount-aだが友だちはaccount-b所属。単票は通知先照合で404になるため一括も止める。
    await expect(applyBulkPhotoDecisions(db, {
      id: 'bulk-scope', lineAccountId: 'account-a', actorId: 'staff-a', actorName: '担当者',
      idempotencyKey: 'bulk-key-scope', requestFingerprint: 'bulk-fp-scope',
      decisions: [{ photoId: 'photo-c', decision: 'approve', expectedVersion: 1, reasonCode: null, reasonNote: null }],
      now: NOW,
    })).resolves.toEqual({ kind: 'not_found', photoId: 'photo-c' });
    const photo = sqlite.prepare(`SELECT status FROM nen_photo_submissions WHERE id = 'photo-c'`).get() as { status: string };
    expect(photo.status).toBe('pending');
    const receipt = sqlite.prepare(
      `SELECT COUNT(*) AS n FROM nen_photo_bulk_decision_receipts WHERE id = 'bulk-scope'`,
    ).get() as { n: number };
    expect(receipt.n).toBe(0);
  });

  it('宛先不明の失敗は送達台帳へ残し、再送口の拾い上げ対象になる', async () => {
    const item = await decide('photo-a', 'no-recipient');
    // 一括通知の宛先取得失敗時と同じく claim→失敗確定する。
    const claimed = await claimPhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
      leaseId: 'lease-nr', leaseExpiresAt: LEASE, now: NOW,
    });
    await completePhotoNotificationDelivery(db, {
      decisionId: item.decisionId, lineAccountId: 'account-a',
      generation: claimed!.generation, status: 'failed', error: '通知先が見つかりません', now: LATER,
    });
    // 再送口と同じ絞り込み（失敗済み or lease切れの送信中）で拾える。
    const row = sqlite.prepare(
      `SELECT e.id AS decision_id
         FROM nen_photo_submissions ps
         JOIN friends f ON f.id = ps.friend_id
         JOIN line_accounts a ON a.id = f.line_account_id
         JOIN nen_photo_review_events e ON e.photo_id = ps.id
        WHERE ps.id = ? AND ps.line_account_id = ? AND f.line_account_id = ?
          AND (e.notification_status = 'failed'
            OR (e.notification_status = 'sending'
              AND (e.notification_lease_expires_at IS NULL OR e.notification_lease_expires_at <= ?)))
        ORDER BY e.created_at DESC LIMIT 1`,
    ).get('photo-a', 'account-a', 'account-a', LATER) as { decision_id: string } | undefined;
    expect(row?.decision_id).toBe(item.decisionId);
  });

  it('古い復旧結果は確定済みの受付票を上書きしない（受付票CAS）', async () => {
    const created = await applyBulkPhotoDecisions(db, {
      id: 'bulk-cas', lineAccountId: 'account-a', actorId: 'staff-a', actorName: '担当者',
      idempotencyKey: 'bulk-key-cas', requestFingerprint: 'bulk-fp-cas',
      decisions: [{ photoId: 'photo-a', decision: 'approve', expectedVersion: 1, reasonCode: null, reasonNote: null }],
      now: NOW,
    });
    if (created.kind !== 'created') throw new Error(`setup decide failed: ${created.kind}`);
    const item = (created.result as { items: BulkPhotoDecisionItem[] }).items[0];
    const staleHeal = {
      updatedCount: 1,
      items: [{ ...item, notificationStatus: 'failed' as const, notificationError: '送達を確認中です' }],
      notificationFailures: [{ photoId: 'photo-a', error: '送達を確認中です' }],
      reconciled: true,
    };
    const freshResult = {
      updatedCount: 1,
      items: [{ ...item, notificationStatus: 'sent' as const }],
      notificationFailures: [],
    };
    // 確定側が先に保存した後、遅れて届いた古い復旧は書けない。
    await expect(recordBulkDecisionNotificationResult(db, {
      receiptId: 'bulk-cas', lineAccountId: 'account-a', actorId: 'staff-a',
      idempotencyKey: 'bulk-key-cas', result: freshResult, now: LATER,
    })).resolves.toBe(true);
    await expect(recordBulkDecisionNotificationResult(db, {
      receiptId: 'bulk-cas', lineAccountId: 'account-a', actorId: 'staff-a',
      idempotencyKey: 'bulk-key-cas', result: staleHeal, now: EXPIRED, onlyIfPending: true,
    })).resolves.toBe(false);
    const stored = await getBulkDecisionReceipt(db, {
      lineAccountId: 'account-a', actorId: 'staff-a', idempotencyKey: 'bulk-key-cas',
    });
    expect(stored?.result).not.toHaveProperty('reconciled');
    expect((stored?.result as typeof freshResult).items[0].notificationStatus).toBe('sent');
    // 通知前の受付票への復旧は通る。
    const created2 = await applyBulkPhotoDecisions(db, {
      id: 'bulk-cas2', lineAccountId: 'account-a', actorId: 'staff-a', actorName: '担当者',
      idempotencyKey: 'bulk-key-cas2', requestFingerprint: 'bulk-fp-cas2',
      decisions: [{ photoId: 'photo-b', decision: 'approve', expectedVersion: 1, reasonCode: null, reasonNote: null }],
      now: NOW,
    });
    if (created2.kind !== 'created') throw new Error(`setup decide failed: ${created2.kind}`);
    const item2 = (created2.result as { items: BulkPhotoDecisionItem[] }).items[0];
    await expect(recordBulkDecisionNotificationResult(db, {
      receiptId: 'bulk-cas2', lineAccountId: 'account-a', actorId: 'staff-a',
      idempotencyKey: 'bulk-key-cas2',
      result: {
        updatedCount: 1,
        items: [{ ...item2, notificationStatus: 'sent' as const }],
        notificationFailures: [], reconciled: true,
      },
      now: EXPIRED, onlyIfPending: true,
    })).resolves.toBe(true);
  });
});
