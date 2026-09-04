import { Hono, type Context } from 'hono';
import {
  getScoringRules,
  getScoringRuleById,
  createScoringRule,
  updateScoringRule,
  deleteScoringRule,
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
  applyMileageRulesForEvent,
  getMileageManualAdjustmentPolicy,
  setMileageManualAdjustmentPolicy,
  postMileageAdjustment,
  MileageAdjustmentError,
  getActionScoreOverview,
  getActionScoreBands,
  createMileageRewardDraft,
  createMileageRewardDraftFromPublished,
  getMileageReward,
  getMileageRewardAdminOverview,
  getMileageRedemption,
  importMileageRewardCodes,
  publishMileageReward,
  reorderMileageRewards,
  reserveMileageRewardRedemption,
  setMileageRewardStatus,
  updateMileageRewardDraft,
  encryptCredential,
  MileageRewardError,
} from '@line-crm/db';
import type {
  ActionScoreFilter,
  ActionScoreSort,
  MileageEntryStatus,
  MileageEntryType,
  MileageRuleRow,
  MileageRewardDraftInput,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { auditLog } from '../lib/audit-log.js';
import { requireIrreversibleConfirmation, requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { isValidIdempotencyKey } from '../services/outbound-idempotency.js';
import { sha256Hex } from '../middleware/auth.js';
import { deliverMileageReward } from '../services/mileage-reward-delivery.js';

const scoring = new Hono<Env>();

function mileageRewardError(c: Parameters<typeof auditLog>[0], error: unknown) {
  if (error instanceof MileageRewardError) {
    return c.json({ success: false, error: error.message, code: error.code }, error.status as 400);
  }
  console.error('mileage rewards error:', error);
  return c.json({ success: false, error: '使い道を処理できませんでした' }, 500);
}

async function canUseMileageAccount(c: Parameters<typeof auditLog>[0], accountId: string) {
  if (!accountId) return false;
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  return scope.allowedAccountIds.includes(accountId);
}

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
      draft?: MileageRewardDraftInput;
    }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    const expectedVersionId = typeof body.expectedVersionId === 'string'
      ? body.expectedVersionId.trim()
      : '';
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
    }
    if (!body.draft || !expectedVersionId) {
      return c.json({ success: false, error: '読み込んだ版と変更内容が必要です' }, 400);
    }
    const reward = await updateMileageRewardDraft(c.env.DB, {
      id: c.req.param('id') ?? '', lineAccountId: accountId, expectedVersionId,
      updatedBy: c.get('staff').id, draft: body.draft,
    });
    auditLog(c, 'mileage.reward.update', { kind: 'mileage_reward', id: reward.id });
    return c.json({ success: true, data: reward });
  } catch (error) {
    return mileageRewardError(c, error);
  }
}

// ========== マイル管理 ==========

