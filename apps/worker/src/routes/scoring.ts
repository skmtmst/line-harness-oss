import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  getScoringRules,
  listMileageRewardFolders,
  createMileageRewardFolder,
  reorderMileageRewardFolders,
  moveMileageRewardToFolder,
  getScoringRuleById,
  createScoringRule,
  updateScoringRule,
  deleteScoringRule,
  getFriendById,
  getFriendScore,
  getFriendScoreHistory,
  addScore,
  getMileageRules,
  getMileageRuleById,
  createMileageRule,
  updateMileageRule,
  deleteMileageRule,
  getMileageAdminOverview,
  getMileageAdminHistory,
  getMileageEarningRulesV6,
  getMileageFriendsV6,
  getMileageHistoryPeriodSummary,
  getMileageRewardReachMetrics,
  applyMileageRulesForEvent,
  getMileageManualAdjustmentPolicy,
  setMileageManualAdjustmentPolicy,
  getMileageAdjustmentNotificationRecord,
  findCommittedMileageAdjustment,
  postMileageAdjustment,
  MileageAdjustmentError,
  MileageV6Error,
  saveMileageEarningRuleDraft,
  getActionScoreOverview,
  getActionScoreBands,
  createMileageRewardDraft,
  createMileageRewardDraftFromPublished,
  getMileageReward,
  getMileageRewardAdminOverview,
  getMileageRedemption,
  isMileageRefundComplete,
  listMileageRedemptions,
  refundMileageRewardRedemption,
  importMileageRewardCodes,
  publishMileageReward,
  reorderMileageEarningRules,
  reorderMileageRewards,
  reserveMileageRewardRedemption,
  setMileageRewardStatus,
  updateMileageRewardDraft,
  encryptCredential,
  MileageRewardError,
  publishMileageEarningRule,
  ensureDefaultMileageProgram,
  jstNow,
  confirmPendingMileageEntry,
  voidMileageLedgerEntry,
  createMileageAdjustmentApprovalRequest,
  listMileageAdjustmentApprovalRequests,
  approveMileageAdjustmentRequest,
  rejectMileageAdjustmentRequest,
  cancelMileageAdjustmentRequest,
  testMileageEarningRuleDraft,
  validateMileageEarningRuleDraft,
} from '@line-crm/db';
import type {
  ActionScoreFilter,
  ActionScoreSort,
  MileageEntryStatus,
  MileageEntryType,
  MileageRedemptionListStatus,
  MileageRuleRow,
  MileageRewardDraftInput,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { auditLog } from '../lib/audit-log.js';
import { requireIrreversibleConfirmation, requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { resolveRequestBoundary } from '../services/request-boundary.js';
import {
  completeOutboundSendStatement,
  hashOutboundPayload,
  isValidIdempotencyKey,
  reserveOutboundSend,
} from '../services/outbound-idempotency.js';
import { sha256Hex } from '../middleware/auth.js';
import { deliverMileageReward } from '../services/mileage-reward-delivery.js';
import {
  mileageAdjustmentMessage,
  sendMileageAdjustmentNotification,
} from '../services/mileage-adjustment-notification.js';

const scoring = new Hono<Env>();

function mileageRewardError(c: Parameters<typeof auditLog>[0], error: unknown) {
  if (error instanceof MileageRewardError) {
    return c.json({ success: false, error: error.message, code: error.code }, error.status as 400);
  }
  console.error('mileage rewards error:', error);
  return c.json({ success: false, error: '使い道を処理できませんでした' }, 500);
}

function mileageV6Error(c: Parameters<typeof auditLog>[0], error: unknown) {
  if (error instanceof MileageV6Error) {
    return c.json({
      success: false,
      error: error.message,
      code: error.code,
      ...(error.field ? { field: error.field } : {}),
    }, error.status as 400);
  }
  console.error('mileage V6 API error:', error);
  return c.json({ success: false, error: 'マイル情報を処理できませんでした' }, 500);
}

async function canUseMileageAccount(c: Parameters<typeof auditLog>[0], accountId: string) {
  if (!accountId) return false;
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  return scope.allowedAccountIds.includes(accountId);
}

/*
 * 友だちの可視検査。`friends.ts` の `requireVisibleFriend` と同じ約束:
 * 担当外・別アカウントの友だちは「いない」ものとして 404 を返す。
 * スコアの口だけ別実装にしないため、振る舞いをここに寄せる。
 */
const requireVisibleFriendForScore: MiddlewareHandler<Env> = async (c, next) => {
  const friend = await getFriendById(c.env.DB, c.req.param('id') ?? '');
  const accountId = (friend as unknown as Record<string, unknown> | null)?.line_account_id as string | null ?? null;
  if (!friend || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Friend not found' }, 404);
  }
  await next();
};

function serializeMileageRule(rule: MileageRuleRow) {
  let conditions: Record<string, unknown> = {};
  if (rule.conditions) {
    try { conditions = JSON.parse(rule.conditions) as Record<string, unknown>; } catch { conditions = {}; }
  }
  return {
    id: rule.id,
    name: rule.name,
    eventType: rule.event_type,
    source: rule.source,
    amount: rule.amount,
    initialStatus: rule.initial_status,
    conditions,
    // 334(#521): 帰属アカウント。null は変更不可の既存全店ルール。
    lineAccountId: rule.line_account_id ?? null,
    isActive: Boolean(rule.is_active),
    validFrom: rule.valid_from,
    validUntil: rule.valid_until,
    createdAt: rule.created_at,
    updatedAt: rule.updated_at,
  };
}

function publicMileageRedemption(redemption: Awaited<ReturnType<typeof getMileageRedemption>>) {
  if (!redemption) return null;
  const { idempotencyKey: _idempotencyKey, requestFingerprint: _requestFingerprint, ...safe } = redemption;
  return safe;
}

async function handleMileageRewardDraftUpdate(c: Context<Env>) {
  try {
    const body = await c.req.json<{
      accountId?: unknown;
      expectedVersionId?: unknown;
      expectedRevision?: unknown;
      draft?: MileageRewardDraftInput;
    }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    const expectedVersionId = typeof body.expectedVersionId === 'string'
      ? body.expectedVersionId.trim()
      : '';
    const expectedRevision = typeof body.expectedRevision === 'number'
      && Number.isInteger(body.expectedRevision) && body.expectedRevision >= 1
      ? body.expectedRevision
      : null;
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
    }
    if (!body.draft || !expectedVersionId || expectedRevision == null) {
      return c.json({ success: false, error: '読み込んだ版と変更内容が必要です' }, 400);
    }
    const reward = await updateMileageRewardDraft(c.env.DB, {
      id: c.req.param('id') ?? '', lineAccountId: accountId, expectedVersionId, expectedRevision,
      updatedBy: c.get('staff').id, draft: body.draft,
    });
    auditLog(c, 'mileage.reward.update', { kind: 'mileage_reward', id: reward.id });
    return c.json({ success: true, data: reward });
  } catch (error) {
    return mileageRewardError(c, error);
  }
}

// ========== マイル管理 ==========

// 使い道の分類はLINEアカウントごと。分類の変更は交換内容や公開版を変えない。
scoring.get('/api/mileage/reward-folders', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!await canUseMileageAccount(c, accountId)) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: await listMileageRewardFolders(c.env.DB, accountId) });
  } catch (error) { return mileageRewardError(c, error); }
});
scoring.post('/api/mileage/reward-folders', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: unknown; name?: unknown }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!await canUseMileageAccount(c, accountId)) return c.json({ success: false, error: 'Not found' }, 404);
    if (typeof body.name !== 'string') return c.json({ success: false, error: 'フォルダ名を入力してください' }, 422);
    return c.json({ success: true, data: await createMileageRewardFolder(c.env.DB, accountId, body.name) }, 201);
  } catch (error) { return mileageRewardError(c, error); }
});
scoring.put('/api/mileage/reward-folders/order', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: unknown; ids?: unknown }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!await canUseMileageAccount(c, accountId)) return c.json({ success: false, error: 'Not found' }, 404);
    if (!Array.isArray(body.ids) || body.ids.some((id) => typeof id !== 'string')) return c.json({ success: false, error: 'フォルダの順番を指定してください' }, 422);
    await reorderMileageRewardFolders(c.env.DB, accountId, body.ids);
    return c.json({ success: true, data: await listMileageRewardFolders(c.env.DB, accountId) });
  } catch (error) { return mileageRewardError(c, error); }
});
scoring.put('/api/mileage/rewards/:id/folder', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: unknown; folderId?: unknown }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!await canUseMileageAccount(c, accountId)) return c.json({ success: false, error: 'Not found' }, 404);
    if (body.folderId !== null && (typeof body.folderId !== 'string' || !body.folderId)) return c.json({ success: false, error: 'フォルダか未分類を指定してください' }, 422);
    await moveMileageRewardToFolder(c.env.DB, accountId, c.req.param('id'), body.folderId);
    return c.json({ success: true, data: await getMileageReward(c.env.DB, { id: c.req.param('id'), lineAccountId: accountId }) });
  } catch (error) { return mileageRewardError(c, error); }
});

