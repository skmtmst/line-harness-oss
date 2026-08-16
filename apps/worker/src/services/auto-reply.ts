import type { LineClient } from '@line-crm/line-sdk';
import { getTemplateById } from '@line-crm/db';
import type { AutoReply, Friend } from '@line-crm/db';
import { logOutgoingMessage } from './event-bus.js';
import { shouldReply } from './auto-reply-conditions.js';
import { resolveInterpolationExtra } from './interpolation-context.js';
import {
  buildMessage,
  expandVariables,
  messageToLogPayload,
  resolveMetadata,
} from './step-delivery.js';

/**
 * exact/contains のキーワードマッチ述語。webhook のテキスト/postback 経路と
 * unanswered-inbox の「構造化メッセ除外」判定が同じルール解釈を共有する。
 * 未知の match_type はマッチなし扱い (誤マッチで inbox から隠すより安全側)。
 */
export function keywordMatches(
  rule: { keyword: string; match_type: string },
  text: string,
): boolean {
  if (rule.match_type === 'exact') return text === rule.keyword;
  if (rule.match_type === 'contains') return text.includes(rule.keyword);
  return false;
}

/**
 * 対象のメッセージ種別か。
 *
 * message_kinds_json が無ければ何でも対象。壊れていても対象にする。
 * 設定が読めないからといって返さない、では自動応答が黙って消える。
 */
export function matchesMessageKind(
  rule: { message_kinds_json?: string | null },
  kind = 'text',
): boolean {
  if (!rule.message_kinds_json) return true;
  try {
    const kinds = JSON.parse(rule.message_kinds_json) as unknown;
    if (!Array.isArray(kinds) || kinds.length === 0) return true;
    return kinds.includes(kind);
  } catch {
    return true;
  }
}

/**
 * auto_reply 行の content/type を resolve する。template_id が set なら templates
 * から取得、参照切れや NULL のときは inline response_content/response_type を使う。
 */
async function resolveAutoReplyContent(
  db: D1Database,
  rule: Pick<AutoReply, 'template_id' | 'response_type' | 'response_content'>,
): Promise<{ messageType: string; content: string }> {
  if (rule.template_id) {
    const tpl = await getTemplateById(db, rule.template_id);
    if (tpl) {
      return { messageType: tpl.message_type, content: tpl.message_content };
    }
  }
  return { messageType: rule.response_type, content: rule.response_content };
}

export interface MatchAndReplyResult {
  matched: boolean;
  replyTokenConsumed: boolean;
}

/**
 * incomingText を auto_replies (このアカウントのルール + グローバルルール) に
 * マッチさせ、最初にマッチしたルールで replyMessage を送って messages_log に
 * outgoing を記録する。webhook のテキストメッセージ経路と postback 経路の共通部。
 *
 * - silent タイプ: 返信せず matched=true だけ返す。テキスト経路では unread /
 *   push の抑止、postback 経路では「返信なしでタグだけ付ける」構成に使う。
 * - reply 失敗時も matched=true のまま (replyTokenConsumed=false)。呼び出し側は
 *   replyTokenConsumed=false のとき replyToken をイベントバスへ引き継げる。
 *
 * NOTE: auto-reply は replyMessage (無料・push 枠を消費しない) を使う。
 * replyToken の有効期限はイベントから約1分。
 */
export async function matchAndReply(
  db: D1Database,
  lineClient: LineClient,
  friend: Friend,
  incomingText: string,
  replyToken: string,
  opts: {
    lineAccountId?: string | null;
    workerUrl?: string;
    logContext?: string;
    /** 受け取ったメッセージの種別。省略時は text として扱う */
    messageKind?: string;
  } = {},
): Promise<MatchAndReplyResult> {
  const { lineAccountId = null, workerUrl, logContext } = opts;

  // グローバルルール (line_account_id IS NULL) + このアカウントのルール。
  // lineAccountId が null のときは `= NULL` が偽になるのでグローバルのみ残る。
  // 上から順に評価して、最初に当てはまった1件だけを動かす。
  // 並び順は priority が先で、同じなら作った順。一覧の並びと評価順を
  // 一致させないと、「上にあるのに動かない」という形で食い違う。
  const autoReplies = await db
    .prepare(
      `SELECT * FROM auto_replies WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?)
        ORDER BY priority ASC, created_at ASC`,
    )
    .bind(lineAccountId)
    .all<AutoReply>();

  // キーワードが合っても、時間帯・連投抑制・有人対応で返さないことがある。
  // 合ったものを1件だけ見るのではなく、条件まで通る最初の1件を探す。
  // 「営業時間内はAで返し、時間外はBで返す」を2行で書けるようにするため。
  const now = new Date();
  let rule: AutoReply | undefined;
  for (const candidate of autoReplies.results) {
    if (!matchesMessageKind(candidate, opts.messageKind)) continue;
    if (!keywordMatches(candidate, incomingText)) continue;
    if (await shouldReply(db, candidate, friend.id, now)) {
      rule = candidate;
      break;
    }
  }
  if (!rule) return { matched: false, replyTokenConsumed: false };
  if (rule.response_type === 'silent') return { matched: true, replyTokenConsumed: false };

  let replyTokenConsumed = false;
  try {
    const resolvedMeta = await resolveMetadata(db, friend);
    const resolved = await resolveAutoReplyContent(db, rule);
    const extra = await resolveInterpolationExtra(db, friend.id, resolved.content);
    const expandedContent = expandVariables(
      resolved.content,
      { ...friend, metadata: resolvedMeta },
      workerUrl,
      resolved.messageType,
      extra,
    );
    const replyMsg = buildMessage(resolved.messageType, expandedContent);
    await lineClient.replyMessage(replyToken, [replyMsg]);
    replyTokenConsumed = true;

    // 送信ログ（replyMessage = 無料）— derive content from the built reply
    // message so any cleanEmptyNodes / parse-failure fallback is reflected
    // in the dashboard.
    const replyPayload = messageToLogPayload(replyMsg);
    await logOutgoingMessage(db, {
      friendId: friend.id,
      messageType: replyPayload.messageType,
      content: replyPayload.content,
      deliveryType: 'reply',
      source: 'auto_reply',
      lineAccountId,
    });
  } catch (err) {
    console.error(`Failed to send auto-reply${logContext ? ` (${logContext})` : ''}`, err);
  }

  return { matched: true, replyTokenConsumed };
}
