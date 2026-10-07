import { describe, expect, it } from 'vitest'
import { mediaTooLargeMessage, videoPreviewProblem } from './broadcast-form'

/* 一斉配信の動画（2026-10-07 オーナー「動画の送信。データ量の上限はある？」）。 */
describe('一斉配信の動画の吹き出し', () => {
  it('大きすぎるファイルは、上限と今の大きさを両方言う', () => {
    expect(mediaTooLargeMessage(true, 350 * 1024 * 1024)).toBe('動画は200MBまでです。今のファイルは350MBです')
    expect(mediaTooLargeMessage(false, 12.4 * 1024 * 1024)).toBe('画像は10MBまでです。今のファイルは12MBです')
    expect(mediaTooLargeMessage(false, 1.25 * 1024 * 1024)).toBe('画像は10MBまでです。今のファイルは1.3MBです')
  })

  it('プレビュー画像は必須で https だけ（LINE が動画と一緒に必ず受け取る）', () => {
    expect(videoPreviewProblem('')).toContain('プレビュー画像のURLを入れてください')
    expect(videoPreviewProblem(undefined)).toContain('プレビュー画像のURLを入れてください')
    expect(videoPreviewProblem('http://e.test/p.jpg')).toContain('https://')
    expect(videoPreviewProblem('https://e.test/p.jpg')).toBeNull()
  })
})