scoring.get('/api/mileage/rewards', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!await canUseMileageAccount(c, accountId)) {
      return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
    }
    return c.json({ success: true, data: await getMileageRewardAdminOverview(c.env.DB, accountId) });
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
      const body = await c.req.json<{ accountId?: unknown }>();
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!await canUseMileageAccount(c, accountId)) {
        return c.json({ success: false, error: 'LINE公式アカウントが見つかりません' }, 404);
      }
      const reward = await publishMileageReward(c.env.DB, {
        id: c.req.param('id'), lineAccountId: accountId, publishedBy: c.get('staff').id,
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
      const delivery = await deliverMileageReward(c.env.DB, redemption.id, {
        credentialEncryptionKey: c.env.LINE_CREDENTIAL_ENCRYPTION_KEY,
      });
      auditLog(c, 'mileage.redemption.retry', { kind: 'mileage_redemption', id: redemption.id });
      return c.json({ success: delivery.status === 'succeeded', data: delivery },
        delivery.status === 'succeeded' ? 200 : 202);
    } catch (error) {
      return mileageRewardError(c, error);
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
    const history = await getMileageAdminHistory(c.env.DB, {
      accountId,
      visibleAccountIds: accountScope.allowedAccountIds,
      search: c.req.query('search') || '',
      entryType: entryTypeValue as MileageEntryType | undefined,
      status: statusValue as MileageEntryStatus | undefined,
      mode: modeValue as 'automatic' | 'manual' | undefined,
      from: fromValue || undefined,
      to: toValue || undefined,
      limit: Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50,
      offset: Number.isFinite(requestedOffset) ? Math.max(0, requestedOffset) : 0,
    });
    return c.json({ success: true, data: history });
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

      const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
      if (!scope.allowedAccountIds.includes(accountId)) {
        return c.json({ success: false, error: 'LINE account not found' }, 404);
      }
      const friend = await c.env.DB.prepare(
        `SELECT id FROM friends WHERE id = ? AND line_account_id = ?`,
      ).bind(friendId, accountId).first<{ id: string }>();
      if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

      const policy = await getMileageManualAdjustmentPolicy(c.env.DB, accountId);
      if (!policy) {
        return c.json({
          success: false,
          error: '高額調整の承認境界が未設定です。オーナーが先に設定してください。',
          code: 'ADJUSTMENT_POLICY_REQUIRED',
        }, 400);
      }
      if (amount >= policy.approvalThreshold) {
        return c.json({
          success: false,
          error: `${policy.approvalThreshold.toLocaleString('ja-JP')} mile以上は別のオーナー承認が必要です。`,
          code: 'OWNER_APPROVAL_REQUIRED',
          data: { approvalThreshold: policy.approvalThreshold },
        }, 400);
      }

      const staff = c.get('staff');
      const signedAmount = direction === 'decrease' ? -amount : amount;
      const result = await postMileageAdjustment(c.env.DB, {
        friendId,
        amount: signedAmount,
        reason,
        reasonCategory,
        sourceReferenceId: sourceReferenceId || null,
        idempotencyKey,
        executedByStaffId: staff.id,
        executedByStaffName: staff.name,
        lineAccountId: accountId,
      });
      auditLog(c, 'mileage.adjustment.create', { kind: 'mileage_ledger', id: result.entry.id });
      return c.json({
        success: true,
        data: {
          entryId: result.entry.id,
          balanceBefore: result.balanceBefore,
          amount: result.entry.amount,
          balanceAfter: result.balanceAfter,
          replayed: result.replayed,
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

scoring.get('/api/mileage/rules', async (c) => {
  try {
    const rules = await getMileageRules(c.env.DB);
    return c.json({ success: true, data: rules.map(serializeMileageRule) });
  } catch (err) {
    console.error('GET /api/mileage/rules error:', err);
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
    }>();
    if (!body.name?.trim() || !body.eventType?.trim() || !Number.isInteger(body.amount) || (body.amount ?? 0) <= 0) {
      return c.json({ success: false, error: 'name, eventType and a positive integer amount are required' }, 400);
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
    const updated = await updateMileageRule(c.env.DB, c.req.param('id'), body);
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
    await deleteMileageRule(c.env.DB, existing.id);
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

scoring.get('/api/friends/:id/score', async (c) => {
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
        history: history.map((h) => ({
          id: h.id,
          scoringRuleId: h.scoring_rule_id,
          scoreChange: h.score_change,
          reason: h.reason,
          createdAt: h.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/friends/:id/score error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 手動スコア加算
scoring.post('/api/friends/:id/score', requireRole('owner', 'admin'), async (c) => {
  try {
    const friendId = c.req.param('id');
    const body = await c.req.json<{ scoreChange: number; reason?: string }>();
    if (body.scoreChange === undefined) return c.json({ success: false, error: 'scoreChange is required' }, 400);
    await addScore(c.env.DB, { friendId, scoreChange: body.scoreChange, reason: body.reason });
    const newScore = await getFriendScore(c.env.DB, friendId);
    return c.json({ success: true, data: { friendId, currentScore: newScore } }, 201);
  } catch (err) {
    console.error('POST /api/friends/:id/score error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { scoring };
