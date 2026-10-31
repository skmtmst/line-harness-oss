import { expect, it } from 'vitest'
import { chatListPreview } from './list-preview'

it.each([
  ['image', '画像'], ['flex', 'Flexメッセージ'], ['sticker', 'スタンプ'], ['video', '動画'],
  ['audio', '音声'], ['file', 'ファイル'], ['location', '位置情報'], ['unsent', '送信を取り消しました'],
])('PCと電話が使う一覧で%sの内部JSONを出さない', (lastMessageType, expected) => {
  expect(chatListPreview({ lastMessageType, lastMessageContent: '{"packageId":"2713"}' })).toBe(expected)
})
it('テキストの改行をまとめ、60文字の一覧を保つ', () => {
  const content = '確認\n\nお願いします' + '本文'.repeat(40)
  expect(chatListPreview({ lastMessageType: 'text', lastMessageContent: content })).toBe(content.replace(/\n+/g, ' ').slice(0, 60))
  expect(chatListPreview({ lastMessageType: 'text', lastMessageContent: '{"type":"sticker"}' })).toBe('{"type":"sticker"}')
})
