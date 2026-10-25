import type { Message } from '@line-crm/line-sdk';
/** buildMessage 後の内容から種別と本文を取り、空ノード除去や解析失敗のテキスト代替も含め、履歴を実際の LINE 送信と一致させる。 */
export function messageToLogPayload(message: Message): { messageType: string; content: string } {
  if (message.type === 'text') return { messageType: 'text', content: message.text };
  if (message.type === 'flex') return { messageType: 'flex', content: JSON.stringify(message.contents) };
  if (message.type === 'image') {
    return {
      messageType: 'image',
      content: JSON.stringify({
        originalContentUrl: message.originalContentUrl,
        previewImageUrl: message.previewImageUrl,
      }),
    };
  }
  return { messageType: message.type, content: JSON.stringify(message) };
}
