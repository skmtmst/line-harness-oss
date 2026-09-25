import { Hono } from 'hono';
import { getBroadcastById, createNotification, type Broadcast } from '@line-crm/db';
import { BROADCAST_APPROVE_KEY, BROADCAST_DEFINITION_PUBLISH_KEY } from '@line-crm/shared';
import type { Env } from '../index.js';
import type { AuthenticatedStaff } from '../middleware/auth.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { resolveRequestBoundaries } from '../services/request-boundary.js';
import {
  canApproveBroadcast,
  countActiveOperators,
  evaluateApprovalGate,
  getBroadcastApprovalThreshold,
  notifyBroadcastApproval,
  readApprovalStatus,
  recordBroadcastApprovalEvent,
  setBroadcastApprovalThreshold,
} from '../services/broadcast-approval.js';

/**
 * 一斉配信の二者承認の口（m12a / v6-06 §6）。
 *
 * 送る人（依頼）と承認する人は別人。自分の依頼は承認できない。
 * 承認済みになってから既存の送信の流れ（POST /:id/send・cron）に渡す。
 * 二重実行は承認の条件付き更新（pending のときだけ動く）で防ぐ。
 */
const broadcastApprovals = new Hono<Env>();

function accountIdsOf(broadcast: Broadcast): Array<string | null> {
  const raw = broadcast as unknown as Record<string, unknown>;
  const lineAccountId = (raw.line_account_id as string | null | undefined) ?? null;
  if (broadcast.target_type === 'multi-account-dedup') {
    try {
      const parsed = raw.account_ids == null ? null : JSON.parse(String(raw.account_ids));
      if (Array.isArray(parsed) && parsed.length > 0) {
        return (parsed as unknown[]).filter((id): id is string => typeof id === 'string');
      }
    } catch { /* 壊れた値は単一アカウント扱いに落とす */ }
  }
  return [lineAccountId];
}


async function loadBroadcast(
  db: D1Database,
  staff: AuthenticatedStaff | undefined,
  id: string,
): Promise<Broadcast | null> {
  const broadcast = await getBroadcastById(db, id);
  if (!broadcast) return null;
  if (!await canAccessAllLineAccounts(db, staff, accountIdsOf(broadcast))) return null;
  return broadcast;
}

/** 送る側の境界。owner/admin は通し、staff は /broadcasts＋送信の鍵が要る。 */
async function senderBoundary(
  db: D1Database,
  staff: AuthenticatedStaff | undefined,
  accountIds: Array<string | null | undefined>,
): Promise<boolean> {
  if (staff && (staff.role === 'owner' || staff.role === 'admin')) {
    return canAccessAllLineAccounts(db, staff, accountIds);
  }
  const decision = await resolveRequestBoundaries(db, staff, accountIds, {
    requiredPermissionKey: '/broadcasts',
  });
  if (!decision.allowed) return false;
  // 範囲の中でも、送信の個別キーが要る（broadcasts.ts の broadcastWriteBoundary と同じ）。
  if (staff?.readOnly) return false;
  return staff?.permissionKeys?.includes(BROADCAST_DEFINITION_PUBLISH_KEY) === true;
}

function serializeApproval(broadcast: Broadcast) {
  const raw = broadcast as unknown as Record<string, unknown>;
  return {
    status: readApprovalStatus(broadcast),
    requestedByStaffId: (raw.approval_requested_by_staff_id as string | null | undefined) ?? null,
    requestedAt: (raw.approval_requested_at as string | null | undefined) ?? null,
    approverStaffId: (raw.approval_approver_staff_id as string | null | undefined) ?? null,
    note: (raw.approval_note as string | null | undefined) ?? null,
    decidedByStaffId: (raw.approval_decided_by_staff_id as string | null | undefined) ?? null,
    decidedAt: (raw.approval_decided_at as string | null | undefined) ?? null,
    rejectReason: (raw.approval_reject_reason as string | null | undefined) ?? null,
    confirmedCount: raw.approval_confirmed_count == null ? null : Number(raw.approval_confirmed_count),
  };
}

async function staffName(db: D1Database, staffId: string | null): Promise<string> {
  if (!staffId) return '担当者';
  try {
    const row = await db.prepare(`SELECT name FROM staff_members WHERE id = ?`)
      .bind(staffId).first<{ name: string }>();
    return row?.name?.trim() || '担当者';
  } catch {
    return '担当者';
  }
}


