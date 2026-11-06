import type { MessageTemplate } from '@line-crm/db';

/** SDK 全体と結合しないよう、push に必要な部分型だけを定義する。 */
export type RewardMessage =
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: unknown };

/** 条件を満たしたフォーム回答へ、キャンペーンの報酬テンプレートを使う。未設定なら null を返しフォームの既定メッセージへ戻す。displayName は本人の表示名へ置き換える。 */
export function buildRewardMessage(
  template: MessageTemplate | null,
  friendDisplayName: string | null,
): RewardMessage | null {
  if (!template) return null;

  const safeDisplay = friendDisplayName ?? '';

  if (template.message_type === 'text') {
    // 通常のテキストでは、値をそのまま置換できる。
    return {
      type: 'text',
      text: template.message_content.replaceAll('{displayName}', safeDisplay),
    };
  }

  // 表示名の引用符・バックスラッシュ・改行で Flex を壊さないよう、JSON の文字列としてエスケープしてから差し込む。
  const jsonEscaped = JSON.stringify(safeDisplay).slice(1, -1);
  const replaced = template.message_content.replaceAll('{displayName}', jsonEscaped);
  try {
    return {
      type: 'flex',
      altText: template.name,
      contents: JSON.parse(replaced),
    };
  } catch {
    return null;
  }
}
