import { listInterpolations } from '@line-crm/shared';
import {
  renderBroadcastMessageContent,
  type BroadcastRenderContext,
} from './render-message.js';
import { resolveInterpolationExtra } from './interpolation-context.js';

/*
 * N-026: 1対1トーク(手動返信・送信予約・プレビュー)の差し込み解決。
 *
 * 受信箱ではテンプレートの `{{name}}` がそのままLINEへ届いていた。
 * 一斉配信と同じ解決器 `renderBroadcastMessageContent` を使い、
 * 解決しきれなかった `{{…}}` は送信側が構造化して拒否する
 * (LINE呼出0・messages_log書込0)。
 *
 * 解決しない型(image等のJSON)には差し込みを展開しない。JSON本文を
 * 文字列置換すると値に `"` が混ざったときJSONが壊れるため、残った
 * `{{…}}` は未解決として拒否側に回す。
 */

const RENDERABLE_TYPES = new Set(['text', 'flex']);

export interface ChatRenderTarget {
  id: string;
  display_name: string | null;
  line_account_id: string | null;
}

export interface ChatRenderResult {
  /** 解決後の本文。unresolved が空でも送ってよい本文。 */
  content: string;
  /** 解決できなかった差し込み名(重複なし)。空なら全部解決済み。 */
  unresolved: string[];
}

export async function renderChatMessageContent(
  db: D1Database,
  friend: ChatRenderTarget,
  messageType: string,
  content: string,
  liffId?: string | null,
): Promise<ChatRenderResult> {
  // 差し込みを含まない本文は読み取りクエリを増やさずそのまま返す。
  if (!content.includes('{{')) {
    return { content, unresolved: [] };
  }

  const context: BroadcastRenderContext = {
    displayName: friend.display_name,
    deliveredAt: new Date(),
  };
  // liff_id は account 参照が必要なので、本文で使うときだけ呼び出し側から受け取る。
  if (liffId !== undefined) context.liffId = liffId;
  const extra = await resolveInterpolationExtra(db, friend.id, content);
  context.fields = extra.fields;
  context.vars = extra.vars;

  let rendered = content;
  if (RENDERABLE_TYPES.has(messageType)) {
    try {
      rendered = renderBroadcastMessageContent(messageType, content, context);
    } catch {
      // flex の壊れたJSONは route 側の既存400に任せる。ここで握ると
      // 未解決差し込みの拒否(400)より先に500が出るので変えない。
      rendered = content;
    }
  }
  return { content: rendered, unresolved: listInterpolations(rendered) };
}

/** 拒否時に返す構造化応答。route と dispatcher で文言を揃える。 */
export function unresolvedVariablesPayload(unresolved: string[]): {
  error: string;
  code: 'UNRESOLVED_TEMPLATE_VARIABLES';
  data: { variables: string[] };
} {
  return {
    error: `差し込みを解決できません: ${unresolved.map((v) => `{{${v}}}`).join(', ')}`,
    code: 'UNRESOLVED_TEMPLATE_VARIABLES',
    data: { variables: unresolved },
  };
}