scoring.get('/api/mileage/rewards', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
    }
    const [overview, reachMetrics] = await Promise.all([
      getMileageRewardAdminOverview(c.env.DB, accountId),
      getMileageRewardReachMetrics(c.env.DB, accountId),
    ]);
    return c.json({
      success: true,
      data: {
        ...overview,
        reachMetrics,
        rankBenefits: reachMetrics.filter((item) => item.rewardKind === 'rank'),
        measuredAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return mileageRewardError(c, error);
  }
});

scoring.get('/api/mileage/rewards/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
    }
    const reward = await getMileageReward(c.env.DB, { id: c.req.param('id'), lineAccountId: accountId });
    if (!reward) return c.json({ success: false, error: '使い道が見つかりません' }, 404);
    return c.json({ success: true, data: reward });
  } catch (error) {
    return mileageRewardError(c, error);
  }
});

scoring.post('/api/mileage/rewards', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: unknown; draft?: MileageRewardDraftInput }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
    }
    if (!body.draft) return c.json({ success: false, error: '使い道の内容を入力してください' }, 400);
    const reward = await createMileageRewardDraft(c.env.DB, {
      lineAccountId: accountId,
      createdBy: c.get('staff').id,
      draft: body.draft,
    });
    auditLog(c, 'mileage.reward.create', { kind: 'mileage_reward', id: reward.id });
    return c.json({ success: true, data: reward }, 201);
  } catch (error) {
    return mileageRewardError(c, error);
  }
});

scoring.patch(
  '/api/mileage/rewards/:id/draft',
  requireRole('owner', 'admin'),
  handleMileageRewardDraftUpdate,
);

// 旧画面が段階的に移行できる間だけ、同じ契約をPUTでも受ける。
scoring.put(
  '/api/mileage/rewards/:id/draft',
  requireRole('owner', 'admin'),
  handleMileageRewardDraftUpdate,
);

scoring.post('/api/mileage/rewards/:id/draft', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: unknown }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
    }
    const reward = await createMileageRewardDraftFromPublished(c.env.DB, {
      id: c.req.param('id'), lineAccountId: accountId, createdBy: c.get('staff').id,
    });
    return c.json({ success: true, data: reward }, 201);
  } catch (error) {
    return mileageRewardError(c, error);
  }
});

scoring.post(
  '/api/mileage/rewards/:id/publish',
  requireRole('owner', 'admin'),
  requireIrreversibleConfirmation('mileage-reward-publish'),
  async (c) => {
    try {
      const body = await c.req.json<{
        accountId?: unknown;
        expectedVersionId?: unknown;
        expectedRevision?: unknown;
      }>();
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      const expectedVersionId = typeof body.expectedVersionId === 'string'
        && body.expectedVersionId.trim() ? body.expectedVersionId.trim() : null;
      const expectedRevision = typeof body.expectedRevision === 'number'
        && Number.isInteger(body.expectedRevision) && body.expectedRevision >= 1
        ? body.expectedRevision
        : null;
      if (!await canUseMileageAccount(c, accountId)) {
        return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
      }
      const reward = await publishMileageReward(c.env.DB, {
        id: c.req.param('id'), lineAccountId: accountId, publishedBy: c.get('staff').id,
        expectedVersionId, expectedRevision,
      });
      auditLog(c, 'mileage.reward.publish', { kind: 'mileage_reward', id: reward.id });
      return c.json({ success: true, data: reward });
    } catch (error) {
      return mileageRewardError(c, error);
    }
  },
);

scoring.post('/api/mileage/rewards/:id/test', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: unknown }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
    }
    const reward = await getMileageReward(c.env.DB, { id: c.req.param('id'), lineAccountId: accountId });
    if (!reward?.currentVersion) {
      return c.json({ success: false, error: '使い道が見つかりません' }, 404);
    }
    const canDeliver = reward.rewardKind !== 'coupon' || (reward.availableCodeCount ?? 0) > 0;
    return c.json({
      success: true,
      data: {
        rewardId: reward.id,
        versionId: reward.currentVersion.id,
        requiredMiles: reward.currentVersion.requiredMiles,
        canDeliver,
        warning: canDeliver ? null : '交換コードを1件以上登録してください',
        ledgerChanged: false,
      },
    });
  } catch (error) {
    return mileageRewardError(c, error);
  }
});

scoring.post('/api/mileage/rewards/:id/stop', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: unknown }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
    }
    const reward = await setMileageRewardStatus(c.env.DB, {
      id: c.req.param('id'), lineAccountId: accountId, status: 'stopped',
    });
    auditLog(c, 'mileage.reward.status', { kind: 'mileage_reward', id: reward.id });
    return c.json({ success: true, data: reward });
  } catch (error) {
    return mileageRewardError(c, error);
  }
});

scoring.post('/api/mileage/rewards/:id/status', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: unknown; status?: unknown }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    const status = body.status === 'published' || body.status === 'stopped' || body.status === 'archived'
      ? body.status
      : null;
    if (!status) return c.json({ success: false, error: '状態を確認してください' }, 400);
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
    }
    const reward = await setMileageRewardStatus(c.env.DB, {
      id: c.req.param('id'), lineAccountId: accountId, status,
    });
    auditLog(c, 'mileage.reward.status', { kind: 'mileage_reward', id: reward.id });
    return c.json({ success: true, data: reward });
  } catch (error) {
    return mileageRewardError(c, error);
  }
});

scoring.put('/api/mileage/rewards-order', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: unknown; ids?: unknown }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
    }
    const ids = Array.isArray(body.ids) && body.ids.every((id) => typeof id === 'string')
      ? body.ids as string[]
      : [];
    await reorderMileageRewards(c.env.DB, { lineAccountId: accountId, ids });
    return c.json({ success: true, data: null });
  } catch (error) {
    return mileageRewardError(c, error);
  }
});

scoring.post('/api/mileage/rewards/:id/codes', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: unknown; codes?: unknown }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
    }
    const codes = Array.isArray(body.codes)
      ? [...new Set(body.codes.filter((code): code is string => typeof code === 'string')
        .map((code) => code.trim()).filter(Boolean))]
      : [];
    if (!codes.length || codes.length > 10_000) {
      return c.json({ success: false, error: '交換コードは1〜10,000件で登録してください' }, 400);
    }
    const protectedCodes = await Promise.all(codes.map(async (code) => ({
      ciphertext: await encryptCredential(code, c.env.LINE_CREDENTIAL_ENCRYPTION_KEY),
      fingerprint: await sha256Hex(code),
    })));
    const result = await importMileageRewardCodes(c.env.DB, {
      rewardId: c.req.param('id'), lineAccountId: accountId, codes: protectedCodes,
    });
    auditLog(c, 'mileage.reward.codes.import', { kind: 'mileage_reward', id: c.req.param('id') });
    return c.json({ success: true, data: result }, 201);
  } catch (error) {
    return mileageRewardError(c, error);
  }
});

scoring.post(
  '/api/mileage/redemptions',
  requireRole('owner', 'admin'),
  requireIrreversibleConfirmation('mileage-redemption'),
  async (c) => {
    try {
      const body = await c.req.json<{
        accountId?: unknown;
        friendId?: unknown;
        rewardId?: unknown;
      }>();
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      const friendId = typeof body.friendId === 'string' ? body.friendId.trim() : '';
      const rewardId = typeof body.rewardId === 'string' ? body.rewardId.trim() : '';
      const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
      if (!friendId || !rewardId || !isValidIdempotencyKey(idempotencyKey)) {
        return c.json({ success: false, error: '友だち、使い道、処理IDを確認してください' }, 400);
      }
      if (!await canUseMileageAccount(c, accountId)) {
        return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
      }
      const requestFingerprint = await sha256Hex(`${accountId}\n${friendId}\n${rewardId}`);
      const reserved = await reserveMileageRewardRedemption(c.env.DB, {
        lineAccountId: accountId,
        friendId,
        rewardId,
        idempotencyKey,
        requestFingerprint,
      });
      const delivery = await deliverMileageReward(c.env.DB, reserved.redemption.id, {
        credentialEncryptionKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
      });
      auditLog(c, 'mileage.redemption.create', {
        kind: 'mileage_redemption', id: reserved.redemption.id,
      });
      return c.json({
        success: delivery.status === 'succeeded',
        data: {
          replayed: reserved.kind === 'existing',
          redemption: publicMileageRedemption(reserved.redemption),
          delivery,
        },
      }, delivery.status === 'succeeded' ? 201 : 202);
    } catch (error) {
      return mileageRewardError(c, error);
    }
  },
);

const MILEAGE_REDEMPTION_LIST_STATUSES = new Set<string>([
  'all', 'needs_attention', 'reserved', 'delivering', 'succeeded', 'delivery_failed', 'refunded',
]);

