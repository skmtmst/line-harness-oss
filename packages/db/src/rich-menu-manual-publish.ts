import { jstNow } from './utils.js';

export type RichMenuManualPublishRequest = {
  id: string;
  group_id: string;
  account_id: string;
  definition_snapshot: string;
  request_fingerprint: string;
  idempotency_key: string;
  status: 'running' | 'succeeded' | 'failed';
  result_json: string | null;
  last_error_code: string | null;
  execution_token: string | null;
  requested_by_staff_id: string;
  created_at: string;
  updated_at: string;
};

export type RichMenuManualPublishShell = {
  request_id: string;
  page_id: string;
  order_index: number;
  new_richmenu_id: string;
  old_richmenu_id: string | null;
  created_at: string;
};

export type CreateRichMenuManualPublishRequestInput = {
  id: string;
  groupId: string;
  accountId: string;
  definitionSnapshot: string;
  requestFingerprint: string;
  idempotencyKey: string;
  requestedByStaffId: string;
  now: string;
};

export type CreateRichMenuManualPublishRequestResult =
  | { outcome: 'created'; request: RichMenuManualPublishRequest }
  | { outcome: 'existing'; request: RichMenuManualPublishRequest }
  | { outcome: 'conflict'; request: RichMenuManualPublishRequest };

/**
 * 同じ account + key は必ず1件にする。fingerprint は公開済みLINE IDなどの実行結果を
 * 含めないため、成功後の同じ押し直しも元の応答を再生できる。
 */
export async function createRichMenuManualPublishRequestAtomic(
  db: D1Database,
  input: CreateRichMenuManualPublishRequestInput,
): Promise<CreateRichMenuManualPublishRequestResult> {
  const inserted = await db.prepare(
    `INSERT INTO rich_menu_manual_publish_requests
       (id, group_id, account_id, definition_snapshot, request_fingerprint, idempotency_key,
        status, requested_by_staff_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
     ON CONFLICT(account_id, idempotency_key) DO NOTHING`,
  ).bind(
    input.id, input.groupId, input.accountId, input.definitionSnapshot,
    input.requestFingerprint, input.idempotencyKey, input.requestedByStaffId, input.now, input.now,
  ).run();

  if ((inserted.meta?.changes ?? 0) > 0) {
    const request = await getRichMenuManualPublishRequest(db, input.accountId, input.idempotencyKey);
    if (!request) throw new Error('manual publish request insert race: row not found');
    return { outcome: 'created', request };
  }

  const request = await getRichMenuManualPublishRequest(db, input.accountId, input.idempotencyKey);
  if (!request) throw new Error('manual publish request conflict race: row not found');
  if (request.group_id !== input.groupId || request.request_fingerprint !== input.requestFingerprint) {
    return { outcome: 'conflict', request };
  }
  return { outcome: 'existing', request };
}

export async function getRichMenuManualPublishRequest(
  db: D1Database,
  accountId: string,
  idempotencyKey: string,
): Promise<RichMenuManualPublishRequest | null> {
  return db.prepare(
    `SELECT * FROM rich_menu_manual_publish_requests
      WHERE account_id = ? AND idempotency_key = ?`,
  ).bind(accountId, idempotencyKey).first<RichMenuManualPublishRequest>();
}

export async function getRichMenuManualPublishShells(
  db: D1Database,
  requestId: string,
): Promise<RichMenuManualPublishShell[]> {
  const result = await db.prepare(
    `SELECT request_id, page_id, order_index, new_richmenu_id, old_richmenu_id, created_at
       FROM rich_menu_manual_publish_shells
      WHERE request_id = ? ORDER BY order_index ASC`,
  ).bind(requestId).all<RichMenuManualPublishShell>();
  return result.results ?? [];
}

export async function recordRichMenuManualPublishShells(
  db: D1Database,
  requestId: string,
  shells: Array<{ pageId: string; orderIndex: number; newRichMenuId: string; oldRichMenuId: string | null }>,
  now: string = jstNow(),
): Promise<void> {
  if (shells.length === 0) throw new Error('manual publish shell journal cannot be empty');
  await db.batch(shells.map((shell) => db.prepare(
    `INSERT INTO rich_menu_manual_publish_shells
       (request_id, page_id, order_index, new_richmenu_id, old_richmenu_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(request_id, page_id) DO NOTHING`,
  ).bind(requestId, shell.pageId, shell.orderIndex, shell.newRichMenuId, shell.oldRichMenuId, now)));
}

export async function markRichMenuManualPublishSucceeded(
  db: D1Database,
  requestId: string,
  executionToken: string,
  resultJson: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE rich_menu_manual_publish_requests
        SET status = 'succeeded', result_json = ?, last_error_code = NULL, updated_at = ?
      WHERE id = ? AND status = 'running' AND execution_token = ?`,
  ).bind(resultJson, jstNow(), requestId, executionToken).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function markRichMenuManualPublishFailed(
  db: D1Database,
  requestId: string,
  executionToken: string,
  errorCode: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE rich_menu_manual_publish_requests
        SET status = 'failed', last_error_code = ?, updated_at = ?
      WHERE id = ? AND status = 'running' AND execution_token = ?`,
  ).bind(errorCode.slice(0, 240), jstNow(), requestId, executionToken).run();
  return (result.meta?.changes ?? 0) > 0;
}

/** lease取得後に実行世代を確定する。古い世代は成功・失敗を更新できない。 */
export async function claimRichMenuManualPublishRequest(
  db: D1Database,
  requestId: string,
  executionToken: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE rich_menu_manual_publish_requests
        SET execution_token = ?, updated_at = ?
      WHERE id = ? AND status = 'running'`,
  ).bind(executionToken, jstNow(), requestId).run();
  return (result.meta?.changes ?? 0) > 0;
}

/** 失敗リトライの開始を記録する。成功済み行をrunningへ戻さない。 */
export async function restartRichMenuManualPublishRequest(
  db: D1Database,
  requestId: string,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE rich_menu_manual_publish_requests
        SET status = 'running', last_error_code = NULL, execution_token = NULL, updated_at = ?
      WHERE id = ? AND status = 'failed'`,
  ).bind(jstNow(), requestId).run();
  return (result.meta?.changes ?? 0) > 0;
}
