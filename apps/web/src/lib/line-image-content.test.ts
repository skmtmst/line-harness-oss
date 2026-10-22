import { expect, it } from 'vitest'
import { readLineImageContent } from './line-image-content'

it('保存した原画像とプレビューをそのまま読む', () => {
  const image = { originalContentUrl: 'https://example.test/full.png', previewImageUrl: 'https://example.test/preview.png' }
  expect(readLineImageContent(JSON.stringify(image))).toEqual(image)
})

it.each([undefined, '', 1])('プレビューが未設定なら原画像を使う: %s', previewImageUrl => {
  const originalContentUrl = 'https://example.test/full.png'
  expect(readLineImageContent(JSON.stringify({ originalContentUrl, previewImageUrl }))).toEqual({ originalContentUrl, previewImageUrl: originalContentUrl })
})

it.each(['画像本文', 'null', '[]', '{}', '{"originalContentUrl":0}', '{"originalContentUrl":"","previewImageUrl":"https://example.test/preview.png"}'])('有効な原画像のない保存値を画像として読まない: %s', content => {
  expect(readLineImageContent(content)).toBeNull()
})
