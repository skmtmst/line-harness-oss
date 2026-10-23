import { buildOffsetListResponse, listQueryNumber } from '../lib/list-paging.js';
import { isCalendarDate as isExistingCalendarDate } from '@line-crm/shared';
import { inputError } from '../lib/input-errors.js';

import { getMileageAdminOverview, getMileageAdminHistory, getMileageHistoryPeriodSummary, getMileageManualAdjustmentPolicy, setMileageManualAdjustmentPolicy, findCommittedMileageAdjustment, postMileageAdjustment, MileageAdjustmentError, publishMileageEarningRule, confirmPendingMileageEntry, voidMileageLedgerEntry, createMileageAdjustmentApprovalRequest, listMileageAdjustmentApprovalRequests, approveMileageAdjustmentRequest, rejectMileageAdjustmentRequest, cancelMileageAdjustmentRequest } from '@line-crm/db';
import type { MileageEntryStatus, MileageEntryType } from '@line-crm/db';
import type { Env } from '../worker-env.js';
import { auditLog } from '../lib/audit-log.js';

import { getVisibleLineAccountScope } from '../services/account-access.js';
import { isValidIdempotencyKey } from '../services/outbound-idempotency.js';
import { mileageAdjustmentMessage, sendMileageAdjustmentNotification } from '../features/mileage/mileage-adjustment-notification/index.js';
import { canUseMileageAccount, mileageV6Error, MILEAGE_ENTRY_TYPES, MILEAGE_ENTRY_STATUSES, MILEAGE_MODES, MILEAGE_ADJUSTMENT_REASON_CATEGORIES } from './scoring-definition.js';
import type { Context } from 'hono';

export const post__api_mileage_earning_rules_id_publish_1 = async (c: Context<Env, "/api/mileage/earning-rules/:id/publish">) => {
    try {
      type Body = { accountId?: unknown; expectedVersion?: unknown };
      const body = await c.req.json<Body>().catch((): Body => ({}));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!await canUseMileageAccount(c, accountId)) {
        return inputError(c, { success: false, error: 'LINE account not found' }, accountId ? 404 : 400, []);
      }
      const idempotencyKey = c.req.header('Idempotency-Key');
      if (!isValidIdempotencyKey(idempotencyKey)) {
        return inputError(c, { success: false, error: '公開には有効な冪等キーが必要です' }, 400, ["friendId","rewardId","requestId"]);
      }
      const expectedVersion = typeof body.expectedVersion === 'number'
        ? body.expectedVersion
        : Number.NaN;
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return inputError(c, { success: false, error: '公開する下書きの版が必要です' }, 400, ["expectedVersion"]);
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
  };

export const get__api_mileage_overview_2 = async (c: Context<Env, "/api/mileage/overview">) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!accountId) {
      return c.json({ success: false, error: 'accountId is required' }, 400);
    }
    const accountScope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!accountScope.allowedAccountIds.includes(accountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const limit = Math.min(100, Math.max(1, listQueryNumber(c.req.query('limit') || undefined, 50)));
    const offset = Math.max(0, listQueryNumber(c.req.query('offset') || undefined, 0));
    const overview = await getMileageAdminOverview(c.env.DB, {
      accountId,
      visibleAccountIds: accountScope.allowedAccountIds,
      search: c.req.query('search') || '',
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    });
    return c.json({ success: true, data: buildOffsetListResponse({ ...overview, items: overview.members, total: overview.pagination.total, paging: { limit: overview.pagination.limit }, sort: [] }) });
  } catch (err) {
    throw err;
  }
};

