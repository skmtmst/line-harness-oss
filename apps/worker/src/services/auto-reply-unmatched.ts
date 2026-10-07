import type { LineClient } from '@line-crm/line-sdk';
import { markAutoReplyEvaluationFinished } from '@line-crm/db';
import { expandSendCommonVars } from './interpolation-context.js';
import { logOutgoingMessage } from './event-bus.js';
/** 呼出し側で課金・機能停止と評価の二重実行を検査済み。メールからは呼ばない。 */
export async function replyToUnmatchedLine(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId: string;
    evaluationId: string;
    replyToken: string;
    client: LineClient;
  },
): Promise<{ matched: boolean; replyTokenConsumed: boolean } | null> {
  const settings = await db
    .prepare(
      'SELECT message FROM auto_reply_unmatched_settings WHERE line_account_id=?',
    )
    .bind(input.lineAccountId)
    .first<{ message: string | null }>();
  if (!settings?.message) return null;
  let accepted = false;
  try {
    const text = await expandSendCommonVars(
      db,
      settings.message,
      { kind: 'auto_reply', id: input.evaluationId },
      { lineAccountId: input.lineAccountId, friendId: input.friendId },
    );
    if (Array.from(text).length > 5000) throw new Error('reply_too_long');
    const response = await input.client.replyMessageWithRequestId(
      input.replyToken,
      [{ type: 'text', text }],
    );
    accepted = true;
    // 先に受理を固定。履歴の保存失敗が二重返信につながらないようにする。
    await markAutoReplyEvaluationFinished(db, {
      evaluationId: input.evaluationId,
      status: 'completed',
      replyStatus: 'accepted',
      lineRequestId: response.requestId,
      actionSummary: { executed: 0, failed: 0 },
    });
    const log = await logOutgoingMessage(db, {
      friendId: input.friendId,
      messageType: 'text',
      content: text,
      deliveryType: 'reply',
      source: 'auto_reply',
      lineAccountId: input.lineAccountId,
    });
    await markAutoReplyEvaluationFinished(db, {
      evaluationId: input.evaluationId,
      status: 'completed',
      replyStatus: 'accepted',
      lineRequestId: response.requestId,
      messageLogId: log,
      actionSummary: { executed: 0, failed: 0 },
    });
  } catch {
    if (!accepted)
      await markAutoReplyEvaluationFinished(db, {
        evaluationId: input.evaluationId,
        status: 'reply_failed',
        replyStatus: 'failed',
        errorCode: 'unmatched_reply_failed',
        actionSummary: { executed: 0, failed: 0 },
      });
  }
  return { matched: true, replyTokenConsumed: accepted };
}
