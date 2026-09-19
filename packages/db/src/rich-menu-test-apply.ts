import { jstNow } from './utils.js';

// =============================================================================
// N-152: 本人LINEへのテスト適用の台帳
// =============================================================================
//
// 「誰が・どのLINEへ・適用前に何が出ていたか・何を出したか」を記録する。
// 適用前のメニューが残っていないと「元に戻す」が冪等にできない。
//
// 状態遷移:
//   running  → 作業中（台帳だけ先に立てて、LINE操作の途中で止まっても再開できる）
//   applied  → 本人へテストメニューが出ている
//   reverting→ 戻し作業中
//   reverted → 元のメニューへ戻した（または戻す必要がなかった）
//   failed   → 途中失敗。同じ鍵の再試行で続きからやり直す
//
// (account_id, idempotency_key) の UNIQUE が二重押し・再送を1件に畳む。

export interface RichMenuTestApply {
  id: string;
  group_id: string;
  account_id: string;
  staff_id: string;
  line_user_id: string;
  previous_richmenu_id: string | null;
  previous_captured: number;
  applied_richmenu_id: string | null;
  /** 下書きテストで LINE 上に作ったメニューIDの JSON 配列。 */
  test_shell_ids: string | null;
  status: 'running' | 'applied' | 'reverting' | 'reverted' | 'failed';
  last_error_code: string | null;
  idempotency_key: string;
  revert_idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export type RichMenuTestApplyOutcome =
  | { outcome: 'created'; apply: RichMenuTestApply }
  | { outcome: 'existing'; apply: RichMenuTestApply }
  | { outcome: 'conflict' };

export async function getRichMenuTestApplyByKey(
  db: D1Database,
  accountId: string,
  idempotencyKey: string,
): Promise<RichMenuTestApply | null> {
  return (await db
    .prepare(
      `SELECT * FROM rich_menu_test_applies
        WHERE account_id = ? AND idempotency_key = ?`,
    )
    .bind(accountId, idempotencyKey)
    .first<RichMenuTestApply>()) ?? null;
}

export async function getRichMenuTestApplyById(
  db: D1Database,
  id: string,
): Promise<RichMenuTestApply | null> {
  return (await db
    .prepare(`SELECT * FROM rich_menu_test_applies WHERE id = ?`)
    .bind(id)
    .first<RichMenuTestApply>()) ?? null;
}

/**
 * この担当者がこのメニューに対して今適用中のテスト。1人1件まで。
 * 適用中があれば新たな適用は 409 で止める（戻してから出直す）。
 */
export async function getActiveRichMenuTestApply(
  db: D1Database,
  groupId: string,
  staffId: string,
): Promise<RichMenuTestApply | null> {
  return (await db
    .prepare(
      `SELECT * FROM rich_menu_test_applies
        WHERE group_id = ? AND staff_id = ?
          AND status IN ('running','applied','reverting')
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .bind(groupId, staffId)
    .first<RichMenuTestApply>()) ?? null;
}

export async function listRichMenuTestApplies(
  db: D1Database,
  groupId: string,
  limit = 20,
): Promise<RichMenuTestApply[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM rich_menu_test_applies
        WHERE group_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(groupId, limit)
    .all<RichMenuTestApply>();
  return rows.results ?? [];
}

/**
 * 台帳を先に立てる。同じ鍵なら既存行を返し、別groupへの鍵違いは conflict。
 * 作成は失敗しない形で呼ぶ（アカウント・グループ・担当者の確認は呼び出し側）。
 */
export async function createRichMenuTestApplyAtomic(
  db: D1Database,
  input: {
    id: string;
    groupId: string;
    accountId: string;
    staffId: string;
    lineUserId: string;
    idempotencyKey: string;
    now?: string;
  },
): Promise<RichMenuTestApplyOutcome> {
  const existing = await getRichMenuTestApplyByKey(db, input.accountId, input.idempotencyKey);
  if (existing) {
    return existing.group_id === input.groupId
      ? { outcome: 'existing', apply: existing }
      : { outcome: 'conflict' };
  }
  const now = input.now ?? jstNow();
  try {
    await db
      .prepare(
        `INSERT INTO rich_menu_test_applies
           (id, group_id, account_id, staff_id, line_user_id, status,
            idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      )
      .bind(input.id, input.groupId, input.accountId, input.staffId, input.lineUserId, input.idempotencyKey, now, now)
      .run();
  } catch (error) {
    const raced = await getRichMenuTestApplyByKey(db, input.accountId, input.idempotencyKey);
    if (raced) {
      return raced.group_id === input.groupId
        ? { outcome: 'existing', apply: raced }
        : { outcome: 'conflict' };
    }
    throw error;
  }
  const created = await getRichMenuTestApplyById(db, input.id);
  if (!created) throw new Error('failed to read back test apply');
  return { outcome: 'created', apply: created };
}

/** 適用前にその人へ出ていたメニューを一度だけ記録する（再開時に読み直さない）。 */
export async function captureRichMenuTestApplyPrevious(
  db: D1Database,
  id: string,
  previousRichMenuId: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_test_applies
          SET previous_richmenu_id = ?, previous_captured = 1, updated_at = ?
        WHERE id = ?`,
    )
    .bind(previousRichMenuId, jstNow(), id)
    .run();
}

/** 下書きテストで作ったLINEメニューIDを記録する。 */
export async function recordRichMenuTestApplyShells(
  db: D1Database,
  id: string,
  shellIds: string[],
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_test_applies
          SET test_shell_ids = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(JSON.stringify(shellIds), jstNow(), id)
    .run();
}

export async function markRichMenuTestApplyApplied(
  db: D1Database,
  id: string,
  appliedRichMenuId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_test_applies
          SET status = 'applied', applied_richmenu_id = ?, last_error_code = NULL, updated_at = ?
        WHERE id = ?`,
    )
    .bind(appliedRichMenuId, jstNow(), id)
    .run();
}

export async function markRichMenuTestApplyFailed(
  db: D1Database,
  id: string,
  lastErrorCode: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_test_applies
          SET status = 'failed', last_error_code = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(lastErrorCode.slice(0, 300), jstNow(), id)
    .run();
}

/**
 * 戻しの開始。適用中の行だけを 'reverting' へ進める。
 * 同じ revert 鍵のやり直しは既に revert 済みの行をそのまま返す。
 * 戻り値: 'claimed'（これから戻す）/ 'already'（戻し済み）/ 'conflict'（進行中）/ 'missing'
 */
export async function beginRichMenuTestApplyRevert(
  db: D1Database,
  applyId: string,
  revertIdempotencyKey: string,
): Promise<'claimed' | 'already' | 'conflict' | 'missing'> {
  const current = await getRichMenuTestApplyById(db, applyId);
  if (!current) return 'missing';
  if (current.status === 'reverted') return 'already';
  if (current.status === 'reverting') {
    return current.revert_idempotency_key === revertIdempotencyKey ? 'claimed' : 'conflict';
  }
  if (current.status !== 'applied' && current.status !== 'failed') return 'conflict';
  const result = await db
    .prepare(
      `UPDATE rich_menu_test_applies
          SET status = 'reverting', revert_idempotency_key = ?, updated_at = ?
        WHERE id = ? AND status IN ('applied','failed')`,
    )
    .bind(revertIdempotencyKey, jstNow(), applyId)
    .run();
  return (result.meta?.changes ?? 0) > 0 ? 'claimed' : 'conflict';
}

export async function markRichMenuTestApplyReverted(
  db: D1Database,
  applyId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_test_applies
          SET status = 'reverted', last_error_code = NULL, updated_at = ?
        WHERE id = ?`,
    )
    .bind(jstNow(), applyId)
    .run();
}

/** 戻し途中の失敗。再試行できるよう 'applied' へ戻す（戻せていないので）。 */
export async function markRichMenuTestApplyRevertFailed(
  db: D1Database,
  applyId: string,
  lastErrorCode: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_test_applies
          SET status = 'applied', last_error_code = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(lastErrorCode.slice(0, 300), jstNow(), applyId)
    .run();
}
