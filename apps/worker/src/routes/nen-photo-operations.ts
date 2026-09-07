import { Hono, type Context, type Next } from 'hono';
import {
  applyBulkPhotoDecisions,
  consumePhotoOriginalDownload,
  consumeStepUpGrant,
  getPhotoAssetStatus,
  getPhotoDerivatives,
  getPhotoReviewMetrics,
  issuePhotoOriginalDownload,
  requestPhotoAssessment,
  requestPhotoAssetProcessing,
  type BulkPhotoDecision,
} from '@line-crm/db';
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
      decisions.push({
        photoId: raw.photoId.trim(), decision: decision as BulkPhotoDecision['decision'],
        expectedVersion: raw.expectedVersion, reasonCode,
        reasonNote: decision === 'return' ? `[差し戻し] ${reasonNote}`.trim() : reasonNote || null,
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
      const result = await applyBulkPhotoDecisions(c.env.DB, {
        id: crypto.randomUUID(), lineAccountId, actorId: c.get('staff')!.id,
        actorName: c.get('staff')!.name, idempotencyKey: key, requestFingerprint, decisions,
      });
      if (result.kind === 'created' || result.kind === 'duplicate') {
        return c.json({ success: true, duplicate: result.kind === 'duplicate', data: result.result }, result.kind === 'created' ? 201 : 200);
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
