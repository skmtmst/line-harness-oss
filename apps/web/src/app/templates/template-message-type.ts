/**
 * テンプレートの種類の呼び方（一覧・詳細・引き出しで共通）。
 *
 * `flex` `carousel` は LINE の作りの名前で、運用する人には通じない。
 * 一斉配信の一覧（`rowExcerpt`）と同じ言葉にそろえる。
 * 知らない種類でも内部の値を出さない（`sticker` や `video` の
 * ひな形が並ぶと画面に英語の値がそのまま出ていた）。
 */
export const messageTypeLabels: Record<string, string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'カード型',
  carousel: 'カルーセル',
  question: '質問',
}

export function messageTypeText(type: string): string {
  return messageTypeLabels[type] ?? 'その他'
}
