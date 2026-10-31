/** 保存済みの本文は変えず、一覧では非テキストの種類名を出す。 */
export function lineMessagePreview(type: string | null | undefined, content: string | null | undefined): string {
  if (type === 'image') return '画像';
  if (type === 'flex') return 'Flexメッセージ';
  if (type === 'sticker') return 'スタンプ';
  if (type === 'video') return '動画';
  if (type === 'audio') return '音声';
  if (type === 'file') return 'ファイル';
  if (type === 'location') return '位置情報';
  if (type === 'unsent') return '送信を取り消しました';
  return content ?? '';
}