export const get__api_mileage_history_3 = async (c: Context<Env, "/api/mileage/history">) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!accountId) {
      return c.json({ success: false, error: 'accountId is required' }, 400);
    }
    const accountScope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!accountScope.allowedAccountIds.includes(accountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const kind = c.req.query('kind');
    if (kind && !['earned', 'spent', 'voided'].includes(kind)) {
      return c.json({ success: false, error: 'kind is invalid' }, 400);
    }
    const entryTypeValue = c.req.query('entryType');
    const entryTypesValue = c.req.query('entryTypes');
    const entryTypes = entryTypesValue?.split(',');
    if (entryTypes && (!entryTypes.length || entryTypes.some((value) => !MILEAGE_ENTRY_TYPES.has(value as MileageEntryType)))) {
      return c.json({ success: false, error: 'entryTypes is invalid' }, 400);
    }
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
    if ((fromValue && !isExistingCalendarDate(fromValue)) || (toValue && !isExistingCalendarDate(toValue))) {
      return c.json({ success: false, error: 'from and to must be YYYY-MM-DD' }, 400);
    }
    if (fromValue && toValue && fromValue > toValue) {
      return c.json({ success: false, error: 'from must not be after to' }, 400);
    }
    const requestedLimit = listQueryNumber(c.req.query('limit') || undefined, 50);
    const requestedOffset = listQueryNumber(c.req.query('offset') || undefined, 0);
    const historyInput = {
      ...(kind ? { kind: kind as 'earned' | 'spent' | 'voided' } : {}),
      accountId,
      visibleAccountIds: accountScope.allowedAccountIds,
      search: c.req.query('search') || '',
      // V6R-CX-e: 友だち詳細は、その人（名寄せした複数アカウント）の履歴だけを取る。
      friendId: c.req.query('friendId')?.trim() || undefined,
      ...(entryTypes ? { entryTypes: entryTypes as MileageEntryType[] } : {}),
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
    return c.json({ success: true, data: buildOffsetListResponse({ ...history, summary, total: history.pagination.total, paging: { limit: history.pagination.limit }, sort: [{ field: 'occurredAt', direction: 'desc' }, { field: 'createdAt', direction: 'desc' }, { field: 'id', direction: 'desc' }] }) });
  } catch (err) {
    throw err;
  }
};

export const get__api_mileage_adjustment_policy_4 = async (c: Context<Env, "/api/mileage/adjustment-policy">) => {
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
    throw err;
  }
};

export const put__api_mileage_adjustment_policy_5 = async (c: Context<Env, "/api/mileage/adjustment-policy">) => {
  try {
    const body = await c.req.json<{ accountId?: unknown; approvalThreshold?: unknown }>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    const approvalThreshold = Number(body.approvalThreshold);
    if (!accountId || !Number.isInteger(approvalThreshold) || approvalThreshold <= 0) {
      return inputError(c, { success: false, error: 'accountId and a positive integer approvalThreshold are required' }, 400, ["accountId","approvalThreshold"]);
    }
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    if (!scope.allowedAccountIds.includes(accountId)) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    await setMileageManualAdjustmentPolicy(c.env.DB, accountId, { approvalThreshold });
    auditLog(c, 'mileage.adjustment.policy.update', { kind: 'line_account', id: accountId });
    return c.json({ success: true, data: { configured: true, approvalThreshold } });
  } catch (err) {
    throw err;
  }
};

export const post__api_mileage_adjustments_6 = async (c: Context<Env, "/api/mileage/adjustments">) => {
    try {
      const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
      if (!isValidIdempotencyKey(idempotencyKey)) {
        return inputError(c, { success: false, error: '有効なIdempotency-Keyが必要です' }, 400, ["friendId","rewardId","requestId"]);
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
        return inputError(c, { success: false, error: 'expiresAt must be a date-time string' }, 400, ["expiresAt"]);
      }
      const expiresAtValue = typeof body.expiresAt === 'string' ? body.expiresAt.trim() : '';
      const expiresAt = expiresAtValue ? new Date(expiresAtValue) : null;
      const notifyFriend = body.notifyFriend === undefined ? false : body.notifyFriend;
      if (!accountId || !friendId || !direction || !Number.isInteger(amount) || amount <= 0) {
        return inputError(c, { success: false, error: 'accountId, friendId, direction and a positive integer amount are required' }, 400, ["accountId","friendId","direction","amount"]);
      }
      if (amount > 1_000_000_000) {
        return inputError(c, { success: false, error: 'amount is too large' }, 400, ["amount"]);
      }
      if (!MILEAGE_ADJUSTMENT_REASON_CATEGORIES.has(reasonCategory)) {
        return inputError(c, { success: false, error: 'reasonCategory is invalid' }, 400, ["reasonCategory"]);
      }
      if (!reason || reason.length > 500 || sourceReferenceId.length > 128) {
        return inputError(c, { success: false, error: 'reason is required and one or more fields are too long' }, 400, ["reason","sourceReferenceId"]);
      }
      if (typeof notifyFriend !== 'boolean') {
        return inputError(c, { success: false, error: 'notifyFriend must be a boolean' }, 400, ["notifyFriend"]);
      }
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        return inputError(c, { success: false, error: 'expiresAt must be a date-time' }, 400, ["expiresAt"]);
      }
      if (expiresAt && direction !== 'increase') {
        return inputError(c, { success: false, error: 'expiresAt can only be set when increasing mileage' }, 400, ["expiresAt","direction"]);
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
        return inputError(c, { success: false, error: 'expiresAt must be a future date-time' }, 400, ["expiresAt"]);
      }

      const policy = await getMileageManualAdjustmentPolicy(c.env.DB, accountId);
      if (!policy) {
        return inputError(c, {
          success: false,
          error: '高額調整の承認境界が未設定です。オーナーが先に設定してください。',
          code: 'ADJUSTMENT_POLICY_REQUIRED',
        }, 400, ["accountId"]);
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
          return inputError(c, { success: false, error: '利用可能な残高を超えて減らすことはできません', code: err.code }, 400, []);
        }
        if (err.code === 'idempotency_conflict') {
          return c.json({ success: false, error: '同じIdempotency-Keyが別の内容で使われています', code: err.code }, 409);
        }
        if (err.code === 'friend_not_found') {
          return c.json({ success: false, error: 'Friend not found', code: err.code }, 404);
        }
      }
      throw err;
    }
  };

