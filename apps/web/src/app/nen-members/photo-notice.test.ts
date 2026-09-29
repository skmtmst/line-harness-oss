import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { photoNoticeFor } from './photo-notice'

const FALLBACK = '審査結果を保存できませんでした。'

describe('写真審査の失敗文面', () => {
  it('409は英語のまま出さず、競合の日本語にする', () => {
    expect(photoNoticeFor(new ApiError(409), FALLBACK)).toContain('ほかの担当者')
    expect(photoNoticeFor(new ApiError(409), FALLBACK)).not.toContain('API error')
  })

  it('428は再操作の案内にする', () => {
    expect(photoNoticeFor(new ApiError(428), FALLBACK)).toContain('読み直して')
  })

  it('502は再送の案内にする', () => {
    expect(photoNoticeFor(new ApiError(502), FALLBACK)).toContain('再送')
  })

  it('403は権限の案内にする', () => {
    expect(photoNoticeFor(new ApiError(403), FALLBACK)).toContain('権限')
  })

  it('口の日本語(400の本文)はそのまま見せる', () => {
    expect(photoNoticeFor(new ApiError(400, '見送る理由を選んでください'), FALLBACK))
      .toBe('見送る理由を選んでください')
  })

  it('知らない失敗は呼び出し側の文面を使う', () => {
    expect(photoNoticeFor(new ApiError(500), FALLBACK)).toBe(FALLBACK)
    expect(photoNoticeFor(new Error('API error: 503'), FALLBACK)).toBe(FALLBACK)
    expect(photoNoticeFor('壊れた値', FALLBACK)).toBe(FALLBACK)
  })
})
