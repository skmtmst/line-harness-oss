import { expect, it } from 'vitest';
import { lineMessagePreview } from './line-message-preview.js';

it.each([
  ['image', '画像'], ['flex', 'Flexメッセージ'], ['sticker', 'スタンプ'], ['video', '動画'],
  ['audio', '音声'], ['file', 'ファイル'], ['location', '位置情報'], ['unsent', '送信を取り消しました'],
])('%sは保存済みJSONや欠けた本文を表示しない', (type, expected) => {
  expect(lineMessagePreview(type, '{"内部":"一覧に出さない"}')).toBe(expected);
  expect(lineMessagePreview(type, null)).toBe(expected);
});
it.each(['text', 'unknown', null, undefined])('種類%sの本文をJSONとして解釈せず、全文を保つ', type => {
  const text = '{"type":"sticker"}\n確認をお願いします。' + '長い本文'.repeat(30);
  expect(lineMessagePreview(type, text)).toBe(text);
  expect(lineMessagePreview(type, null)).toBe('');
});