// 交換履歴の一覧。残高を減らしたのに特典が届かなかった交換を、管理画面で
// 見つけるための口。既定は要対応（失敗中＋送ったか分からない配送中）。
// 照合待ちを既定の一覧から消さない（R364）。秘密の処理IDは落として返す。
scoring.get(
  '/api/mileage/redemptions',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const accountId = c.req.query('accountId')?.trim() ?? '';
      if (!await canUseMileageAccount(c, accountId)) {
        return c.json({ success: false, error: '交換履歴が見つかりません' }, 404);
      }
      const statusValue = c.req.query('status')?.trim() || 'needs_attention';
      if (!MILEAGE_REDEMPTION_LIST_STATUSES.has(statusValue)) {
        return c.json({ success: false, error: 'status is invalid' }, 400);
      }
      const requestedLimit = Number(c.req.query('limit') || 20);
      const requestedOffset = Number(c.req.query('offset') || 0);
      const listed = await listMileageRedemptions(c.env.DB, {
        lineAccountId: accountId,
        status: statusValue as MileageRedemptionListStatus,
        limit: Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 20,
        offset: Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0,
      });
      return c.json({
        success: true,
        data: {
          items: listed.items.map((item) => publicMileageRedemption(item)),
          pagination: listed.pagination,
        },
      });
    } catch (error) {
      return mileageRewardError(c, error);
    }
  },
);

scoring.get(
  '/api/mileage/redemptions/:id',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const accountId = c.req.query('accountId')?.trim() ?? '';
      if (!await canUseMileageAccount(c, accountId)) {
        return c.json({ success: false, error: '交換履歴が見つかりません' }, 404);
      }
      const redemption = await getMileageRedemption(c.env.DB, c.req.param('id'));
      if (!redemption || redemption.lineAccountId !== accountId) {
        return c.json({ success: false, error: '交換履歴が見つかりません' }, 404);
      }
      return c.json({ success: true, data: publicMileageRedemption(redemption) });
    } catch (error) {
      return mileageRewardError(c, error);
    }
  },
);

scoring.post(
  '/api/mileage/redemptions/:id/retry-fulfillment',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const body = await c.req.json<{ accountId?: unknown }>();
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!await canUseMileageAccount(c, accountId)) {
        return c.json({ success: false, error: '交換履歴が見つかりません' }, 404);
      }
      const redemption = await getMileageRedemption(c.env.DB, c.req.param('id'));
      if (!redemption || redemption.lineAccountId !== accountId) {
        return c.json({ success: false, error: '交換履歴が見つかりません' }, 404);
      }
      /*
       * 失敗中と配送中だけやり直せる。成功済み・返金済みの再実行は
       * 二重特典の素、予約中の再実行は最初の配送と競合するので断る。
       * 配送中（照合待ち）のやり直しも受け付けるが、送ったか
       * 確かめられない手順は送り直さず照合待ちに残す（R364）。
       * やり直しは同じ交換IDを続け、残高の減算はしない
       * (deliverMileageReward は予約時の減算に触らない)。
       *
       * R362: 返却確定後に書き込みが中断した交換だけは例外。
       * 台帳なしの refunded は残高が戻っていない取り残しなので、
       * 欠けた書き込みを足して202で返す。書き込み済みの refunded は
       * 従来どおり409で断る（二重返却なし）。
       */
      if (redemption.status === 'refunded') {
        if (await isMileageRefundComplete(c.env.DB, redemption.id)) {
          return c.json({
            success: false,
            error: '失敗中・配送中の交換だけやり直せます',
            code: 'redemption_not_retryable',
          }, 409);
        }
        try {
          await refundMileageRewardRedemption(c.env.DB, {
            redemptionId: redemption.id,
            reason: '中断した返却の再開',
          });
        } catch (error) {
          if (!(error instanceof MileageRewardError && error.code === 'already_delivered')) {
            throw error;
          }
        }
        auditLog(c, 'mileage.redemption.retry', { kind: 'mileage_redemption', id: redemption.id });
        const resumed = await deliverMileageReward(c.env.DB, redemption.id, {
          credentialEncryptionKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
        });
        const fresh = await getMileageRedemption(c.env.DB, redemption.id);
        const resumedData = { ...resumed, redemption: publicMileageRedemption(fresh ?? redemption) };
        return c.json({ success: resumed.status === 'succeeded', data: resumedData },
          resumed.status === 'succeeded' ? 200 : 202);
      }
      if (redemption.status !== 'delivery_failed' && redemption.status !== 'delivering') {
        return c.json({
          success: false,
          error: '失敗中・配送中の交換だけやり直せます',
          code: 'redemption_not_retryable',
        }, 409);
      }
      const delivery = await deliverMileageReward(c.env.DB, redemption.id, {
        credentialEncryptionKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
      });
      auditLog(c, 'mileage.redemption.retry', { kind: 'mileage_redemption', id: redemption.id });
      /*
       * R367: 配送成否だけでなく交換の今の状態も返す。返却が完了したら
       * 画面は返却済みとして案内し、古い再試行の行を外せる。
       */
      const fresh = await getMileageRedemption(c.env.DB, redemption.id);
      const data = { ...delivery, redemption: publicMileageRedemption(fresh ?? redemption) };
      return c.json({ success: delivery.status === 'succeeded', data },
        delivery.status === 'succeeded' ? 200 : 202);
    } catch (error) {
      return mileageRewardError(c, error);
    }
  },
);

scoring.get('/api/mileage/friends', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    const accountScope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!accountScope.allowedAccountIds.includes(accountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const requestedLimit = Number(c.req.query('limit') || 20);
    const requestedOffset = Number(c.req.query('offset') || 0);
    const data = await getMileageFriendsV6(c.env.DB, {
      lineAccountId: accountId,
      visibleAccountIds: accountScope.allowedAccountIds,
      search: c.req.query('search')?.trim() ?? '',
      // V6R-CX-e: 友だち詳細は名前ではなく友だちIDで1人を取る。
      friendId: c.req.query('friendId')?.trim() || undefined,
      limit: Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 20,
      offset: Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0,
    });
    return c.json({ success: true, data });
  } catch (error) {
    return mileageV6Error(c, error);
  }
});

scoring.get('/api/mileage/earning-rules', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, accountId ? 404 : 400);
    }
    const requestedLimit = Number(c.req.query('limit') || 20);
    const requestedOffset = Number(c.req.query('offset') || 0);
    const data = await getMileageEarningRulesV6(c.env.DB, {
      lineAccountId: accountId,
      limit: Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 20,
      offset: Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0,
    });
    return c.json({ success: true, data });
  } catch (error) {
    return mileageV6Error(c, error);
  }
});

/*
 * PUT /api/mileage/earning-rules-order — 「たまる決めごと」の並び順を
 * 全件まとめて保存する(N-243)。1件ずつ下書きPATCHを並列に投げる従来方式は
 * 途中失敗で一部だけ反映され得るため、rewards-order と同じ一括口の構造で
 * アカウントの一覧と一致する全順序だけを受け付ける。
 */
scoring.put('/api/mileage/earning-rules-order', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: unknown; ids?: unknown }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
    }
    const ids = Array.isArray(body.ids) && body.ids.every((id) => typeof id === 'string')
      ? body.ids as string[]
      : [];
    await reorderMileageEarningRules(c.env.DB, {
      lineAccountId: accountId,
      ids,
      updatedByStaffId: c.get('staff').id,
    });
    auditLog(c, 'mileage.rule.update', { kind: 'mileage_rule' }, { lineAccountId: accountId });
    return c.json({ success: true, data: null });
  } catch (error) {
    return mileageV6Error(c, error);
  }
});

scoring.patch('/api/mileage/earning-rules/:id/draft', requireRole('owner', 'admin'), async (c) => {
  try {
    type Body = { accountId?: unknown; expectedVersion?: unknown; draft?: unknown };
    const body = await c.req.json<Body>().catch((): Body => ({}));
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, accountId ? 404 : 400);
    }
    const expectedVersion = body.expectedVersion === null || body.expectedVersion === undefined
      ? null
      : Number(body.expectedVersion);
    if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 0)) {
      return c.json({ success: false, error: 'expectedVersion is invalid' }, 400);
    }
    const data = await saveMileageEarningRuleDraft(c.env.DB, {
      ruleId: c.req.param('id'),
      lineAccountId: accountId,
      expectedVersion,
      draft: body.draft,
      updatedByStaffId: c.get('staff').id,
    });
    auditLog(c, 'mileage.rule.update', {
      kind: 'mileage_rule', id: c.req.param('id'),
    });
    return c.json({ success: true, data });
  } catch (error) {
    return mileageV6Error(c, error);
  }
});

// POST /api/mileage/earning-rules/:id/publish — 下書きを公開版として固定し、実行へ反映する。
//
// N-231 案1。公開後に受け付けたイベントだけ新版で、公開前にキューへ入った
// 未処理イベントは旧版のまま。既存の台帳・残高は変えない。
scoring.post(
  '/api/mileage/earning-rules/:id/publish',
  requireRole('owner', 'admin'),
  requireIrreversibleConfirmation('mileage-earning-rule-publish'),
  async (c) => {
    try {
      type Body = { accountId?: unknown; expectedVersion?: unknown };
      const body = await c.req.json<Body>().catch((): Body => ({}));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!await canUseMileageAccount(c, accountId)) {
        return c.json({ success: false, error: 'LINE account not found' }, accountId ? 404 : 400);
      }
      const idempotencyKey = c.req.header('Idempotency-Key');
      if (!isValidIdempotencyKey(idempotencyKey)) {
        return c.json({ success: false, error: '公開には有効な冪等キーが必要です' }, 400);
      }
      const expectedVersion = typeof body.expectedVersion === 'number'
        ? body.expectedVersion
        : Number.NaN;
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return c.json({ success: false, error: '公開する下書きの版が必要です' }, 400);
      }
      const data = await publishMileageEarningRule(c.env.DB, {
        ruleId: c.req.param('id'),
        lineAccountId: accountId,
        expectedVersion,
        staffId: c.get('staff').id,
        idempotencyKey,
      });
      auditLog(c, 'mileage.rule.publish', {
        kind: 'mileage_rule', id: c.req.param('id'),
      });
      return c.json({ success: true, data });
    } catch (error) {
      return mileageV6Error(c, error);
    }
  },
);

