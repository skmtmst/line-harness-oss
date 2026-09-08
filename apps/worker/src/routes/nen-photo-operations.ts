import { Hono, type Context, type Next } from 'hono';
import {
  applyBulkPhotoDecisions,
  claimPhotoNotificationDelivery,
  completePhotoNotificationDelivery,
  consumePhotoOriginalDownload,
  consumeStepUpGrant,
  getBulkDecisionReceipt,
  getPhotoAssetStatus,
  getPhotoDerivatives,
  getPhotoReviewMetrics,
  issuePhotoOriginalDownload,
  reconcileBulkNotificationOutcomes,
  recordBulkDecisionNotificationResult,
  requestPhotoAssessment,
  requestPhotoAssetProcessing,
  type BulkNotifiedItem,
  type BulkNotificationResult,
  type BulkPhotoDecision,
  type BulkPhotoDecisionItem,
  type BulkPhotoDecisionResult,
} from '@line-crm/db';
import {
  deliverPhotoReviewNotification,
  loadPhotoReviewRecipient,
  type PhotoReviewReasonCode,
} from './nen-members.js';
import type { Env } from '../index.js';
import { auditLog } from '../lib/audit-log.js';
import { sha256Hex } from '../middleware/auth.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';

export const nenPhotoOperations = new Hono<Env>();

type PhotoPermission =
  | 'photo.submission.view'
  | 'photo.submission.review'
  | 'photo.submission.bulk_review'
  | 'photo.original.download';

export function requirePhotoPermission(permission: PhotoPermission) {
  return async (c: Context<Env>, next: Next) => {
    const staff = c.get('staff');
    if (!staff || (staff.role !== 'owner' && !staff.permissionKeys?.includes(permission))) {
      return c.json({ success: false, error: 'この写真審査操作を行う権限がありません' }, 403);
    }
    await next();
  };
}

async function accountVisible(c: Context<Env>, lineAccountId: string): Promise<boolean> {
  return canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId]);
}

function accountIdFromQuery(c: Context<Env>): string | null {
  return c.req.query('accountId')?.trim() || null;
}