export const get__api_mileage_adjustment_approvals_7 = async (c: Context<Env, "/api/mileage/adjustment-approvals">) => {
  try {
    const accountId = c.req.query('accountId')?.trim() ?? '';
    if (!await canUseMileageAccount(c, accountId)) {
      return inputError(c, { success: false, error: 'LINE account not found' }, accountId ? 404 : 400, []);
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
};

export const post__api_mileage_adjustment_approvals_id_approve_8 = async (c: Context<Env, "/api/mileage/adjustment-approvals/:id/approve">) => {
    try {
      const body = await c.req.json<{ accountId?: unknown; reason?: unknown }>()
        .catch(() => ({} as { accountId?: unknown; reason?: unknown }));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!await canUseMileageAccount(c, accountId)) {
        return inputError(c, { success: false, error: 'LINE account not found' }, accountId ? 404 : 400, []);
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
  };

export const post__api_mileage_adjustment_approvals_id_reject_9 = async (c: Context<Env, "/api/mileage/adjustment-approvals/:id/reject">) => {
    try {
      const body = await c.req.json<{ accountId?: unknown; reason?: unknown }>()
        .catch(() => ({} as { accountId?: unknown; reason?: unknown }));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!await canUseMileageAccount(c, accountId)) {
        return inputError(c, { success: false, error: 'LINE account not found' }, accountId ? 404 : 400, []);
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
  };

export const post__api_mileage_adjustment_approvals_id_cancel_10 = async (c: Context<Env, "/api/mileage/adjustment-approvals/:id/cancel">) => {
    try {
      const body = await c.req.json<{ accountId?: unknown }>()
        .catch(() => ({} as { accountId?: unknown }));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      if (!await canUseMileageAccount(c, accountId)) {
        return inputError(c, { success: false, error: 'LINE account not found' }, accountId ? 404 : 400, []);
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
  };

export const post__api_mileage_entries_id_confirm_11 = async (c: Context<Env, "/api/mileage/entries/:id/confirm">) => {
    try {
      const body = await c.req.json<{ accountId?: unknown; reason?: unknown }>()
        .catch(() => ({} as { accountId?: unknown; reason?: unknown }));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!accountId) {
        return inputError(c, { success: false, error: 'accountId is required' }, 400, ["accountId"]);
      }
      if (!reason) {
        return inputError(c, { success: false, error: '理由を入力してください', code: 'reason_required' }, 400, ["reason"]);
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
  };

export const post__api_mileage_entries_id_void_12 = async (c: Context<Env, "/api/mileage/entries/:id/void">) => {
    try {
      const body = await c.req.json<{ accountId?: unknown; reason?: unknown }>()
        .catch(() => ({} as { accountId?: unknown; reason?: unknown }));
      const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!accountId) {
        return inputError(c, { success: false, error: 'accountId is required' }, 400, ["accountId"]);
      }
      if (!reason) {
        return inputError(c, { success: false, error: '理由を入力してください', code: 'reason_required' }, 400, ["reason"]);
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
  };
