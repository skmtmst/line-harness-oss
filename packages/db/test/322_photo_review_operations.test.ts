import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyBulkPhotoDecisions,
  consumePhotoOriginalDownload,
  getPhotoAssetStatus,
  getPhotoDerivatives,
  getPhotoReviewMetrics,
  issuePhotoOriginalDownload,
  recordBulkDecisionNotificationResult,
  requestPhotoAssessment,
  requestPhotoAssetProcessing,
} from '../src/nen-photo-operations.js';
import { asD1 } from './d1-test-helper.js';

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(import.meta.dirname, '..', 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('account-a', 'channel-a', 'A店', 'token', 'secret'),
           ('account-b', 'channel-b', 'B店', 'token', 'secret');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('friend-a', 'Ua', 'Aさん', 'account-a'),
           ('friend-b', 'Ub', 'Bさん', 'account-b');
    INSERT INTO nen_pet_profiles (id, friend_id, name, created_at, updated_at)
    VALUES ('pet-a', 'friend-a', 'ハナ', '2026-09-01', '2026-09-01'),
           ('pet-b', 'friend-b', 'ソラ', '2026-09-01', '2026-09-01');
    INSERT INTO nen_photo_submissions
      (id, friend_id, pet_id, r2_key, image_url, content_type, status, created_at,
       reviewed_at, updated_at, line_account_id, review_image_url, public_image_url, review_version)
    VALUES
      ('photo-safe', 'friend-a', 'pet-a', 'original/safe.jpg', 'legacy-safe', 'image/jpeg',
       'pending', '2026-09-01T00:00:00.000Z', NULL, '2026-09-01T00:00:00.000Z',
       'account-a', 'https://cdn.test/review-safe.jpg', NULL, 1),
      ('photo-risk', 'friend-a', 'pet-a', 'original/risk.jpg', 'legacy-risk', 'image/jpeg',
       'pending', '2026-09-01T01:00:00.000Z', NULL, '2026-09-01T01:00:00.000Z',
       'account-a', NULL, NULL, 2),
      ('photo-reviewed', 'friend-a', 'pet-a', 'original/reviewed.jpg', 'legacy-reviewed', 'image/jpeg',
       'adopted', '2026-09-01T02:00:00.000Z', '2026-09-01T03:00:00.000Z',
       '2026-09-01T03:00:00.000Z', 'account-a', 'https://cdn.test/reviewed.jpg',
       'https://cdn.test/public.jpg', 2),
      ('photo-other', 'friend-b', 'pet-b', 'original/other.jpg', 'legacy-other', 'image/jpeg',
       'pending', '2026-09-01T00:00:00.000Z', NULL, '2026-09-01T00:00:00.000Z',
       'account-b', NULL, NULL, 1);
    INSERT INTO nen_photo_risk_assessments
      (id, photo_id, line_account_id, flag, confidence, assessed_at, created_at)
    VALUES ('risk-safe', 'photo-safe', 'account-a', 'safe', 0.99, '2026-09-01', '2026-09-01'),
           ('risk-attention', 'photo-risk', 'account-a', 'privacy', 0.81, '2026-09-01', '2026-09-01');
  `);
  db = asD1(sqlite);
});

describe('migration 322 photo review operations', () => {
  it('アカウント内の実集計だけを返し、不明な平均値はnullにする', async () => {
    await expect(getPhotoReviewMetrics(db, 'account-a')).resolves.toEqual({
      pendingCount: 2,
      reviewedCount: 1,
      averageReviewMinutes: 60,
      oldestPendingAt: '2026-09-01T00:00:00.000Z',
      attentionCount: 1,
    });
    await expect(getPhotoReviewMetrics(db, 'missing-account')).resolves.toEqual({
      pendingCount: 0, reviewedCount: 0, averageReviewMinutes: null,
      oldestPendingAt: null, attentionCount: 0,
    });
  });

  it('再評価と派生画像処理を版・アカウント・冪等性つきで受付する', async () => {
    const assessmentInput = {
      id: 'assessment-1', photoId: 'photo-safe', lineAccountId: 'account-a', expectedVersion: 1,
      actorId: 'staff-a', idempotencyKey: 'assessment-key-1', requestFingerprint: 'fingerprint-a',
      now: '2026-09-02T00:00:00.000Z',
    };
    await expect(requestPhotoAssessment(db, assessmentInput)).resolves.toMatchObject({
      kind: 'created', run: { status: 'queued', requestedVersion: 1 },
    });
    await expect(requestPhotoAssessment(db, assessmentInput)).resolves.toMatchObject({ kind: 'duplicate' });
    await expect(requestPhotoAssessment(db, { ...assessmentInput, requestFingerprint: 'other' }))
      .resolves.toEqual({ kind: 'idempotency_conflict' });
    await expect(requestPhotoAssessment(db, {
      ...assessmentInput, id: 'assessment-2', idempotencyKey: 'assessment-key-2', expectedVersion: 9,
    })).resolves.toEqual({ kind: 'changed' });

    await expect(requestPhotoAssetProcessing(db, {
      ...assessmentInput, id: 'asset-1', idempotencyKey: 'asset-request-1',
      requestFingerprint: 'asset-fingerprint', operation: 'all',
    })).resolves.toMatchObject({ kind: 'created', run: { operation: 'all', status: 'queued' } });
    await expect(getPhotoAssetStatus(db, { photoId: 'photo-safe', lineAccountId: 'account-a' }))
      .resolves.toMatchObject({ reviewVersion: 1, jobs: [{ id: 'asset-1', status: 'queued' }] });
    await expect(getPhotoDerivatives(db, { photoId: 'photo-safe', lineAccountId: 'account-a' }))
      .resolves.toMatchObject({
        items: [], knownUrls: [{ kind: 'review', url: 'https://cdn.test/review-safe.jpg' }],
      });
    await expect(getPhotoAssetStatus(db, { photoId: 'photo-safe', lineAccountId: 'account-b' }))
      .resolves.toBeNull();
  });

  it('低リスクだけを一括承認し、判断履歴と版を一度だけ更新する', async () => {
    const input = {
      id: 'bulk-1', lineAccountId: 'account-a', actorId: 'staff-a', actorName: '担当者',
      idempotencyKey: 'bulk-request-1', requestFingerprint: 'bulk-fingerprint',
      decisions: [
        { photoId: 'photo-safe', decision: 'approve' as const, expectedVersion: 1, reasonCode: null, reasonNote: null },
        { photoId: 'photo-risk', decision: 'reject' as const, expectedVersion: 2, reasonCode: 'privacy', reasonNote: '個人情報' },
      ],
      now: '2026-09-02T00:00:00.000Z',
    };
    await expect(applyBulkPhotoDecisions(db, input)).resolves.toMatchObject({
      kind: 'created', result: { updatedCount: 2 },
    });
    await expect(applyBulkPhotoDecisions(db, input)).resolves.toMatchObject({ kind: 'duplicate' });
    expect(sqlite.prepare(
      `SELECT id, status, review_version FROM nen_photo_submissions
        WHERE line_account_id = 'account-a' AND id IN ('photo-safe', 'photo-risk') ORDER BY id`,
    ).all()).toEqual([
      { id: 'photo-risk', status: 'rejected', review_version: 3 },
      { id: 'photo-safe', status: 'adopted', review_version: 2 },
    ]);
    expect(sqlite.prepare('SELECT COUNT(*) count FROM nen_photo_review_events').get()).toEqual({ count: 2 });
  });

  it('一括結果に審査イベントIDを載せ、通知後の結果を受付票へ上書きする', async () => {
    const input = {
      id: 'bulk-notify', lineAccountId: 'account-a', actorId: 'staff-a', actorName: '担当者',
      idempotencyKey: 'bulk-notify-key', requestFingerprint: 'bulk-notify-fingerprint',
      decisions: [
        { photoId: 'photo-safe', decision: 'approve' as const, expectedVersion: 1, reasonCode: null, reasonNote: null },
      ],
      now: '2026-09-02T00:00:00.000Z',
    };
    const created = await applyBulkPhotoDecisions(db, input);
    expect(created).toMatchObject({ kind: 'created' });
    const items = (created as { result: { items: Array<{ decisionId: string }> } }).result.items;
    expect(items).toHaveLength(1);
    expect(typeof items[0].decisionId).toBe('string');
    const eventIds = sqlite.prepare('SELECT id FROM nen_photo_review_events').all() as Array<{ id: string }>;
    expect(eventIds.map((row) => row.id)).toEqual([items[0].decisionId]);

    const enriched = {
      updatedCount: 1,
      items: [{ ...items[0], notificationStatus: 'failed' as const }],
      notificationFailures: [{ photoId: 'photo-safe', error: 'LINE unavailable' }],
    };
    await expect(recordBulkDecisionNotificationResult(db, {
      receiptId: 'bulk-notify', lineAccountId: 'account-a', actorId: 'staff-a',
      idempotencyKey: 'bulk-notify-key', result: enriched, now: '2026-09-02T00:01:00.000Z',
    })).resolves.toBe(true);
    // 2回目の保存は通知後の結果をそのまま返し、再送の合図にしない。
    await expect(applyBulkPhotoDecisions(db, input)).resolves.toEqual({ kind: 'duplicate', result: enriched });
    // 別担当・別鍵では上書きできない。
    await expect(recordBulkDecisionNotificationResult(db, {
      receiptId: 'bulk-notify', lineAccountId: 'account-a', actorId: 'staff-other',
      idempotencyKey: 'bulk-notify-key', result: enriched,
    })).resolves.toBe(false);
  });

  it('危険度を確認できない写真の一括承認と別アカウントの写真を拒否する', async () => {
    const base = {
      id: 'bulk-2', lineAccountId: 'account-a', actorId: 'staff-a', actorName: '担当者',
      idempotencyKey: 'bulk-request-2', requestFingerprint: 'bulk-fingerprint-2',
      now: '2026-09-02T00:00:00.000Z',
    };
    await expect(applyBulkPhotoDecisions(db, {
      ...base,
      decisions: [{ photoId: 'photo-risk', decision: 'approve', expectedVersion: 2, reasonCode: null, reasonNote: null }],
    })).resolves.toEqual({ kind: 'risk_not_low', photoId: 'photo-risk' });
    await expect(applyBulkPhotoDecisions(db, {
      ...base, id: 'bulk-3', idempotencyKey: 'bulk-request-3',
      decisions: [{ photoId: 'photo-other', decision: 'reject', expectedVersion: 1, reasonCode: 'privacy', reasonNote: null }],
    })).resolves.toEqual({ kind: 'not_found', photoId: 'photo-other' });
  });

  it('原本取得grantを短命・一回限り・同一担当者とアカウントに限定する', async () => {
    const issued = {
      tokenHash: 'token-hash', photoId: 'photo-safe', lineAccountId: 'account-a', actorId: 'staff-a',
      expectedVersion: 1, idempotencyKey: 'download-key-1', requestFingerprint: 'download-fingerprint',
      expiresAt: '2026-09-02T00:05:00.000Z', now: '2026-09-02T00:00:00.000Z',
    };
    await expect(issuePhotoOriginalDownload(db, issued)).resolves.toEqual({
      kind: 'created', expiresAt: issued.expiresAt,
    });
    await expect(consumePhotoOriginalDownload(db, {
      tokenHash: issued.tokenHash, lineAccountId: 'account-b', actorId: 'staff-a', now: '2026-09-02T00:01:00.000Z',
    })).resolves.toBeNull();
    await expect(consumePhotoOriginalDownload(db, {
      tokenHash: issued.tokenHash, lineAccountId: 'account-a', actorId: 'staff-a', now: '2026-09-02T00:01:00.000Z',
    })).resolves.toEqual({ photoId: 'photo-safe', objectKey: 'original/safe.jpg', contentType: 'image/jpeg' });
    await expect(consumePhotoOriginalDownload(db, {
      tokenHash: issued.tokenHash, lineAccountId: 'account-a', actorId: 'staff-a', now: '2026-09-02T00:02:00.000Z',
    })).resolves.toBeNull();
    expect(sqlite.prepare('SELECT event FROM nen_photo_original_download_audit ORDER BY created_at').all())
      .toEqual([{ event: 'issued' }, { event: 'downloaded' }]);
  });
});