scoring.get('/api/mileage/overview', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!accountId) {
      return c.json({ success: false, error: 'accountId is required' }, 400);
    }
    const accountScope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!accountScope.allowedAccountIds.includes(accountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 50)));
    const offset = Math.max(0, Number(c.req.query('offset') || 0));
    const overview = await getMileageAdminOverview(c.env.DB, {
      accountId,
      visibleAccountIds: accountScope.allowedAccountIds,
      search: c.req.query('search') || '',
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });
    return c.json({ success: true, data: overview });
  } catch (err) {
    console.error('GET /api/mileage/overview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

const MILEAGE_ENTRY_TYPES = new Set<MileageEntryType>([
  'grant', 'reversal', 'spend', 'expiration', 'adjustment',
]);
const MILEAGE_ENTRY_STATUSES = new Set<MileageEntryStatus>(['pending', 'available', 'void']);
const MILEAGE_MODES = new Set(['automatic', 'manual'] as const);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

scoring.get('/api/mileage/history', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!accountId) {
      return c.json({ success: false, error: 'accountId is required' }, 400);
    }
    const accountScope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!accountScope.allowedAccountIds.includes(accountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const entryTypeValue = c.req.query('entryType');
    const statusValue = c.req.query('status');
    const modeValue = c.req.query('mode');
    const fromValue = c.req.query('from')?.trim();
    const toValue = c.req.query('to')?.trim();
    if (entryTypeValue && !MILEAGE_ENTRY_TYPES.has(entryTypeValue as MileageEntryType)) {
      return c.json({ success: false, error: 'entryType is invalid' }, 400);
    }
    if (statusValue && !MILEAGE_ENTRY_STATUSES.has(statusValue as MileageEntryStatus)) {
      return c.json({ success: false, error: 'status is invalid' }, 400);
    }
    if (modeValue && !MILEAGE_MODES.has(modeValue as 'automatic' | 'manual')) {
      return c.json({ success: false, error: 'mode is invalid' }, 400);
    }
    if ((fromValue && !DATE_ONLY.test(fromValue)) || (toValue && !DATE_ONLY.test(toValue))) {
      return c.json({ success: false, error: 'from and to must be YYYY-MM-DD' }, 400);
    }
    if (fromValue && toValue && fromValue > toValue) {
      return c.json({ success: false, error: 'from must not be after to' }, 400);
    }
    const requestedLimit = Number(c.req.query('limit') || 50);
    const requestedOffset = Number(c.req.query('offset') || 0);
    const historyInput = {
      accountId,
      visibleAccountIds: accountScope.allowedAccountIds,
      search: c.req.query('search') || '',
      // V6R-CX-e: 友だち詳細は、その人（名寄せした複数アカウント）の履歴だけを取る。
      friendId: c.req.query('friendId')?.trim() || undefined,
      entryType: entryTypeValue as MileageEntryType | undefined,
      status: statusValue as MileageEntryStatus | undefined,
      mode: modeValue as 'automatic' | 'manual' | undefined,
      from: fromValue || undefined,
      to: toValue || undefined,
      limit: Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50,
      offset: Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0,
    };
    const [history, summary] = await Promise.all([
      getMileageAdminHistory(c.env.DB, historyInput),
      getMileageHistoryPeriodSummary(c.env.DB, {
        lineAccountId: accountId,
        from: fromValue || undefined,
        to: toValue || undefined,
      }),
    ]);
    return c.json({ success: true, data: { ...history, summary } });
  } catch (err) {
    console.error('GET /api/mileage/history error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

const MILEAGE_ADJUSTMENT_REASON_CATEGORIES = new Set([
  'customer_support',
  'order_correction',
  'grant_correction',
  'campaign',
  'other',
]);

scoring.get('/api/mileage/adjustment-policy', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!scope.allowedAccountIds.includes(accountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const policy = await getMileageManualAdjustmentPolicy(c.env.DB, accountId);
    return c.json({
      success: true,
      data: policy
        ? { configured: true as const, approvalThreshold: policy.approvalThreshold }
        : { configured: false as const, approvalThreshold: null },
    });
  } catch (err) {
    console.error('GET /api/mileage/adjustment-policy error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.put('/api/mileage/adjustment-policy', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: unknown; approvalThreshold?: unknown }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    const approvalThreshold = Number(body.approvalThreshold);
    if (!accountId || !Number.isInteger(approvalThreshold) || approvalThreshold <= 0) {
      return c.json({ success: false, error: 'accountId and a positive integer approvalThreshold are required' }, 400);
    }
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!scope.allowedAccountIds.includes(accountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    await setMileageManualAdjustmentPolicy(c.env.DB, accountId, { approvalThreshold });
    auditLog(c, 'mileage.adjustment.policy.update', { kind: 'line_account', id: accountId });
    return c.json({ success: true, data: { configured: true, approvalThreshold } });
  } catch (err) {
    console.error('PUT /api/mileage/adjustment-policy error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.post(
  '/api/mileage/adjustments',
  requireRole('owner', 'admin'),
  requireIrreversibleConfirmation('mileage-adjustment'),
  async (c) => {
    try {
      const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
      if (!isValidIdempotencyKey(idempotencyKey)) {
        return c.json({ success: false, error: '有効なIdempotency-Keyが必要です' }, 400);
      }
      const body = await c.req.json<{
        accountId?: unknown;
        friendId?: unknown;
        direction?: unknown;
        amount?: unknown;
        reasonCategory?: unknown;
        reason?: unknown;
        sourceReferenceId?: unknown;
        expiresAt?: unknown;
        notifyFriend?: unknown;
      }>();
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      const friendId = typeof body.friendId === 'string' ? body.friendId.trim() : '';
      const direction = body.direction === 'increase' || body.direction === 'decrease'
        ? body.direction
        : null;
      const amount = Number(body.amount);
      const reasonCategory = typeof body.reasonCategory === 'string' ? body.reasonCategory.trim() : '';
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      const sourceReferenceId = typeof body.sourceReferenceId === 'string'
        ? body.sourceReferenceId.trim()
        : '';
      if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== ''
        && typeof body.expiresAt !== 'string') {
        return c.json({ success: false, error: 'expiresAt must be a date-time string' }, 400);
      }
      const expiresAtValue = typeof body.expiresAt === 'string' ? body.expiresAt.trim() : '';
      const expiresAt = expiresAtValue ? new Date(expiresAtValue) : null;
      const notifyFriend = body.notifyFriend === undefined ? false : body.notifyFriend;
      if (!accountId || !friendId || !direction || !Number.isInteger(amount) || amount <= 0) {
        return c.json({ success: false, error: 'accountId, friendId, direction and a positive integer amount are required' }, 400);
      }
      if (amount > 1_000_000_000) {
        return c.json({ success: false, error: 'amount is too large' }, 400);
      }
      if (!MILEAGE_ADJUSTMENT_REASON_CATEGORIES.has(reasonCategory)) {
        return c.json({ success: false, error: 'reasonCategory is invalid' }, 400);
      }
      if (!reason || reason.length > 500 || sourceReferenceId.length > 128) {
        return c.json({ success: false, error: 'reason is required and one or more fields are too long' }, 400);
      }
      if (typeof notifyFriend !== 'boolean') {
        return c.json({ success: false, error: 'notifyFriend must be a boolean' }, 400);
      }
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return c.json({ success: false, error: 'expiresAt must be a date-time' }, 400);
      }
      if (expiresAt && direction !== 'increase') {
        return c.json({ success: false, error: 'expiresAt can only be set when increasing mileage' }, 400);
      }

      const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
      if (!scope.allowedAccountIds.includes(accountId)) {
        return c.json({ success: false, error: 'LINE account not found' }, 404);
      }
      const friend = await c.env.DB.prepare(
        `SELECT id FROM friends WHERE id = ? AND line_account_id = ?`,
      ).bind(friendId, accountId).first<{ id: string }>();
      if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

      const staff = c.get('staff');
      const signedAmount = direction === 'decrease' ? -amount : amount;
      const adjustmentInput = {
        friendId,
        amount: signedAmount,
        reason,
        reasonCategory,
        sourceReferenceId: sourceReferenceId || null,
        idempotencyKey,
        executedByStaffId: staff.id,
        executedByStaffName: staff.name,
        lineAccountId: accountId,
        expiresAt: expiresAt?.toISOString() ?? null,
        notifyFriend,
      };

      /*
       * R378: 確定済みの同じ要求は当時の結果をそのまま返す。承認境界の
       * 引き下げや元の有効期限の経過は「新しい調整への判定」なので、
       * 確定済みの再送には適用しない。同じキーで別の内容なら409。
       * 通知だけの復旧（前回は残高反映済み・通知のみ失敗）もここで行い、
       * 残高へ再適用しない。
       */
      const committed = await findCommittedMileageAdjustment(c.env.DB, adjustmentInput);
      if (committed) {
        const replayedNotification = notifyFriend
          ? await sendMileageAdjustmentNotification(c, {
              lineAccountId: accountId,
              friendId,
              ledgerEntryId: committed.entry.id,
              idempotencyKey,
              message: mileageAdjustmentMessage({
                direction,
                amount,
                balanceAfter: committed.balanceAfter,
                expiresAt: expiresAt?.toISOString() ?? null,
              }),
            }).catch(() => ({
              id: null,
              status: 'failed' as const,
              attemptCount: 0,
              errorCode: 'notification_record_failed',
            }))
          : null;
        return c.json({
          success: true,
          data: {
            entryId: committed.entry.id,
            balanceBefore: committed.balanceBefore,
            amount: committed.entry.amount,
            balanceAfter: committed.balanceAfter,
            replayed: true,
            expiresAt: expiresAt?.toISOString() ?? null,
            notification: replayedNotification,
          },
        }, 200);
      }

      // R378: 期限切れの判定と承認境界は「新しい調整」だけに適用する。
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        return c.json({ success: false, error: 'expiresAt must be a future date-time' }, 400);
      }

      const policy = await getMileageManualAdjustmentPolicy(c.env.DB, accountId);
      if (!policy) {
        return c.json({
          success: false,
          error: '高額調整の承認境界が未設定です。オーナーが先に設定してください。',
          code: 'ADJUSTMENT_POLICY_REQUIRED',
        }, 400);
      }
      if (amount >= policy.approvalThreshold) {
        /*
         * R: 境界以上の調整は実行せず、別のオーナーへの承認依頼として残す
         * （一斉配信の二者承認と同じ形）。依頼票は同じ Idempotency-Key の
         * 再送で重複しない。
         */
        const { request } = await createMileageAdjustmentApprovalRequest(c.env.DB, {
          lineAccountId: accountId,
          friendId,
          direction,
          amount,
          reasonCategory,
          reason,
          sourceReferenceId: sourceReferenceId || null,
          expiresAt: expiresAt?.toISOString() ?? null,
          notifyFriend,
          idempotencyKey,
          staffId: staff.id,
          staffName: staff.name,
        });
        auditLog(c, 'mileage.adjustment.approval.request', {
          kind: 'mileage_adjustment_approval_requests', id: request.id,
        });
        return c.json({
          success: true,
          data: {
            approvalRequired: true as const,
            approvalThreshold: policy.approvalThreshold,
            request,
          },
        }, 202);
      }

      const result = await postMileageAdjustment(c.env.DB, adjustmentInput);
      auditLog(c, 'mileage.adjustment.create', { kind: 'mileage_ledger', id: result.entry.id });
      const notification = notifyFriend
        ? await sendMileageAdjustmentNotification(c, {
            lineAccountId: accountId,
            friendId,
            ledgerEntryId: result.entry.id,
            idempotencyKey,
            message: mileageAdjustmentMessage({
              direction,
              amount,
              balanceAfter: result.balanceAfter,
              expiresAt: expiresAt?.toISOString() ?? null,
            }),
          }).catch(() => ({
            id: null,
            status: 'failed' as const,
            attemptCount: 0,
            errorCode: 'notification_record_failed',
          }))
        : null;
      return c.json({
        success: true,
        data: {
          entryId: result.entry.id,
          balanceBefore: result.balanceBefore,
          amount: result.entry.amount,
          balanceAfter: result.balanceAfter,
          replayed: result.replayed,
          expiresAt: expiresAt?.toISOString() ?? null,
          notification,
        },
      }, result.replayed ? 200 : 201);
    } catch (err) {
      if (err instanceof MileageAdjustmentError) {
        if (err.code === 'insufficient_balance') {
          return c.json({ success: false, error: '利用可能な残高を超えて減らすことはできません', code: err.code }, 400);
        }
        if (err.code === 'idempotency_conflict') {
          return c.json({ success: false, error: '同じIdempotency-Keyが別の内容で使われています', code: err.code }, 409);
        }
        if (err.code === 'friend_not_found') {
          return c.json({ success: false, error: 'Friend not found', code: err.code }, 404);
        }
      }
      console.error('POST /api/mileage/adjustments error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

/*
 * R: 高額調整の承認依頼の一覧・承認・差し戻し・取り下げ。
 * 承認は「依頼した人とは別のオーナー」だけが行える（二者承認）。
 */
scoring.get('/api/mileage/adjustment-approvals', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, accountId ? 404 : 400);
    }
    const rawStatus = c.req.query('status')?.trim() ?? '';
    const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(rawStatus)
      ? rawStatus as 'pending' | 'approved' | 'rejected' | 'cancelled'
      : undefined;
    const requests = await listMileageAdjustmentApprovalRequests(c.env.DB, {
      lineAccountId: accountId,
      status,
    });
    return c.json({ success: true, data: requests });
  } catch (error) {
    return mileageV6Error(c, error);
  }
});

scoring.post(
  '/api/mileage/adjustment-approvals/:id/approve',
  requireRole('owner'),
  async (c) => {
    try {
      const body = await c.req.json<{ accountId?: unknown; reason?: unknown }>()
        .catch(() => ({} as { accountId?: unknown; reason?: unknown }));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!await canUseMileageAccount(c, accountId)) {
        return c.json({ success: false, error: 'LINE account not found' }, accountId ? 404 : 400);
      }
      const staff = c.get('staff');
      const { request, entry } = await approveMileageAdjustmentRequest(c.env.DB, {
        requestId: c.req.param('id'),
        lineAccountId: accountId,
        staffId: staff.id,
        staffName: staff.name,
        decisionReason: typeof body.reason === 'string' ? body.reason.trim() || null : null,
      });
      auditLog(c, 'mileage.adjustment.approval.approve', {
        kind: 'mileage_adjustment_approval_requests', id: request.id,
      });
      /*
       * 依頼時に「友だちに知らせる」が選ばれていれば、承認で残高へ
       * 反映されたこのタイミングで通知する。失敗は残高を巻き戻さず、
       * 失敗の記録として残る（あとから通知だけ再送できる）。
       */
      const approvedMetadata = entry.metadata
        ? JSON.parse(entry.metadata) as { balanceAfter?: number }
        : {};
      const notification = request.notify_friend === 1
        ? await sendMileageAdjustmentNotification(c, {
            lineAccountId: request.line_account_id,
            friendId: request.friend_id,
            ledgerEntryId: entry.id,
            idempotencyKey: request.idempotency_key,
            message: mileageAdjustmentMessage({
              direction: request.direction,
              amount: request.amount,
              balanceAfter: Number(approvedMetadata.balanceAfter ?? 0),
              expiresAt: request.expires_at,
            }),
          }).catch(() => null)
        : null;
      return c.json({ success: true, data: { request, entryId: entry.id, notification } });
    } catch (error) {
      return mileageV6Error(c, error);
    }
  },
);

scoring.post(
  '/api/mileage/adjustment-approvals/:id/reject',
  requireRole('owner'),
  async (c) => {
    try {
      const body = await c.req.json<{ accountId?: unknown; reason?: unknown }>()
        .catch(() => ({} as { accountId?: unknown; reason?: unknown }));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!await canUseMileageAccount(c, accountId)) {
        return c.json({ success: false, error: 'LINE account not found' }, accountId ? 404 : 400);
      }
      const staff = c.get('staff');
      const request = await rejectMileageAdjustmentRequest(c.env.DB, {
        requestId: c.req.param('id'),
        lineAccountId: accountId,
        staffId: staff.id,
        staffName: staff.name,
        decisionReason: typeof body.reason === 'string' ? body.reason.trim() || null : null,
      });
      auditLog(c, 'mileage.adjustment.approval.reject', {
        kind: 'mileage_adjustment_approval_requests', id: request.id,
      });
      return c.json({ success: true, data: { request } });
    } catch (error) {
      return mileageV6Error(c, error);
    }
  },
);

scoring.post(
  '/api/mileage/adjustment-approvals/:id/cancel',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const body = await c.req.json<{ accountId?: unknown }>()
        .catch(() => ({} as { accountId?: unknown }));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!await canUseMileageAccount(c, accountId)) {
        return c.json({ success: false, error: 'LINE account not found' }, accountId ? 404 : 400);
      }
      const request = await cancelMileageAdjustmentRequest(c.env.DB, {
        requestId: c.req.param('id'),
        lineAccountId: accountId,
        staffId: c.get('staff').id,
      });
      auditLog(c, 'mileage.adjustment.approval.cancel', {
        kind: 'mileage_adjustment_approval_requests', id: request.id,
      });
      return c.json({ success: true, data: { request } });
    } catch (error) {
      return mileageV6Error(c, error);
    }
  },
);