function validVersion(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function idempotencyKey(c: Context<Env>): string | null {
  const key = c.req.header('Idempotency-Key')?.trim() ?? '';
  return key.length >= 8 && key.length <= 200 ? key : null;
}

function randomToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function queueError(c: Context<Env>, kind: string) {
  if (kind === 'not_found') return c.json({ success: false, error: '写真が見つかりません' }, 404);
  if (kind === 'changed') return c.json({ success: false, error: '写真が更新されています', code: 'VERSION_CONFLICT' }, 409);
  return c.json({ success: false, error: '同じ再実行キーが別の入力に使われています', code: 'IDEMPOTENCY_CONFLICT' }, 409);
}

nenPhotoOperations.get(
  '/api/nen-members/photos/review-metrics',
  requirePhotoPermission('photo.submission.view'),
  async (c) => {
    const accountId = accountIdFromQuery(c);
    if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    if (!await accountVisible(c, accountId)) return c.json({ success: false, error: '写真審査情報が見つかりません' }, 404);
    try {
      return c.json({ success: true, data: await getPhotoReviewMetrics(c.env.DB, accountId) });
    } catch (error) {
      console.error('GET photo review metrics error:', error);
      return c.json({ success: false, error: '写真審査の集計を取得できませんでした' }, 500);
    }
  },
);

nenPhotoOperations.post(
  '/api/nen-members/photos/:id/assessments/re-evaluate',
  requireRole('owner', 'admin', 'staff'),
  requirePhotoPermission('photo.submission.review'),
  async (c) => {
    type Body = { lineAccountId?: unknown; expectedVersion?: unknown };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    const key = idempotencyKey(c);
    if (typeof body.lineAccountId !== 'string' || !body.lineAccountId.trim()
      || !validVersion(body.expectedVersion) || !key) {
      return c.json({ success: false, error: '対象アカウント、版、再実行キーを確認してください' }, 400);
    }
    const lineAccountId = body.lineAccountId.trim();
    if (!await accountVisible(c, lineAccountId)) return c.json({ success: false, error: '写真が見つかりません' }, 404);
    auditLog(c, 'photo.assessment.request', { kind: 'nen-photo', id: c.req.param('id') });
    try {
      const result = await requestPhotoAssessment(c.env.DB, {
        id: crypto.randomUUID(), photoId: c.req.param('id'), lineAccountId,
        expectedVersion: body.expectedVersion, actorId: c.get('staff')!.id,
        idempotencyKey: key,
        requestFingerprint: await sha256Hex(JSON.stringify({
          photoId: c.req.param('id'), lineAccountId, expectedVersion: body.expectedVersion,
        })),
      });
      if (result.kind === 'created' || result.kind === 'duplicate') {
        return c.json({ success: true, duplicate: result.kind === 'duplicate', data: result.run }, result.kind === 'created' ? 202 : 200);
      }
      return queueError(c, result.kind);
    } catch (error) {
      console.error('POST photo assessment re-evaluate error:', error);
      return c.json({ success: false, error: '写真の再評価を受け付けられませんでした' }, 500);
    }
  },
);

nenPhotoOperations.post(
  '/api/nen-members/photos/:id/assets/process',
  requireRole('owner', 'admin', 'staff'),
  requirePhotoPermission('photo.submission.review'),
  async (c) => {
    type Body = { lineAccountId?: unknown; expectedVersion?: unknown; operation?: unknown };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    const key = idempotencyKey(c);
    const operation = body.operation;
    if (typeof body.lineAccountId !== 'string' || !body.lineAccountId.trim()
      || !validVersion(body.expectedVersion) || !key
      || !['review', 'public', 'thumbnail', 'all'].includes(String(operation))) {
      return c.json({ success: false, error: '対象、処理内容、版、再実行キーを確認してください' }, 400);
    }
    const lineAccountId = body.lineAccountId.trim();
    if (!await accountVisible(c, lineAccountId)) return c.json({ success: false, error: '写真が見つかりません' }, 404);
    auditLog(c, 'photo.asset.request', { kind: 'nen-photo', id: c.req.param('id') });
    try {
      const result = await requestPhotoAssetProcessing(c.env.DB, {
        id: crypto.randomUUID(), photoId: c.req.param('id'), lineAccountId,
        operation: operation as 'review' | 'public' | 'thumbnail' | 'all',
        expectedVersion: body.expectedVersion, actorId: c.get('staff')!.id,
        idempotencyKey: key,
        requestFingerprint: await sha256Hex(JSON.stringify({
          photoId: c.req.param('id'), lineAccountId, expectedVersion: body.expectedVersion, operation,
        })),
      });
      if (result.kind === 'created' || result.kind === 'duplicate') {
        return c.json({ success: true, duplicate: result.kind === 'duplicate', data: result.run }, result.kind === 'created' ? 202 : 200);
      }
      return queueError(c, result.kind);
    } catch (error) {
      console.error('POST photo asset process error:', error);
      return c.json({ success: false, error: '派生画像処理を受け付けられませんでした' }, 500);
    }
  },
);

nenPhotoOperations.get(
  '/api/nen-members/photos/:id/assets/status',
  requirePhotoPermission('photo.submission.view'),
  async (c) => {
    const photoId = c.req.param('id');
    const accountId = accountIdFromQuery(c);
    if (!photoId || !accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    if (!await accountVisible(c, accountId)) return c.json({ success: false, error: '写真が見つかりません' }, 404);
    try {
      const data = await getPhotoAssetStatus(c.env.DB, { photoId, lineAccountId: accountId });
      return data ? c.json({ success: true, data }) : c.json({ success: false, error: '写真が見つかりません' }, 404);
    } catch (error) {
      console.error('GET photo asset status error:', error);
      return c.json({ success: false, error: '派生画像の処理状況を取得できませんでした' }, 500);
    }
  },
);

nenPhotoOperations.get(
  '/api/nen-members/photos/:id/assets/derivatives',
  requirePhotoPermission('photo.submission.view'),
  async (c) => {
    const photoId = c.req.param('id');
    const accountId = accountIdFromQuery(c);
    if (!photoId || !accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    if (!await accountVisible(c, accountId)) return c.json({ success: false, error: '写真が見つかりません' }, 404);
    try {
      const data = await getPhotoDerivatives(c.env.DB, { photoId, lineAccountId: accountId });
      return data ? c.json({ success: true, data }) : c.json({ success: false, error: '写真が見つかりません' }, 404);
    } catch (error) {
      console.error('GET photo derivatives error:', error);
      return c.json({ success: false, error: '派生画像を取得できませんでした' }, 500);
    }
  },
);

nenPhotoOperations.post(
  '/api/nen-members/photos/decisions/bulk',
  requireRole('owner', 'admin', 'staff'),
  requirePhotoPermission('photo.submission.bulk_review'),
  async (c) => {
    type Decision = { photoId?: unknown; decision?: unknown; expectedVersion?: unknown; reasonCode?: unknown; reasonNote?: unknown };
    type Body = { lineAccountId?: unknown; decisions?: unknown };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    const key = idempotencyKey(c);
    if (typeof body.lineAccountId !== 'string' || !body.lineAccountId.trim()
      || !Array.isArray(body.decisions) || body.decisions.length < 1 || body.decisions.length > 50 || !key) {
      return c.json({ success: false, error: '対象アカウント、1〜50件の判断、再実行キーを指定してください' }, 400);
    }
    const allowedReasons = new Set(['quality', 'privacy', 'unrelated', 'duplicate', 'other']);
    const decisions: BulkPhotoDecision[] = [];
    for (const raw of body.decisions as Decision[]) {
      const decision = String(raw.decision ?? '');
      const reasonCode = decision === 'approve' ? null : String(raw.reasonCode ?? '');
      const reasonNote = typeof raw.reasonNote === 'string' ? raw.reasonNote.trim().slice(0, 500) : '';
      if (typeof raw.photoId !== 'string' || !raw.photoId.trim()
        || !['approve', 'return', 'reject'].includes(decision) || !validVersion(raw.expectedVersion)
        || (decision !== 'approve' && !allowedReasons.has(reasonCode ?? ''))
        || (reasonCode === 'other' && !reasonNote)) {
        return c.json({ success: false, error: '写真、判断、理由、版を確認してください' }, 400);
      }
      // 単体審査と同じく補足は素で保存する（#500 軽）。
      // 一括だけ `[差し戻し]` を付けると「見送った理由」の表示が単体とずれる。
      decisions.push({
        photoId: raw.photoId.trim(), decision: decision as BulkPhotoDecision['decision'],
        expectedVersion: raw.expectedVersion, reasonCode,
        reasonNote: reasonNote || null,
      });
    }
    if (new Set(decisions.map((decision) => decision.photoId)).size !== decisions.length) {
      return c.json({ success: false, error: '同じ写真を重複して指定できません' }, 400);
    }
    const lineAccountId = body.lineAccountId.trim();
    if (!await accountVisible(c, lineAccountId)) return c.json({ success: false, error: '写真が見つかりません' }, 404);
    auditLog(c, 'photo.review.bulk', { kind: 'nen-photo' });
    try {
      const requestFingerprint = await sha256Hex(JSON.stringify({ lineAccountId, decisions }));
      const receiptId = crypto.randomUUID();
      const result = await applyBulkPhotoDecisions(c.env.DB, {
        id: receiptId, lineAccountId, actorId: c.get('staff')!.id,
        actorName: c.get('staff')!.name, idempotencyKey: key, requestFingerprint, decisions,
      });
      if (result.kind === 'duplicate') {
        // 保存済み結果を返すだけで、LINEは再送しない（重複通知防止）。
        // 通知後の記録に失敗して受付票が古いままのときは、送達台帳から作り直す。
        const healed = await healBulkDecisionReceipt(c, {
          lineAccountId, idempotencyKey: key, stored: result.result,
        });
        return c.json({ success: true, duplicate: true, data: healed ?? result.result }, 200);
      }
      if (result.kind === 'created') {
        const data = await notifyBulkPhotoDecisions(c, {
          receiptId, lineAccountId, idempotencyKey: key, decisions, result: result.result,
        });
        return c.json({ success: true, duplicate: false, data }, 201);
      }
      if (result.kind === 'not_found') return c.json({ success: false, error: '写真が見つかりません', photoId: result.photoId }, 404);
      if (result.kind === 'risk_not_low') {
        return c.json({ success: false, error: '一括承認は低リスクと確認できた写真だけ実行できます', photoId: result.photoId }, 409);
      }
      return queueError(c, result.kind);
    } catch (error) {
      console.error('POST bulk photo decisions error:', error);
      return c.json({ success: false, error: '写真の一括審査を完了できませんでした' }, 500);
    }
  },
);

nenPhotoOperations.post(
  '/api/nen-members/photos/:id/original-download',
  requireRole('owner', 'admin', 'staff'),
  requirePhotoPermission('photo.original.download'),
  async (c) => {
    type Body = { lineAccountId?: unknown; expectedVersion?: unknown };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    const key = idempotencyKey(c);
    if (typeof body.lineAccountId !== 'string' || !body.lineAccountId.trim()
      || !validVersion(body.expectedVersion) || !key) {
      return c.json({ success: false, error: '対象アカウント、版、再実行キーを確認してください' }, 400);
    }
    const lineAccountId = body.lineAccountId.trim();
    if (!await accountVisible(c, lineAccountId)) return c.json({ success: false, error: '写真が見つかりません' }, 404);
    const stepUpToken = c.req.header('X-Step-Up-Token')?.trim();
    if (!stepUpToken || !await consumeStepUpGrant(c.env.DB, {
      tokenHash: await sha256Hex(stepUpToken), staffId: c.get('staff')!.id,
      purpose: 'photo.original.download',
    })) {
      return c.json({ success: false, error: '原本取得には二段階認証による再認証が必要です', code: 'STEP_UP_REQUIRED' }, 428);
    }
    auditLog(c, 'photo.original.issue', { kind: 'nen-photo', id: c.req.param('id') });
    try {
      const token = randomToken();
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      const requestFingerprint = await sha256Hex(JSON.stringify({
        photoId: c.req.param('id'), lineAccountId, expectedVersion: body.expectedVersion,
      }));
      const result = await issuePhotoOriginalDownload(c.env.DB, {
        tokenHash: await sha256Hex(token), photoId: c.req.param('id'), lineAccountId,
        actorId: c.get('staff')!.id, expectedVersion: body.expectedVersion,
        idempotencyKey: key, requestFingerprint, expiresAt,
      });
      if (result.kind !== 'created' && result.kind !== 'duplicate') return queueError(c, result.kind);
      const downloadUrl = `/api/nen-members/photos/original-download/${encodeURIComponent(token)}?accountId=${encodeURIComponent(lineAccountId)}`;
      return c.json({
        success: true, duplicate: result.kind === 'duplicate',
        data: { downloadUrl, expiresAt: result.expiresAt, oneTime: true },
      }, result.kind === 'created' ? 201 : 200);
    } catch (error) {
      console.error('POST photo original download issue error:', error);
      return c.json({ success: false, error: '原本の取得URLを発行できませんでした' }, 500);
    }
  },
);

nenPhotoOperations.get(
  '/api/nen-members/photos/original-download/:token',
  requirePhotoPermission('photo.original.download'),
  async (c) => {
    const token = c.req.param('token');
    const accountId = accountIdFromQuery(c);
    if (!token || !accountId || !await accountVisible(c, accountId)) {
      return c.json({ success: false, error: '原本が見つかりません' }, 404);
    }
    try {
      const download = await consumePhotoOriginalDownload(c.env.DB, {
        tokenHash: await sha256Hex(token),
        lineAccountId: accountId, actorId: c.get('staff')!.id,
      });
      if (!download) return c.json({ success: false, error: '取得URLが期限切れか、使用済みです' }, 404);
      const object = await c.env.IMAGES.get(download.objectKey);
      if (!object) return c.json({ success: false, error: '原本が見つかりません' }, 404);
      auditLog(c, 'photo.original.download', { kind: 'nen-photo', id: download.photoId });
      return new Response(object.body, {
        headers: {
          'Content-Type': download.contentType,
          'Content-Disposition': `attachment; filename="photo-${download.photoId}"`,
          'Cache-Control': 'private, no-store',
        },
      });
    } catch (error) {
      console.error('GET photo original download error:', error);
      return c.json({ success: false, error: '原本を取得できませんでした' }, 500);
    }
  },
);

function bulkNotificationItems(result: unknown): BulkPhotoDecisionItem[] {
  if (!result || typeof result !== 'object') return [];
  const items = (result as { items?: unknown }).items;
  return Array.isArray(items) ? items as BulkPhotoDecisionItem[] : [];
}

function bulkStoredItemsHaveOutcomes(stored: unknown): stored is BulkPhotoDecisionResult {
  if (!stored || typeof stored !== 'object') return false;
  const items = (stored as { items?: unknown }).items;
  return Array.isArray(items) && items.length > 0
    && items.every((item) => item && typeof item === 'object'
      && typeof (item as { decisionId?: unknown }).decisionId === 'string'
      && typeof (item as { notificationStatus?: unknown }).notificationStatus === 'string');
}

/*
 * 受付票が通知前の結果のままのとき、送達台帳から作り直して受付票へ戻す。
 * 通知後の記録に失敗しても、次の同じ再実行鍵で結果が復旧する。
 */
async function healBulkDecisionReceipt(
  c: Context<Env>,
  input: { lineAccountId: string; idempotencyKey: string; stored: unknown },
): Promise<BulkNotificationResult | null> {
  if (bulkStoredItemsHaveOutcomes(input.stored)) return null;
  if (!input.stored || typeof input.stored !== 'object') return null;
  const storedItems = bulkNotificationItems(input.stored);
  if (storedItems.length === 0 || storedItems.some((item) => !item.decisionId)) return null;
  const healed = await reconcileBulkNotificationOutcomes(c.env.DB, {
    lineAccountId: input.lineAccountId, items: storedItems,
  });
  const updatedCount = typeof (input.stored as { updatedCount?: unknown }).updatedCount === 'number'
    ? (input.stored as { updatedCount: number }).updatedCount
    : healed.items.length;
  const data: BulkNotificationResult = {
    updatedCount, items: healed.items, notificationFailures: healed.notificationFailures,
    reconciled: true,
  };
  try {
    const receipt = await getBulkDecisionReceipt(c.env.DB, {
      lineAccountId: input.lineAccountId, actorId: c.get('staff')!.id, idempotencyKey: input.idempotencyKey,
    });
    const recorded = receipt
      ? await recordBulkDecisionNotificationResult(c.env.DB, {
        receiptId: receipt.receiptId, lineAccountId: input.lineAccountId,
        actorId: c.get('staff')!.id, idempotencyKey: input.idempotencyKey, result: data,
        // 復旧側は通知前の受付票だけ直す。確定側の新しい結果を古い復旧で上書きしない。
        onlyIfPending: true,
      })
      : false;
    if (!recorded) console.error('heal bulk decision receipt failed', input.idempotencyKey);
  } catch (error) {
    console.error('heal bulk decision receipt failed', input.idempotencyKey, error);
  }
  return data;
}

/*
 * 一括審査の各対象へ、単票と同じ送達状態機械でLINE通知を送る。
 * 一部が失敗しても残りを続け、失敗分は既存の通知再送口で再試行できる。
 * 通知フェーズの成否は審査自体の確定（201）を覆さない。
 */
async function notifyBulkPhotoDecisions(
  c: Context<Env>,
  input: {
    receiptId: string;
    lineAccountId: string;
    idempotencyKey: string;
    decisions: BulkPhotoDecision[];
    result: unknown;
  },
): Promise<BulkNotificationResult> {
  const byPhoto = new Map(input.decisions.map((decision) => [decision.photoId, decision]));
  const items = bulkNotificationItems(input.result);
  const notified: BulkNotifiedItem[] = [];
  const notificationFailures: Array<{ photoId: string; error: string }> = [];
  for (const item of items) {
    const decision = byPhoto.get(item.photoId);
    const recipient = await loadPhotoReviewRecipient(c.env.DB, {
      photoId: item.photoId, lineAccountId: input.lineAccountId,
    }).catch(() => null);
    if (!recipient) {
      const notificationError = '通知先が見つかりません';
      // 送達台帳へ失敗として残す。pendingのままでは再送口の拾い上げ対象外になる。
      try {
        const claimed = await claimPhotoNotificationDelivery(c.env.DB, {
          decisionId: item.decisionId, lineAccountId: input.lineAccountId,
          leaseId: crypto.randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        });
        if (claimed) {
          await completePhotoNotificationDelivery(c.env.DB, {
            decisionId: item.decisionId, lineAccountId: input.lineAccountId,
            generation: claimed.generation, status: 'failed', error: notificationError,
          });
        }
      } catch (error) {
        console.error('bulk photo decision recipient failure record failed', item.decisionId, error);
      }
      notified.push({ ...item, notificationStatus: 'failed', notificationError });
      notificationFailures.push({ photoId: item.photoId, error: notificationError });
      continue;
    }
    const delivery = await deliverPhotoReviewNotification(c.env.DB, c, recipient, {
      lineAccountId: input.lineAccountId,
      photoId: item.photoId,
      status: decision?.decision === 'approve' ? 'adopted' : 'rejected',
      reasonCode: decision?.decision === 'approve'
        ? null
        : (decision?.reasonCode ?? null) as PhotoReviewReasonCode | null,
      reasonNote: decision?.reasonNote ?? null,
      decisionId: item.decisionId,
    });
    notified.push({
      ...item,
      notificationStatus: delivery.notificationStatus,
      ...(delivery.notificationError ? { notificationError: delivery.notificationError } : {}),
    });
    if (delivery.notificationStatus === 'failed' && delivery.notificationError) {
      notificationFailures.push({ photoId: item.photoId, error: delivery.notificationError });
    }
  }
  const updatedCount = typeof (input.result as { updatedCount?: unknown }).updatedCount === 'number'
    ? (input.result as { updatedCount: number }).updatedCount
    : notified.length;
  const data: BulkNotificationResult = { updatedCount, items: notified, notificationFailures };
  try {
    const recorded = await recordBulkDecisionNotificationResult(c.env.DB, {
      receiptId: input.receiptId, lineAccountId: input.lineAccountId,
      actorId: c.get('staff')!.id, idempotencyKey: input.idempotencyKey, result: data,
    });
    // false も握りつぶさない。次の同じ再実行鍵で送達台帳から作り直す。
    if (!recorded) console.error('POST bulk photo decisions notification record failed', input.idempotencyKey);
  } catch (error) {
    console.error('POST bulk photo decisions notification record error:', error);
  }
  return data;
}
