import type { MessageTemplate } from '@line-crm/db';

/** SDK 全体と結合しないよう、push に必要な LINE メッセージの部分型だけを定義する。 */
export type IntroMessage =
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: unknown };

/** テンプレート未設定でもフォームを開けるよう、既定の Flex を使う。 */
export function DEFAULT_FORM_LINK_FLEX(formUrl: string): IntroMessage {
  return {
    type: 'flex',
    altText: '🎁 特典を受け取る',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#0d1117',
        paddingAll: '20px',
        contents: [
          { type: 'text', text: '🎁', size: '3xl', align: 'center' },
          {
            type: 'text',
            text: '特典をお届けします！',
            weight: 'bold',
            size: 'lg',
            color: '#ffffff',
            align: 'center',
            margin: 'md',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        contents: [
          {
            type: 'text',
            text: '下のボタンから特典を\n受け取ってください',
            size: 'sm',
            color: '#666666',
            align: 'center',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: '特典を受け取る', uri: formUrl },
            style: 'primary',
            color: '#06C755',
            height: 'md',
          },
        ],
      },
    },
  };
}

/** キャンペーンの案内文は {formUrl} を実際の LIFF URL へ置換する。JSON 解析前なので任意の文字列項目で使え、未設定なら既定 Flex に戻す。 */
export function buildIntroMessage(
  template: MessageTemplate | null,
  formUrl: string,
): IntroMessage {
  if (!template) return DEFAULT_FORM_LINK_FLEX(formUrl);

  // formUrl を含まないテンプレートで行き止まりにしないよう、開けるボタンがある既定 Flex へ戻す。
  if (!template.message_content.includes('{formUrl}')) {
    return DEFAULT_FORM_LINK_FLEX(formUrl);
  }

  const replaced = template.message_content.replaceAll('{formUrl}', formUrl);

  if (template.message_type === 'text') {
    return { type: 'text', text: replaced };
  }

  // 保存済み JSON が壊れていても無言で送信失敗しないよう、フォームを開ける既定 Flex へ戻す。
  try {
    return {
      type: 'flex',
      altText: template.name,
      contents: JSON.parse(replaced),
    };
  } catch {
    return DEFAULT_FORM_LINK_FLEX(formUrl);
  }
}