/*
 * R: 確定待ちの確定・取消。どちらも理由が必須。確定は pending→available、
 * 取消は逆向きの記録を足す（台帳の行は消さない）。
 */
scoring.post(
  '/api/mileage/entries/:id/confirm',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const body = await c.req.json<{ accountId?: unknown; reason?: unknown }>()
        .catch(() => ({} as { accountId?: unknown; reason?: unknown }));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!accountId) {
        return c.json({ success: false, error: 'accountId is required' }, 400);
      }
      if (!reason) {
        return c.json({ success: false, error: '理由を入力してください', code: 'reason_required' }, 400);
      }
      if (!await canUseMileageAccount(c, accountId)) {
        return c.json({ success: false, error: 'LINE account not found' }, 404);
      }
      const staff = c.get('staff');
      const { entry, alreadyConfirmed } = await confirmPendingMileageEntry(c.env.DB, {
        entryId: c.req.param('id'),
        lineAccountId: accountId,
        staffId: staff.id,
        staffName: staff.name,
        reason,
      });
      if (!alreadyConfirmed) {
        auditLog(c, 'mileage.entry.confirm', { kind: 'mileage_ledger', id: entry.id });
      }
      return c.json({ success: true, data: { entry, alreadyConfirmed } });
    } catch (error) {
      return mileageV6Error(c, error);
    }
  },
);