// GET /api/broadcasts/approvals/candidates — 承認を頼める相手の一覧（自分は除く）
broadcastApprovals.get('/api/broadcasts/approvals/candidates', async (c) => {
  try {
    const staff = c.get('staff');
    const lineAccountId = (c.req.query('lineAccountId') ?? '').trim();
    if (lineAccountId && !await canAccessAllLineAccounts(c.env.DB, staff, [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントの担当者は確認できません' }, 403);
    }
    const rows = await c.env.DB.prepare(
      `SELECT id, name, role, permission_keys FROM staff_members
        WHERE is_active = 1 AND invite_status = 'active' ORDER BY name`,
    ).all<{ id: string; name: string; role: string; permission_keys: string }>();
    const items = (rows.results ?? [])
      .filter((row) => row.id !== staff?.id)
      .map((row) => {
        let keys: string[] = [];
        try { keys = row.permission_keys ? JSON.parse(row.permission_keys) as string[] : []; } catch { keys = []; }
        const canApprove = row.role === 'owner' || row.role === 'admin'
          || keys.includes(BROADCAST_APPROVE_KEY);
        return { id: row.id, name: row.name, role: row.role, canApprove };
      })
      .filter((item) => item.canApprove);
    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('GET /api/broadcasts/approvals/candidates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/approval-threshold — 承認が要る通数の境目
broadcastApprovals.get('/api/broadcasts/approval-threshold', async (c) => {
  try {
    const lineAccountId = (c.req.query('lineAccountId') ?? '').trim();
    if (!lineAccountId) {
      return c.json({ success: false, error: 'LINEアカウントを指定してください' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントの設定は確認できません' }, 403);
    }
    const fake = { target_type: 'all', line_account_id: lineAccountId } as unknown as Broadcast;
    const threshold = await getBroadcastApprovalThreshold(c.env.DB, fake);
    return c.json({ success: true, data: { lineAccountId, threshold } });
  } catch (err) {
    console.error('GET /api/broadcasts/approval-threshold error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/broadcasts/approval-threshold — 境目の変更（機能設定）
broadcastApprovals.put('/api/broadcasts/approval-threshold', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ lineAccountId?: unknown; threshold?: unknown }>().catch(() => null);
    const lineAccountId = typeof body?.lineAccountId === 'string' ? body.lineAccountId.trim() : '';
    if (!lineAccountId) {
      return c.json({ success: false, error: 'LINEアカウントを指定してください' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントの設定は変更できません' }, 403);
    }
    const saved = await setBroadcastApprovalThreshold(c.env.DB, lineAccountId, body?.threshold);
    if (!saved.ok) return c.json({ success: false, error: saved.error }, 400);
    return c.json({ success: true, data: { lineAccountId, threshold: saved.threshold } });
  } catch (err) {
    console.error('PUT /api/broadcasts/approval-threshold error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/approval-config — 送信の確認画面が出し分けに使う境目と人数
broadcastApprovals.get('/api/broadcasts/approval-config', async (c) => {
  try {
    const lineAccountId = (c.req.query('lineAccountId') ?? '').trim();
    if (!lineAccountId) {
      return c.json({ success: false, error: 'LINEアカウントを指定してください' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: 'このLINEアカウントの設定は確認できません' }, 403);
    }
    const fake = { target_type: 'all', line_account_id: lineAccountId } as unknown as Broadcast;
    const [threshold, operatorCount] = await Promise.all([
      getBroadcastApprovalThreshold(c.env.DB, fake),
      countActiveOperators(c.env.DB),
    ]);
    return c.json({
      success: true,
      data: { lineAccountId, threshold, operatorCount, singleOperator: operatorCount <= 1 },
    });
  } catch (err) {
    console.error('GET /api/broadcasts/approval-config error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/:id/approval — 承認の今の状態と、承認が要るかの判定
broadcastApprovals.get('/api/broadcasts/:id/approval', async (c) => {
  try {
    const staff = c.get('staff');
    const broadcast = await loadBroadcast(c.env.DB, staff, c.req.param('id'));
    if (!broadcast) return c.json({ success: false, error: 'Broadcast not found' }, 404);
    const gate = await evaluateApprovalGate(c.env.DB, broadcast);
    const approval = serializeApproval(broadcast);
    return c.json({
      success: true,
      data: {
        approval,
        gate: {
          required: gate.required,
          recipientCount: gate.recipientCount,
          threshold: gate.threshold,
          singleOperator: gate.singleOperator,
          operatorCount: gate.operatorCount,
        },
        viewer: {
          // 承認する人にだけ承認の操作を出す。自分の依頼かは送る側の判定に使う。
          isApprover: !!approval.approverStaffId && approval.approverStaffId === staff?.id,
          canApprove: canApproveBroadcast(staff),
          isRequester: !!approval.requestedByStaffId && approval.requestedByStaffId === staff?.id,
        },
      },
    });
  } catch (err) {
    console.error('GET /api/broadcasts/:id/approval error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/approval-request — 承認の依頼（送る人が押す）
broadcastApprovals.post('/api/broadcasts/:id/approval-request', async (c) => {
  try {
    const staff = c.get('staff');
    const broadcast = await loadBroadcast(c.env.DB, staff, c.req.param('id'));
    if (!broadcast) return c.json({ success: false, error: 'Broadcast not found' }, 404);
    if (!await senderBoundary(c.env.DB, staff, accountIdsOf(broadcast))) {
      return c.json({ success: false, error: 'この機能を操作する権限がありません' }, 403);
    }
    if (broadcast.status !== 'draft' && broadcast.status !== 'scheduled') {
      return c.json({ success: false, error: '下書き・予約の配信だけ承認を依頼できます' }, 400);
    }
    const gate = await evaluateApprovalGate(c.env.DB, broadcast);
    if (!gate.required) {
      return c.json({ success: false, error: 'この人数では承認は要りません。そのまま送れます。', code: 'APPROVAL_NOT_REQUIRED' }, 409);
    }
    if (gate.singleOperator) {
      return c.json({
        success: false,
        error: '運用者が1人だけなので、人数の確認で送れます。承認の依頼は要りません。',
        code: 'SINGLE_OPERATOR',
        recipientCount: gate.recipientCount,
      }, 409);
    }
    const body = await c.req.json<{ approverStaffId?: unknown; note?: unknown }>().catch(() => null);
    const approverStaffId = typeof body?.approverStaffId === 'string' ? body.approverStaffId.trim() : '';
    if (!approverStaffId) {
      return c.json({ success: false, error: '承認をお願いする人を選んでください' }, 400);
    }
    if (approverStaffId === staff?.id) {
      return c.json({ success: false, error: '自分の依頼は自分で承認できません。別の人を選んでください', code: 'SELF_APPROVAL' }, 403);
    }
    const approver = await c.env.DB.prepare(
      `SELECT id, name, role, permission_keys, is_active, invite_status FROM staff_members WHERE id = ?`,
    ).bind(approverStaffId).first<{
      id: string; name: string; role: string; permission_keys: string; is_active: number; invite_status: string;
    }>();
    let approverKeys: string[] = [];
    try { approverKeys = approver?.permission_keys ? JSON.parse(approver.permission_keys) as string[] : []; } catch { approverKeys = []; }
    const approverStaff: AuthenticatedStaff | undefined = approver
      ? {
        id: approver.id, name: approver.name, role: approver.role as AuthenticatedStaff['role'],
        readOnly: false, permissionKeys: approverKeys,
      }
      : undefined;
    if (!approver || approver.is_active !== 1 || approver.invite_status !== 'active'
      || !canApproveBroadcast(approverStaff)) {
      return c.json({ success: false, error: '承認できる人を選んでください' }, 400);
    }
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
    const now = new Date().toISOString();
    // pending のまま二重に頼めない。差し戻し・取消・期限切れのあとは頼み直せる。
    const claimed = await c.env.DB.prepare(
      `UPDATE broadcasts
          SET approval_status = 'pending',
              approval_requested_by_staff_id = ?,
              approval_requested_at = ?,
              approval_approver_staff_id = ?,
              approval_note = ?,
              approval_decided_by_staff_id = NULL,
              approval_decided_at = NULL,
              approval_reject_reason = NULL,
              approval_confirmed_count = NULL
        WHERE id = ? AND approval_status IN ('none', 'rejected', 'cancelled', 'expired')
          AND status IN ('draft', 'scheduled')`,
    ).bind(staff?.id ?? '', now, approverStaffId, note || null, broadcast.id).run();
    if (!claimed.meta.changes) {
      return c.json({ success: false, error: 'すでに承認の依頼中です。状態を読み直してください。', code: 'ALREADY_REQUESTED' }, 409);
    }
    await recordBroadcastApprovalEvent(c.env.DB, broadcast.id, staff?.id ?? '', 'requested', note || null);
    const requesterName = await staffName(c.env.DB, staff?.id ?? null);
    await notifyBroadcastApproval(
      c.env.DB, broadcast, 'broadcast.approval.requested',
      `承認の依頼：「${broadcast.title}」`,
      `${requesterName}さんから承認の依頼が届いています。${gate.recipientCount.toLocaleString('ja-JP')}人への配信です。内容を確かめて承認・差し戻しをしてください。`
      + (note ? `ひとこと：${note}` : ''),
    );
    const updated = await getBroadcastById(c.env.DB, broadcast.id);
    return c.json({ success: true, data: { approval: serializeApproval(updated ?? broadcast) } }, 201);
  } catch (err) {
    console.error('POST /api/broadcasts/:id/approval-request error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/approval-approve — 承認（承認する人が押す）
broadcastApprovals.post('/api/broadcasts/:id/approval-approve', async (c) => {
  try {
    const staff = c.get('staff');
    const broadcast = await loadBroadcast(c.env.DB, staff, c.req.param('id'));
    if (!broadcast) return c.json({ success: false, error: 'Broadcast not found' }, 404);
    if (!canApproveBroadcast(staff)) {
      return c.json({ success: false, error: '承認する権限がありません' }, 403);
    }
    const raw = broadcast as unknown as Record<string, unknown>;
    const requestedBy = (raw.approval_requested_by_staff_id as string | null | undefined) ?? null;
    if (requestedBy && requestedBy === staff?.id) {
      return c.json({ success: false, error: '自分の依頼は承認できません', code: 'SELF_APPROVAL' }, 403);
    }
    const now = new Date().toISOString();
    // pending のときだけ承認済みにする。二重押し・取り消し後の承認を防ぐ。
    const claimed = await c.env.DB.prepare(
      `UPDATE broadcasts
          SET approval_status = 'approved',
              approval_decided_by_staff_id = ?,
              approval_decided_at = ?
        WHERE id = ? AND approval_status = 'pending' AND status IN ('draft', 'scheduled')`,
    ).bind(staff?.id ?? '', now, broadcast.id).run();
    if (!claimed.meta.changes) {
      return c.json({ success: false, error: '承認できる依頼がありません。状態を読み直してください。', code: 'NOT_PENDING' }, 409);
    }
    await recordBroadcastApprovalEvent(c.env.DB, broadcast.id, staff?.id ?? '', 'approved');
    const approverName = await staffName(c.env.DB, staff?.id ?? null);
    await notifyBroadcastApproval(
      c.env.DB, broadcast, 'broadcast.approval.approved',
      `承認されました：「${broadcast.title}」`,
      `${approverName}さんが承認しました。${broadcast.scheduled_at ? '予約の時刻になったら送ります。' : '送る操作へ進めます。'}`,
    );
    const updated = await getBroadcastById(c.env.DB, broadcast.id);
    return c.json({
      success: true,
      data: {
        approval: serializeApproval(updated ?? broadcast),
        // 予約なし（今すぐ送る分）は、承認のあと既存の送信の流れへ渡す。
        needsSend: !broadcast.scheduled_at,
      },
    });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/approval-approve error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/approval-reject — 差し戻し（理由必須）
broadcastApprovals.post('/api/broadcasts/:id/approval-reject', async (c) => {
  try {
    const staff = c.get('staff');
    const broadcast = await loadBroadcast(c.env.DB, staff, c.req.param('id'));
    if (!broadcast) return c.json({ success: false, error: 'Broadcast not found' }, 404);
    if (!canApproveBroadcast(staff)) {
      return c.json({ success: false, error: '差し戻す権限がありません' }, 403);
    }
    const raw = broadcast as unknown as Record<string, unknown>;
    const requestedBy = (raw.approval_requested_by_staff_id as string | null | undefined) ?? null;
    if (requestedBy && requestedBy === staff?.id) {
      return c.json({ success: false, error: '自分の依頼は差し戻せません', code: 'SELF_APPROVAL' }, 403);
    }
    const body = await c.req.json<{ reason?: unknown }>().catch(() => null);
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      return c.json({ success: false, error: '差し戻す理由を入れてください', code: 'REASON_REQUIRED' }, 400);
    }
    const now = new Date().toISOString();
    const claimed = await c.env.DB.prepare(
      `UPDATE broadcasts
          SET approval_status = 'rejected',
              approval_decided_by_staff_id = ?,
              approval_decided_at = ?,
              approval_reject_reason = ?
        WHERE id = ? AND approval_status = 'pending' AND status IN ('draft', 'scheduled')`,
    ).bind(staff?.id ?? '', now, reason.slice(0, 1000), broadcast.id).run();
    if (!claimed.meta.changes) {
      return c.json({ success: false, error: '差し戻せる依頼がありません。状態を読み直してください。', code: 'NOT_PENDING' }, 409);
    }
    await recordBroadcastApprovalEvent(c.env.DB, broadcast.id, staff?.id ?? '', 'rejected', reason.slice(0, 1000));
    const approverName = await staffName(c.env.DB, staff?.id ?? null);
    await notifyBroadcastApproval(
      c.env.DB, broadcast, 'broadcast.approval.rejected',
      `差し戻されました：「${broadcast.title}」`,
      `${approverName}さんが差し戻しました。理由：${reason}`,
    );
    const updated = await getBroadcastById(c.env.DB, broadcast.id);
    return c.json({ success: true, data: { approval: serializeApproval(updated ?? broadcast) } });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/approval-reject error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/approval-cancel — 依頼の取り消し（頼んだ人・owner/admin）
broadcastApprovals.post('/api/broadcasts/:id/approval-cancel', async (c) => {
  try {
    const staff = c.get('staff');
    const broadcast = await loadBroadcast(c.env.DB, staff, c.req.param('id'));
    if (!broadcast) return c.json({ success: false, error: 'Broadcast not found' }, 404);
    if (!await senderBoundary(c.env.DB, staff, accountIdsOf(broadcast))) {
      return c.json({ success: false, error: 'この機能を操作する権限がありません' }, 403);
    }
    const raw = broadcast as unknown as Record<string, unknown>;
    const requestedBy = (raw.approval_requested_by_staff_id as string | null | undefined) ?? null;
    const isOwnerAdmin = staff?.role === 'owner' || staff?.role === 'admin';
    if (requestedBy && requestedBy !== staff?.id && !isOwnerAdmin) {
      return c.json({ success: false, error: '頼んだ人だけ取り消せます' }, 403);
    }
    const claimed = await c.env.DB.prepare(
      `UPDATE broadcasts SET approval_status = 'cancelled'
        WHERE id = ? AND approval_status = 'pending' AND status IN ('draft', 'scheduled')`,
    ).bind(broadcast.id).run();
    if (!claimed.meta.changes) {
      return c.json({ success: false, error: '取り消せる依頼がありません。状態を読み直してください。', code: 'NOT_PENDING' }, 409);
    }
    await recordBroadcastApprovalEvent(c.env.DB, broadcast.id, staff?.id ?? '', 'cancelled');
    const updated = await getBroadcastById(c.env.DB, broadcast.id);
    return c.json({ success: true, data: { approval: serializeApproval(updated ?? broadcast) } });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/approval-cancel error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/approval-remind — もう一度知らせる（頼んだ人・owner/admin）
broadcastApprovals.post('/api/broadcasts/:id/approval-remind', async (c) => {
  try {
    const staff = c.get('staff');
    const broadcast = await loadBroadcast(c.env.DB, staff, c.req.param('id'));
    if (!broadcast) return c.json({ success: false, error: 'Broadcast not found' }, 404);
    if (!await senderBoundary(c.env.DB, staff, accountIdsOf(broadcast))) {
      return c.json({ success: false, error: 'この機能を操作する権限がありません' }, 403);
    }
    if (readApprovalStatus(broadcast) !== 'pending') {
      return c.json({ success: false, error: '依頼中のものだけ知らせ直せます', code: 'NOT_PENDING' }, 409);
    }
    const gate = await evaluateApprovalGate(c.env.DB, broadcast);
    const raw = broadcast as unknown as Record<string, unknown>;
    const approverName = await staffName(
      c.env.DB, (raw.approval_approver_staff_id as string | null | undefined) ?? null,
    );
    await recordBroadcastApprovalEvent(c.env.DB, broadcast.id, staff?.id ?? '', 'reminded');
    await notifyBroadcastApproval(
      c.env.DB, broadcast, 'broadcast.approval.reminded',
      `承認のお願い：「${broadcast.title}」`,
      `${approverName}さんへ、承認をもう一度お願いします。${gate.recipientCount.toLocaleString('ja-JP')}人への配信です。${
        broadcast.scheduled_at ? '承認されないまま予約の時刻を過ぎると、送らずに期限切れになります。' : ''
      }`,
    );
    return c.json({ success: true, data: { reminded: true } });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/approval-remind error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { broadcastApprovals };
