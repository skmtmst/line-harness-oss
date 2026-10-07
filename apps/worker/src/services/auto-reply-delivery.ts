import { pushViaHarnessProxy } from './line-proxy-send.js';
import { dispatchLineProxyLocally } from './local-line-proxy.js';
import { deterministicLogId } from '../routes/line-proxy.js';
import { LineClient, type Message } from '@line-crm/line-sdk';
import {
  getFriendById,
  getLineAccountById,
  isOperationCapabilityStopped,
  markAutoReplyEvaluationFinished,
  recordAutoReplyHit,
  parseAutoReplyVersionSettings,
  getAutoReplyVersionById,
  resolveLineCredential,
  isAccountFeatureEnabled,
  activeTenantLineAccountSql,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { getSendPermissionForAccount } from './send-entitlements.js';
import { logOutgoingMessage } from './event-bus.js';
import { messageToLogPayload } from './step-delivery.js';

/** 遅延返信は期限切れのreplyTokenを使わずpushで届ける。Cronの5分刻みで回収。 */
export async function processAutoReplyDeliveries(
  env: Env['Bindings'],
  now = new Date(),
  clientForAccount?: (accountId: string | null) => Promise<LineClient>,
): Promise<number> {
  const db = env.DB;
  const due = await db
    .prepare(
      "SELECT * FROM auto_reply_deliveries WHERE status = 'pending' AND due_at <= ? ORDER BY due_at,id LIMIT 50",
    )
    .bind(now.toISOString())
    .all<{
      id: string;
      evaluation_id: string;
      friend_id: string;
      line_account_id: string | null;
      version_id: string;
      message_json: string;
      action_summary: string;
    }>();
  let count = 0;
  for (const row of due.results) {
    const claim = await db
      .prepare(
        "UPDATE auto_reply_deliveries SET status = 'claimed' WHERE id = ? AND status = 'pending'",
      )
      .bind(row.id)
      .run();
    if (Number(claim.meta.changes) !== 1) continue;
    const finish = async (status: string, error: string | null) => {
      await db
        .prepare(
          'UPDATE auto_reply_deliveries SET status = ?,error_code = ?,completed_at = ? WHERE id = ?',
        )
        .bind(status, error, now.toISOString(), row.id)
        .run();
    };
    try {
      const friend = await getFriendById(db, row.friend_id);
      const version = await getAutoReplyVersionById(db, row.version_id);
      const live = version
        ? await db
            .prepare(
              'SELECT is_active,deleted_at FROM auto_replies WHERE id = ?',
            )
            .bind(version.auto_reply_id)
            .first<{ is_active: number; deleted_at: string | null }>()
        : null;
      const permission = await getSendPermissionForAccount(
        db,
        row.line_account_id,
      );
      if (
        !friend ||
        !friend.is_following ||
        friend.line_account_id !== row.line_account_id ||
        !version ||
        !live?.is_active ||
        live.deleted_at ||
        !permission.allowed ||
        (row.line_account_id &&
          (!(await isAccountFeatureEnabled(
            db,
            row.line_account_id,
            'auto_replies',
          )) ||
            !(await db
              .prepare(
                `SELECT id FROM line_accounts la WHERE la.id=? AND la.is_active=1 AND la.archived_at IS NULL AND ${activeTenantLineAccountSql('la.id')}`,
              )
              .bind(row.line_account_id)
              .first()))) ||
        (await isOperationCapabilityStopped(
          db,
          row.line_account_id,
          'auto_reply_dispatch',
        ))
      ) {
        await finish('skipped', 'delivery_not_allowed');
        await markAutoReplyEvaluationFinished(db, {
          evaluationId: row.evaluation_id,
          actionSummary: JSON.parse(row.action_summary),
          status: 'partial_failed',
          replyStatus: 'not_attempted',
          errorCode: 'delivery_not_allowed',
        });
        continue;
      }
      const account = row.line_account_id
        ? await getLineAccountById(db, row.line_account_id)
        : null;
      const token = account
        ? await resolveLineCredential(
            account.channel_access_token_encrypted,
            account.channel_access_token,
            { lineAccountId: account.id, field: 'channel_access_token' },
            env.LINE_CREDENTIAL_ENCRYPTION_KEY,
          )
        : env.LINE_CHANNEL_ACCESS_TOKEN;
      if (!clientForAccount && !token)
        throw new Error('line_account_unavailable');
      const message = JSON.parse(row.message_json) as Message;
      const response = clientForAccount
        ? await (
            await clientForAccount(row.line_account_id)
          ).pushMessageWithRequestId(friend.line_user_id, [message], row.id)
        : await pushViaHarnessProxy(
            env.WORKER_PUBLIC_URL || env.WORKER_URL || 'https://worker.invalid',
            token!,
            friend.line_user_id,
            [message],
            row.id,
            (request) => dispatchLineProxyLocally(request, env),
            'auto_reply_dispatch',
          );
      // 送信成功を先に固定。ログ失敗で送り直さない。
      await finish('accepted', null);
      const payload = messageToLogPayload(message);
      const logId = clientForAccount
        ? await logOutgoingMessage(db, {
            friendId: friend.id,
            messageType: payload.messageType,
            content: payload.content,
            deliveryType: 'push',
            source: 'auto_reply',
            lineAccountId: row.line_account_id,
          })
        : await deterministicLogId(`line-proxy-send:${row.id}:${friend.id}:0`);
      if (!clientForAccount)
        await db
          .prepare(
            "UPDATE messages_log SET source='auto_reply' WHERE id=? AND friend_id=?",
          )
          .bind(logId, friend.id)
          .run();
      await markAutoReplyEvaluationFinished(db, {
        evaluationId: row.evaluation_id,
        actionSummary: JSON.parse(row.action_summary),
        status:
          JSON.parse(row.action_summary).failed > 0
            ? 'partial_failed'
            : 'completed',
        replyStatus: 'accepted',
        lineRequestId: response.requestId,
        messageLogId: logId,
      });
      const settings = parseAutoReplyVersionSettings(version);
      await recordAutoReplyHit(db, {
        autoReplyId: version.auto_reply_id,
        friendId: friend.id,
        lineAccountId: row.line_account_id,
        matchedKeyword: settings.keyword,
      });
      count++;
    } catch {
      // 結果不明も自動再送しない。accepted の記録は戻さない。
      const state = await db
        .prepare('SELECT status FROM auto_reply_deliveries WHERE id = ?')
        .bind(row.id)
        .first<{ status: string }>();
      if (state?.status === 'accepted') continue;
      await finish('failed', 'delayed_reply_failed');
      await markAutoReplyEvaluationFinished(db, {
        evaluationId: row.evaluation_id,
        actionSummary: JSON.parse(row.action_summary),
        status: 'reply_failed',
        replyStatus: 'failed',
        errorCode: 'delayed_reply_failed',
      });
    }
  }
  return count;
}
