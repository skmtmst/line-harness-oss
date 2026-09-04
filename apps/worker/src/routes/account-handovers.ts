import { Hono } from 'hono';
import {
  cancelHandover,
  compareProviders,
  completeHandover,
  countsAddUp,
  getHandoverById,
  issueHandoverCode,
  linkHandover,
  listDecisions,
  listHandoversForAccount,
  markExecuting,
  markResolved,
  saveDecision,
  savePreview,
  unresolvedReviewCount,
  MATCH_BUCKETS,
  type HandoverRow,
  type MatchBucket,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';

/**
 * LINEアカウントの乗り換え（引き継ぎ）。設計 ★V6 33-4（`nx3XW`）。台帳 #133。
 *
 * 5段の流れ。
 *   1 引き継ぎコードを出す   POST /api/account-handovers
 *   2 受け取り先で読む       POST /api/account-handovers/link
 *   3 事前確認               POST /api/account-handovers/:id/preview
 *   4 競合の判断             PUT  /api/account-handovers/:id/decisions
 *   5 本実行と照合           POST /api/account-handovers/:id/execute
 *
 * **事前確認だけでは元のアカウントを何も変えない。**
 * 段3が触るのは `account_handovers` の数の列だけで、`friends` には書かない。
 */
const accountHandovers = new Hono<Env>();

function serialize(row: HandoverRow) {
  return {
    id: row.id,
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    code: row.code,
    codeExpiresAt: row.code_expires_at,
    status: row.status,
    providerMatch: row.provider_match,
    /*
      **数はまとめて出すか、まとめて出さないか。** 片方だけ出すと、
      画面が「合計が合わない」と読む。事前確認が終わるまでは全部 null。
    */
    counts:
      row.source_friend_total === null
        ? null
        : {
            sourceTotal: row.source_friend_total,
            auto: row.auto_count ?? 0,
            review: row.review_count ?? 0,
            unmatched: row.unmatched_count ?? 0,
            lookalike: row.lookalike_count ?? 0,
          },
    movedCount: row.moved_count,
    failedCount: row.failed_count,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    linkedAt: row.linked_at,
    previewedAt: row.previewed_at,
    resolvedAt: row.resolved_at,
    executedAt: row.executed_at,
    completedAt: row.completed_at,
  };
}

/** 見られる引き継ぎだけを返す。**片方のアカウントだけ見えても通さない。** */
async function loadAccessible(
  db: D1Database,
  staff: Parameters<typeof canAccessAllLineAccounts>[1],
  id: string,
): Promise<HandoverRow | null> {
  const handover = await getHandoverById(db, id);
  if (!handover) return null;
  const ids = [handover.from_account_id, handover.to_account_id].filter(
    (v): v is string => typeof v === 'string',
  );
  if (!(await canAccessAllLineAccounts(db, staff, ids))) return null;
  return handover;
}

/** 段1。引き継ぎコードを出す。 */
accountHandovers.post('/api/account-handovers', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ fromAccountId?: string }>();
    if (!body.fromAccountId) {
      return c.json({ success: false, error: 'fromAccountId が要ります' }, 400);
    }
    if (!(await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.fromAccountId]))) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const staff = c.get('staff');
    const handover = await issueHandoverCode(c.env.DB, {
      fromAccountId: body.fromAccountId,
      createdBy: staff?.id ?? null,
    });
    return c.json({ success: true, data: serialize(handover) }, 201);
  } catch (err) {
    console.error('POST /api/account-handovers error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** 段2。受け取り先でコードを読む。 */
accountHandovers.post('/api/account-handovers/link', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ code?: string; toAccountId?: string }>();
    if (!body.code || !body.toAccountId) {
      return c.json({ success: false, error: 'code と toAccountId が要ります' }, 400);
    }
    if (!(await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [body.toAccountId]))) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    /*
      プロバイダーが同じか。**LINE は返さないので、こちらに入っている値で見る。**
      どちらかが未入力なら unknown。同じだと決めつけない。
    */
    const rows = await c.env.DB.prepare(
      `SELECT id, provider_id FROM line_accounts WHERE id IN (
         SELECT from_account_id FROM account_handovers WHERE code = ?
       ) OR id = ?`,
    )
      .bind(body.code, body.toAccountId)
      .all<{ id: string; provider_id: string | null }>();
    const toProvider = rows.results.find((r) => r.id === body.toAccountId)?.provider_id ?? null;
    const fromProvider = rows.results.find((r) => r.id !== body.toAccountId)?.provider_id ?? null;

    const linked = await linkHandover(c.env.DB, {
      code: body.code,
      toAccountId: body.toAccountId,
      providerMatch: compareProviders(fromProvider, toProvider),
    });
    if (!linked.ok) return c.json({ success: false, error: linked.error }, 422);
    return c.json({ success: true, data: serialize(linked.handover) });
  } catch (err) {
    console.error('POST /api/account-handovers/link error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

accountHandovers.get('/api/account-handovers/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const handover = await loadAccessible(c.env.DB, c.get('staff'), c.req.param('id'));
    if (!handover) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: {
        ...serialize(handover),
        decisions: await listDecisions(c.env.DB, handover.id),
        unresolvedReviews: await unresolvedReviewCount(c.env.DB, handover.id),
      },
    });
  } catch (err) {
    console.error('GET /api/account-handovers/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

accountHandovers.get('/api/line-accounts/:id/handovers', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = c.req.param('id');
    if (!(await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId]))) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const rows = await listHandoversForAccount(c.env.DB, accountId);
    return c.json({ success: true, data: rows.map(serialize) });
  } catch (err) {
    console.error('GET /api/line-accounts/:id/handovers error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * 段3。事前確認。
 *
 * **合計が合わない結果は受け取らない。** 受け取ると画面がそれを出し、
 * 運用者は「どこかの人が消えた」と読む。
 * **ここでは `friends` に一切書かない**（設計の「ここで止めても、元の
 * アカウントは何も変わりません」）。
 */
accountHandovers.post('/api/account-handovers/:id/preview', requireRole('owner', 'admin'), async (c) => {
  try {
    const handover = await loadAccessible(c.env.DB, c.get('staff'), c.req.param('id'));
    if (!handover) return c.json({ success: false, error: 'Not found' }, 404);
    if (!handover.to_account_id) {
      return c.json({ success: false, error: '受け取り先がまだ決まっていません' }, 422);
    }
    const body = await c.req.json<{
      sourceFriendTotal?: number;
      counts?: Record<string, number>;
    }>();
    const total = body.sourceFriendTotal;
    const counts = body.counts;
    if (typeof total !== 'number' || !counts) {
      return c.json({ success: false, error: 'sourceFriendTotal と counts が要ります' }, 400);
    }
    for (const bucket of MATCH_BUCKETS) {
      if (typeof counts[bucket] !== 'number') {
        return c.json({ success: false, error: `${bucket} の人数が要ります` }, 400);
      }
    }
    const value = {
      auto: counts.auto,
      review: counts.review,
      unmatched: counts.unmatched,
      lookalike: counts.lookalike,
    };
    if (!countsAddUp(value, total)) {
      return c.json(
        { success: false, error: '区分の合計が元の友だち数と合いません' },
        422,
      );
    }
    const saved = await savePreview(c.env.DB, handover.id, {
      sourceFriendTotal: total,
      counts: value,
    });
    if (!saved.ok) return c.json({ success: false, error: saved.error }, 422);
    return c.json({ success: true, data: serialize((await getHandoverById(c.env.DB, handover.id))!) });
  } catch (err) {
    console.error('POST /api/account-handovers/:id/preview error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/** 段4。競合の判断を保存する。 */
accountHandovers.put('/api/account-handovers/:id/decisions', requireRole('owner', 'admin'), async (c) => {
  try {
    const handover = await loadAccessible(c.env.DB, c.get('staff'), c.req.param('id'));
    if (!handover) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{
      decisions?: Array<{
        fromFriendId?: string;
        toFriendId?: string | null;
        decision?: string;
        bucket?: string;
        note?: string | null;
      }>;
    }>();
    const decisions = body.decisions ?? [];
    if (decisions.length === 0) {
      return c.json({ success: false, error: 'decisions が要ります' }, 400);
    }
    const staff = c.get('staff');
    for (const d of decisions) {
      if (!d.fromFriendId) {
        return c.json({ success: false, error: 'fromFriendId が要ります' }, 400);
      }
      if (d.decision !== 'link' && d.decision !== 'new' && d.decision !== 'skip') {
        return c.json({ success: false, error: '決めたことを確認してください' }, 400);
      }
      /*
        **「同じ人として結びつける」のに相手がいない、を通さない。**
        通すと本実行で行き先の無い人ができ、静かに消える。
      */
      if (d.decision === 'link' && !d.toFriendId) {
        return c.json({ success: false, error: '結びつける相手が要ります' }, 422);
      }
      if (!MATCH_BUCKETS.includes(d.bucket as MatchBucket)) {
        return c.json({ success: false, error: '区分を確認してください' }, 400);
      }
      await saveDecision(c.env.DB, {
        handoverId: handover.id,
        fromFriendId: d.fromFriendId,
        toFriendId: d.toFriendId ?? null,
        decision: d.decision,
        bucket: d.bucket as MatchBucket,
        note: d.note ?? null,
        decidedBy: staff?.id ?? null,
      });
    }
    const unresolved = await unresolvedReviewCount(c.env.DB, handover.id);
    if (unresolved !== null && unresolved <= 0) await markResolved(c.env.DB, handover.id);
    return c.json({
      success: true,
      data: {
        ...serialize((await getHandoverById(c.env.DB, handover.id))!),
        unresolvedReviews: await unresolvedReviewCount(c.env.DB, handover.id),
      },
    });
  } catch (err) {
    console.error('PUT /api/account-handovers/:id/decisions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * 段5。本実行。
 *
 * **「要確認」を全部決めるまで通さない。** 決めていない人がいるまま進めると、
 * その人がどちらにも入らずに消える。
 */
accountHandovers.post('/api/account-handovers/:id/execute', requireRole('owner', 'admin'), async (c) => {
  try {
    const handover = await loadAccessible(c.env.DB, c.get('staff'), c.req.param('id'));
    if (!handover) return c.json({ success: false, error: 'Not found' }, 404);
    if (handover.source_friend_total === null) {
      return c.json({ success: false, error: '先に事前確認をしてください' }, 422);
    }
    const unresolved = await unresolvedReviewCount(c.env.DB, handover.id);
    if (unresolved !== null && unresolved > 0) {
      return c.json(
        { success: false, error: `要確認が${unresolved}件のこっています。全部決めてから実行してください` },
        422,
      );
    }
    if (handover.status === 'completed' || handover.status === 'executing') {
      return c.json({ success: false, error: 'その引き継ぎはもう実行されています' }, 409);
    }
    await markExecuting(c.env.DB, handover.id);

    const decisions = await listDecisions(c.env.DB, handover.id);
    const moving = decisions.filter((d) => d.decision === 'link' || d.decision === 'new');
    let moved = 0;
    let failed = 0;
    for (const d of moving) {
      try {
        await c.env.DB.prepare(`UPDATE friends SET line_account_id = ? WHERE id = ?`)
          .bind(handover.to_account_id, d.from_friend_id)
          .run();
        moved += 1;
      } catch (err) {
        console.error('handover move failed:', d.from_friend_id, err);
        failed += 1;
      }
    }
    /*
      照合。**動かした数と、動かすつもりだった数を突き合わせる。**
      合わなければ理由を残す。数だけ返して「終わりました」と言わない。
    */
    const reason =
      failed > 0 ? `${failed}件を移せませんでした` : moved === moving.length ? null : '数が合いません';
    await completeHandover(c.env.DB, handover.id, {
      movedCount: moved,
      failedCount: failed,
      failureReason: reason,
    });
    return c.json({
      success: true,
      data: {
        ...serialize((await getHandoverById(c.env.DB, handover.id))!),
        plannedCount: moving.length,
      },
    });
  } catch (err) {
    console.error('POST /api/account-handovers/:id/execute error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

accountHandovers.post('/api/account-handovers/:id/cancel', requireRole('owner', 'admin'), async (c) => {
  try {
    const handover = await loadAccessible(c.env.DB, c.get('staff'), c.req.param('id'));
    if (!handover) return c.json({ success: false, error: 'Not found' }, 404);
    if (handover.status === 'completed') {
      return c.json({ success: false, error: '終わった引き継ぎはやめられません' }, 409);
    }
    await cancelHandover(c.env.DB, handover.id);
    return c.json({ success: true, data: serialize((await getHandoverById(c.env.DB, handover.id))!) });
  } catch (err) {
    console.error('POST /api/account-handovers/:id/cancel error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { accountHandovers };
