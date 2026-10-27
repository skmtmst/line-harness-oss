import type { ChatListItem } from '@/lib/api'

/**
 * 一覧の 1 行に出す最後のメッセージ。画像・スタンプなどは文字で見せても意味が薄いので種類の言葉にする
 * （絵文字は付けない）。PC の受信箱と電話の画面で同じ言葉にする。
 */
export function chatListPreview(chat: Pick<ChatListItem, 'lastMessageType' | 'lastMessageContent'>): string {
  if (chat.lastMessageType === 'image') return '画像'
  if (chat.lastMessageType === 'flex') return 'Flexメッセージ'
  if (chat.lastMessageType === 'sticker') return 'スタンプ'
  if (chat.lastMessageType === 'video') return '動画'
  if (chat.lastMessageType === 'audio') return '音声'
  if (chat.lastMessageType === 'file') return 'ファイル'
  if (chat.lastMessageType === 'location') return '位置情報'
  if (chat.lastMessageType === 'unsent') return '送信を取り消しました'
  return (chat.lastMessageContent ?? '').replace(/\n+/g, ' ').slice(0, 60)
}