scoring.post(
  '/api/mileage/entries/:id/void',
  requireRole('owner', 'admin'),
  requireIrreversibleConfirmation('mileage-entry-void'),
  async (c) => {
    try {
      const body = await c.req.json<{ accountId?: unknown; reason?: unknown }>()
        .catch(() => ({} as { accountId?: unknown; reason?: unknown }));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!accountId) {
        return c.json({ success: false, error: 'accountId is required' }, 400);
      }
      if (!reason) {
        return c.json({ success: false, error: '理由を入力してください', code: 'reason_required' }, 400);
      }
      if (!await canUseMileageAccount(c, accountId)) {
        return c.json({ success: false, error: 'LINE account not found' }, 404);
      }
      const staff = c.get('staff');
      const result = await voidMileageLedgerEntry(c.env.DB, {
        entryId: c.req.param('id'),
        lineAccountId: accountId,
        staffId: staff.id,
        staffName: staff.name,
        reason,
      });
      if (!result.replayed) {
        auditLog(c, 'mileage.entry.void', { kind: 'mileage_ledger', id: result.entry.id });
      }
      return c.json({ success: true, data: result });
    } catch (error) {
      return mileageV6Error(c, error);
    }
  },
);

/*
 * R380/R381: 手動調整の友だち通知だけをあとから再送する。
 * 残高は動かさない。通知記録があれば保存済みの本文・送信キーで再送し、
 * 記録自体が作れなかった調整では台帳の依頼印（notifyFriend）を見て
 * 本文を組み直して送る。sent 済みの再送は sendMileageNotification 側で
 * 何もしない（二重送信しない）。
 */
scoring.post(
  '/api/mileage/entries/:id/notification-retry',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const body = await c.req.json<{ accountId?: unknown }>()
        .catch(() => ({} as { accountId?: unknown }));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!await canUseMileageAccount(c, accountId)) {
        return c.json({ success: false, error: 'LINE account not found' }, accountId ? 404 : 400);
      }
      const entryId = c.req.param('id');
      const entry = await c.env.DB.prepare(
        `SELECT id, beneficiary_friend_id, idempotency_key, amount, metadata
           FROM mileage_ledger
          WHERE id = ? AND program_id = 'default' AND entry_type = 'adjustment'
            AND json_extract(metadata, '$.lineAccountId') = ?`,
      ).bind(entryId, accountId).first<{
        id: string; beneficiary_friend_id: string | null; idempotency_key: string;
        amount: number; metadata: string | null;
      }>();
      if (!entry || !entry.beneficiary_friend_id) {
        return c.json({ success: false, error: 'Notification target not found' }, 404);
      }
      const record = await getMileageAdjustmentNotificationRecord(c.env.DB, {
        lineAccountId: accountId,
        ledgerEntryId: entry.id,
      });
      const metadata = entry.metadata ? JSON.parse(entry.metadata) as {
        notifyFriend?: boolean;
        adjustmentFingerprint?: string;
        balanceAfter?: number;
        expiresAt?: string | null;
      } : {};
      /*
       * 通知記録が無い＝依頼時に記録の作成自体が失敗した場合。古い台帳には
       * notifyFriend がないので、指紋の中の notifyFriend でも確かめる。
       */
      const fingerprintRequested = (() => {
        try {
          return JSON.parse(metadata.adjustmentFingerprint ?? '{}')?.notifyFriend === true;
        } catch {
          return false;
        }
      })();
      if (!record && metadata.notifyFriend !== true && !fingerprintRequested) {
        return c.json({ success: false, error: 'この調整に通知の依頼はありません' }, 404);
      }
      const notification = await sendMileageAdjustmentNotification(c, {
        lineAccountId: accountId,
        friendId: record?.friendId ?? entry.beneficiary_friend_id,
        ledgerEntryId: entry.id,
        idempotencyKey: record?.idempotencyKey ?? entry.idempotency_key,
        message: record?.messageText ?? mileageAdjustmentMessage({
          direction: entry.amount > 0 ? 'increase' : 'decrease',
          amount: Math.abs(entry.amount),
          balanceAfter: Number(metadata.balanceAfter ?? 0),
          expiresAt: metadata.expiresAt ?? null,
        }),
      });
      auditLog(c, 'mileage.adjustment.notification.retry', {
        kind: 'mileage_adjustment_notifications', id: notification.id ?? entry.id,
      });
      return c.json({ success: true, data: { notification } });
    } catch (error) {
      return mileageV6Error(c, error);
    }
  },
);
scoring.post(
  '/api/mileage/earning-rules/test',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const body = await c.req.json<{ accountId?: unknown; draft?: unknown }>()
        .catch(() => ({} as { accountId?: unknown; draft?: unknown }));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!await canUseMileageAccount(c, accountId)) {
        return c.json({ success: false, error: 'LINE account not found' }, accountId ? 404 : 400);
      }
      const draft = validateMileageEarningRuleDraft(body.draft);
      const data = await testMileageEarningRuleDraft(c.env.DB, {
        lineAccountId: accountId,
        draft,
      });
      return c.json({ success: true, data });
    } catch (error) {
      return mileageV6Error(c, error);
    }
  },
);

scoring.get('/api/mileage/rules', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const rules = (await getMileageRules(c.env.DB)).filter((rule) => rule.line_account_id == null
      ? scope.canSeeUnassigned
      : scope.allowedAccountIds.includes(rule.line_account_id));
    return c.json({ success: true, data: rules.map(serializeMileageRule) });
  } catch (err) {
    console.error('GET /api/mileage/rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// N-237: 決めごとのCSVはサーバー側で作る。許可scope内の決めごとだけを出し、
// 既存の監査契約へ残す。ブラウザだけで権限判定を完結させない。
// 表示側(apps/web/src/app/mileage/page.tsx)の列・文言とそろえる。
const MILEAGE_RULE_EVENT_LABELS: Record<string, string> = {
  friend_added: '友だち登録',
  message_received: 'メッセージ',
  link_clicked: 'リンククリック',
  broadcast_link_clicked: '配信リンククリック',
  form_submitted: 'フォーム',
  booking_created: '予約',
  affiliate_conversion_approved: '紹介成果',
  webinar_watch_5m: 'ウェビナー',
  webinar_watch_15m: 'ウェビナー',
  webinar_completed: 'ウェビナー完了',
  webinar_cta_clicked: 'ウェビナーCTA',
  instagram_dm_received: 'Instagram DM',
  instagram_comment_created: 'Instagramコメント',
  instagram_story_mentioned: 'ストーリーズ',
  instagram_line_returned: 'LINE帰還',
  inflow_return: 'LINE帰還',
  friend_registered: '友だち登録',
  friend_following_7d: '継続7日',
  friend_following_30d: '継続30日',
  friend_following_90d: '継続90日',
  friend_following_180d: '継続180日',
  friend_following_365d: '継続1年',
  purchase_completed: '購入完了',
};

function mileageRuleEventLabel(eventType: string): string {
  return MILEAGE_RULE_EVENT_LABELS[eventType] ?? 'その他の行動';
}

function mileageCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

scoring.get('/api/mileage/rules/export', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const staff = c.get('staff');
    const accountId = (c.req.query('accountId') ?? '').trim();
    if (!accountId) {
      return c.json({ success: false, error: 'LINE account not found' }, 400);
    }
    const decision = await resolveRequestBoundary(c.env.DB, staff, accountId);
    if (!decision.allowed) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    type RuleItem = Awaited<ReturnType<typeof getMileageEarningRulesV6>>['items'][number];
    const items: RuleItem[] = [];
    let offset = 0;
    for (;;) {
      const data = await getMileageEarningRulesV6(c.env.DB, { lineAccountId: accountId, limit: 100, offset });
      items.push(...data.items);
      if (items.length >= data.pagination.total || data.items.length === 0) break;
      offset += data.items.length;
    }
    const headers = ['決めごと', '対象の行動', 'たまるマイル', 'この30日の付与回数', '失効', '状態'];
    const rows = items.map((item) => [
      item.draft.name,
      mileageRuleEventLabel(item.draft.eventType),
      item.draft.amount,
      item.metrics30d.granted,
      item.draft.expiresAfterDays ?? '失効なし',
      item.published.status === 'published' ? '動いています' : '止めています',
    ]);
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(mileageCsvCell).join(',')).join('\r\n')}\r\n`;
    auditLog(c, 'mileage.rule.export', { kind: 'mileage_earning_rule_export', id: accountId });
    const day = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="mileage-earning-rules-${day}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    console.error('GET /api/mileage/rules/export error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// Generic authenticated ingestion point for future Harness products/SNS.
// The request only records an event + queue row; mileage is calculated by cron.
scoring.post('/api/mileage/events', requireRole('owner', 'admin'), async (c) => {
  auditLog(c, 'mileage.event.create', { kind: 'mileage_event' });
  try {
    const body = await c.req.json<{
      friendId?: unknown;
      eventType?: unknown;
      source?: unknown;
      sourceEventId?: unknown;
      subjectKey?: unknown;
      metadata?: unknown;
      occurredAt?: unknown;
    }>();
    const friendId = typeof body.friendId === 'string' ? body.friendId.trim() : '';
    const eventType = typeof body.eventType === 'string' ? body.eventType.trim() : '';
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    const sourceEventId = typeof body.sourceEventId === 'string' ? body.sourceEventId.trim() : '';
    if (!friendId || !eventType || !source || !sourceEventId) {
      return c.json({ success: false, error: 'friendId, eventType, source and sourceEventId are required' }, 400);
    }
    if (friendId.length > 128 || eventType.length > 100 || source.length > 100 || sourceEventId.length > 256) {
      return c.json({ success: false, error: 'one or more fields are too long' }, 400);
    }
    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : {};
    if (JSON.stringify(metadata).length > 4096) {
      return c.json({ success: false, error: 'metadata_too_large' }, 413);
    }
    const result = await applyMileageRulesForEvent(c.env.DB, {
      friendId,
      eventType,
      source,
      sourceEventId,
      subjectKey: typeof body.subjectKey === 'string' ? body.subjectKey.slice(0, 256) : null,
      metadata,
      occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : undefined,
    });
    return c.json({ success: true, data: { eventId: result.event.id, queued: true } }, 202);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Mileage friend not found:')) {
      return c.json({ success: false, error: 'friend_not_found' }, 404);
    }
    console.error('POST /api/mileage/events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * N-240(#813): 決めごと作成の冪等。reminders の N-067 と同じ約束:
 * - keyは `mileage-rule:<account>:<requestKey>` でaccountごとに名前空間を分ける
 * - 同一key＋同一内容→同じrule ID・同じ応答（行は1件）
 * - 同一key＋別内容→409（上書きしない）
 * - 予約後・作成前の失敗は in_progress のまま残し、再送は同じ束で回収する
 * - 同時押下はIDをkeyから決めるため何回通っても1行に収まる
 * - 入力不備・権限拒否は予約を残さない（route側で先に検査する）
 */
async function mileageRuleIdForKey(namespacedKey: string): Promise<string> {
  const hex = await hashOutboundPayload(namespacedKey);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

type MileageRuleCreateInput = {
  name: string;
  eventType: string;
  source: string | null;
  amount: number;
  initialStatus?: 'pending' | 'available';
  conditions?: {
    dailyCapActions?: number;
    uniquePerSubject?: boolean;
    uniquePerSubjectPerDay?: boolean;
    ignoreMultiplier?: boolean;
    beneficiary?: 'actor' | 'referrer';
    uniquePerReferredFriend?: boolean;
    uniquePerReferredFriendPerSubject?: boolean;
  } | null;
  validFrom: string | null;
  validUntil: string | null;
  lineAccountId: string;
  /** DRAFT-01: false なら最初のINSERTから停止。省略は従来どおり稼働。 */
  isActive?: boolean;
};

async function createMileageRuleIdempotent(
  db: D1Database,
  args: MileageRuleCreateInput & { requestKey: string },
): Promise<{ status: 201 | 409; body: unknown }> {
  // 衝突判定は保存される値だけを正規化する。保存に影響しない余分は入れない。
  const normalized = {
    lineAccountId: args.lineAccountId,
    name: args.name,
    eventType: args.eventType,
    source: args.source,
    amount: args.amount,
    initialStatus: args.initialStatus ?? 'available',
    conditions: args.conditions ?? null,
    validFrom: args.validFrom,
    validUntil: args.validUntil,
    // 稼働/停止も保存される値なので衝突判定に含める（止めるはずの再送が
    // 稼働中の行を回収しないよう、同じkeyで別状態は409にする）。
    isActive: args.isActive !== false,
  };
  const namespacedKey = `mileage-rule:${args.lineAccountId}:${args.requestKey}`;
  const now = new Date().toISOString();
  const reservation = await reserveOutboundSend(db, {
    key: namespacedKey,
    channel: 'line',
    resourceId: args.lineAccountId,
    payloadHash: await hashOutboundPayload(JSON.stringify(normalized)),
    retryInProgress: true,
    now,
  });
  if (reservation.kind === 'conflict') {
    return { status: 409, body: { success: false, error: '同じ登録キーを別の内容には使用できません' } };
  }
  if (reservation.kind === 'replay') {
    const existing = await getMileageRuleById(db, reservation.responseId);
    if (existing) {
      return { status: 201, body: { success: true, data: serializeMileageRule(existing) } };
    }
    // 成功確定のはずが行方不明。下の束で作り直す（INSERT OR IGNORE のため安全）。
  }
  const ruleId = await mileageRuleIdForKey(namespacedKey);
  await ensureDefaultMileageProgram(db);
  const nowJst = jstNow();
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO mileage_rules
         (id, program_id, name, event_type, source, amount, initial_status,
          conditions, line_account_id, is_active, valid_from, valid_until, created_at, updated_at)
       VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ruleId,
      args.name,
      args.eventType,
      args.source,
      args.amount,
      args.initialStatus ?? 'available',
      args.conditions ? JSON.stringify(args.conditions) : null,
      args.lineAccountId,
      args.isActive === false ? 0 : 1,
      args.validFrom,
      args.validUntil,
      nowJst,
      nowJst,
    ),
    completeOutboundSendStatement(db, { key: namespacedKey, responseId: ruleId, now }),
  ]);
  const created = await getMileageRuleById(db, ruleId);
  if (!created) throw new Error('mileage rule idempotency recovery failed');
  return { status: 201, body: { success: true, data: serializeMileageRule(created) } };
}

scoring.post('/api/mileage/rules', requireRole('owner', 'admin'), async (c) => {
  auditLog(c, 'mileage.rule.create', { kind: 'mileage_rule' });
  try {
    const body = await c.req.json<{
      name?: string;
      eventType?: string;
      source?: string | null;
      amount?: number;
      initialStatus?: 'pending' | 'available';
      conditions?: {
        dailyCapActions?: number;
        uniquePerSubject?: boolean;
        uniquePerSubjectPerDay?: boolean;
        ignoreMultiplier?: boolean;
        beneficiary?: 'actor' | 'referrer';
        uniquePerReferredFriend?: boolean;
        uniquePerReferredFriendPerSubject?: boolean;
      } | null;
      validFrom?: string | null;
      validUntil?: string | null;
      /** 334(#521): 帰属アカウント。 */
      lineAccountId?: string;
      /** DRAFT-01: falseなら停止中で作る。省略は従来どおり稼働。 */
      isActive?: boolean;
    }>();
    if (!body.name?.trim() || !body.eventType?.trim() || !Number.isInteger(body.amount) || (body.amount ?? 0) <= 0) {
      return c.json({ success: false, error: 'name, eventType and a positive integer amount are required' }, 400);
    }
    if (!body.lineAccountId?.trim()) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }
    // N-240: Idempotency-Key 付きの作成は二重作成しない。キーなしは従来通り。
    const requestKey = c.req.header('Idempotency-Key')?.trim();
    if (requestKey !== undefined && requestKey !== '') {
      if (!isValidIdempotencyKey(requestKey)) {
        return c.json({ success: false, error: '有効なIdempotency-Keyが必要です' }, 400);
      }
      const result = await createMileageRuleIdempotent(c.env.DB, {
        name: body.name.trim(),
        eventType: body.eventType.trim(),
        source: body.source ?? null,
        amount: body.amount!,
        initialStatus: body.initialStatus,
        conditions: body.conditions,
        validFrom: body.validFrom ?? null,
        validUntil: body.validUntil ?? null,
        lineAccountId: body.lineAccountId,
        isActive: body.isActive,
        requestKey,
      });
      return c.json(result.body, result.status);
    }
    const rule = await createMileageRule(c.env.DB, {
      name: body.name.trim(),
      eventType: body.eventType.trim(),
      source: body.source ?? null,
      amount: body.amount!,
      initialStatus: body.initialStatus,
      conditions: body.conditions,
      validFrom: body.validFrom ?? null,
      validUntil: body.validUntil ?? null,
      lineAccountId: body.lineAccountId,
      isActive: body.isActive,
    });
    return c.json({ success: true, data: serializeMileageRule(rule) }, 201);
  } catch (err) {
    console.error('POST /api/mileage/rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.put('/api/mileage/rules/:id', requireRole('owner', 'admin'), async (c) => {
  auditLog(c, 'mileage.rule.update', { kind: 'mileage_rule', id: c.req.param('id') });
  try {
    const body = await c.req.json<{
      name?: string;
      eventType?: string;
      source?: string | null;
      amount?: number;
      initialStatus?: 'pending' | 'available';
      conditions?: {
        dailyCapActions?: number;
        uniquePerSubject?: boolean;
        uniquePerSubjectPerDay?: boolean;
        ignoreMultiplier?: boolean;
        beneficiary?: 'actor' | 'referrer';
        uniquePerReferredFriend?: boolean;
        uniquePerReferredFriendPerSubject?: boolean;
      } | null;
      isActive?: boolean;
    }>();
    if (body.amount !== undefined && (!Number.isInteger(body.amount) || body.amount <= 0)) {
      return c.json({ success: false, error: 'amount must be a positive integer' }, 400);
    }
    const existing = await getMileageRuleById(c.env.DB, c.req.param('id'));
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    if (existing.line_account_id == null) {
      return c.json({ success: false, error: '全店共通の旧ルールは変更できません' }, 409);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [existing.line_account_id])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    // N-231 案1: 公開内容の直接変更は閉じる。下書き→公開の口を使ってください。
    // 停止・再開(isActive)だけは公開内容を変えないため、このまま許可する。
    const directContentKeys = (['name', 'eventType', 'source', 'amount', 'initialStatus', 'conditions'] as const)
      .filter((key) => body[key] !== undefined);
    if (directContentKeys.length > 0) {
      return c.json({
        success: false,
        error: '公開内容は直接変更できません。下書きを保存して「公開して反映」してください',
      }, 409);
    }
    const updated = await updateMileageRule(c.env.DB, existing.id, { isActive: body.isActive });
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serializeMileageRule(updated) });
  } catch (err) {
    console.error('PUT /api/mileage/rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.delete('/api/mileage/rules/:id', requireRole('owner', 'admin'), async (c) => {
  auditLog(c, 'mileage.rule.delete', { kind: 'mileage_rule', id: c.req.param('id') });
  try {
    const existing = await getMileageRuleById(c.env.DB, c.req.param('id'));
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    if (existing.line_account_id == null) {
      return c.json({ success: false, error: '全店共通の旧ルールは削除できません' }, 409);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [existing.line_account_id])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    // N-232: 付与履歴がある決めごとは1文の原子DELETEで守る。SELECTとDELETEを分けると
    // その間に履歴が作られる競合で消せてしまう。0件なら履歴ありとして409で安全拒否し、
    // 停止(PUT isActive=false)へ誘導する。
    const deleted = await deleteMileageRule(c.env.DB, existing.id);
    if (deleted === 0) {
      return c.json({ success: false, error: '付与履歴があるため削除できません。先に停止してください' }, 409);
    }
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/mileage/rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 行動スコア（V6 17-2） ==========

const ACTION_SCORE_FILTERS = new Set<ActionScoreFilter>(['all', 'high', 'normal', 'low', 'decreased']);
const ACTION_SCORE_SORTS = new Set<ActionScoreSort>([
  'score_desc', 'score_asc', 'change_desc', 'change_asc', 'recent_desc',
]);

scoring.get('/api/action-scores/friends', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!scope.allowedAccountIds.includes(accountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const filterValue = c.req.query('filter') ?? 'all';
    const sortValue = c.req.query('sort') ?? 'score_desc';
    if (!ACTION_SCORE_FILTERS.has(filterValue as ActionScoreFilter)) {
      return c.json({ success: false, error: 'filter is invalid' }, 400);
    }
    if (!ACTION_SCORE_SORTS.has(sortValue as ActionScoreSort)) {
      return c.json({ success: false, error: 'sort is invalid' }, 400);
    }
    const requestedLimit = Number(c.req.query('limit') || 20);
    const requestedOffset = Number(c.req.query('offset') || 0);
    const bands = await getActionScoreBands(c.env.DB, accountId);
    const data = await getActionScoreOverview(c.env.DB, {
      accountId,
      highMin: bands.highMin,
      normalMin: bands.normalMin,
      search: c.req.query('search') || '',
      filter: filterValue as ActionScoreFilter,
      sort: sortValue as ActionScoreSort,
      limit: Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 20,
      offset: Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0,
    });
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/action-scores/friends error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== スコアリングルールCRUD ==========

scoring.get('/api/scoring-rules', async (c) => {
  try {
    const items = await getScoringRules(c.env.DB);
    return c.json({
      success: true,
      data: items.map((r) => ({
        id: r.id,
        name: r.name,
        eventType: r.event_type,
        scoreValue: r.score_value,
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/scoring-rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.get('/api/scoring-rules/:id', async (c) => {
  try {
    const item = await getScoringRuleById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: { id: item.id, name: item.name, eventType: item.event_type, scoreValue: item.score_value, isActive: Boolean(item.is_active), createdAt: item.created_at },
    });
  } catch (err) {
    console.error('GET /api/scoring-rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.post('/api/scoring-rules', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ name: string; eventType: string; scoreValue: number }>();
    if (!body.name || !body.eventType || body.scoreValue === undefined) {
      return c.json({ success: false, error: 'name, eventType, scoreValue are required' }, 400);
    }
    const item = await createScoringRule(c.env.DB, body);
    return c.json({ success: true, data: { id: item.id, name: item.name, eventType: item.event_type, scoreValue: item.score_value } }, 201);
  } catch (err) {
    console.error('POST /api/scoring-rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.put('/api/scoring-rules/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateScoringRule(c.env.DB, id, body);
    const updated = await getScoringRuleById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, eventType: updated.event_type, scoreValue: updated.score_value, isActive: Boolean(updated.is_active) } });
  } catch (err) {
    console.error('PUT /api/scoring-rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

scoring.delete('/api/scoring-rules/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    await deleteScoringRule(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/scoring-rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 友だちスコア ==========

scoring.get('/api/friends/:id/score', requireVisibleFriendForScore, async (c) => {
  try {
    const friendId = c.req.param('id');
    const [score, history] = await Promise.all([
      getFriendScore(c.env.DB, friendId),
      getFriendScoreHistory(c.env.DB, friendId),
    ]);
    return c.json({
      success: true,
      data: {
        friendId,
        currentScore: score,
        /*
         * IDEA-17: 点数が変わった根拠を明細から辿れるように、発生した出来事・
         * 発生日時・前後の点数・動かした方法まで返す。旧行の NULL は欠損の
         * まま返し、表示側で「未取得」と書き分ける。
         */
        history: history.map((h) => ({
          id: h.id,
          scoringRuleId: h.scoring_rule_id,
          ruleKey: h.rule_key,
          scoreChange: h.score_change,
          scoreBefore: h.score_before,
          scoreAfter: h.score_after,
          reason: h.reason,
          eventType: h.event_type,
          source: h.source,
          occurredAt: h.occurred_at ?? h.created_at,
          createdAt: h.created_at,
          mode: h.executed_by_staff_id || h.executed_by_staff_name ? 'manual' : 'automatic',
          executedByStaffName: h.executed_by_staff_name,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/friends/:id/score error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 手動スコア加算
scoring.post('/api/friends/:id/score', requireRole('owner', 'admin'), requireVisibleFriendForScore, async (c) => {
  try {
    const friendId = c.req.param('id');
    const body = await c.req.json<{ scoreChange: number; reason?: string }>();
    if (typeof body.scoreChange !== 'number' || !Number.isFinite(body.scoreChange)) {
      return c.json({ success: false, error: 'scoreChange must be a finite number' }, 400);
    }
    const requestKey = c.req.header('Idempotency-Key');
    if (requestKey !== undefined && (!requestKey.trim() || requestKey.length > 128)) {
      return c.json({ success: false, error: 'Invalid Idempotency-Key' }, 400);
    }
    const staff = c.get('staff');
    await addScore(c.env.DB, {
      friendId,
      scoreChange: body.scoreChange,
      reason: body.reason,
      // IDEA-17: 手で動かした点数は「だれが」を明細からたどれるようにする。
      executedByStaffId: staff?.id ?? null,
      executedByStaffName: staff?.name ?? null,
      idempotencyKey: requestKey ? JSON.stringify(['manual', staff?.id ?? null, requestKey]) : undefined,
    });
    const newScore = await getFriendScore(c.env.DB, friendId);
    return c.json({ success: true, data: { friendId, currentScore: newScore } }, 201);
  } catch (err) {
    if (err instanceof Error && err.message === 'score_idempotency_conflict') {
      return c.json({ success: false, error: '同じ操作番号で異なる加点はできません' }, 409);
    }
    console.error('POST /api/friends/:id/score error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { scoring };
