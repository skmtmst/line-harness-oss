/*
 * ★V8 B-6 受信箱の添付（M0393「7. 添付」I7Skn・API-15）：送る前の形式・大きさの確かめと、
 * 送る口への形・会話の中の表示・予約の一覧の文。
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import {
  attachmentSendInput,
  checkAttachment,
  describeUploadFailure,
  formatSize,
  parseSentAttachment,
  scheduledContentLabel,
} from './attachments'

const MB = 1024 * 1024
const file = (name: string, type: string, size: number) => ({ name, type, size })

describe('checkAttachment（選んだ・落としたものを送る前に確かめる）', () => {
  it('画像は JPEG・PNG・1MB まで（今までの画像の準備へ）', () => {
    expect(checkAttachment(file('a.jpg', 'image/jpeg', MB), 'media')).toEqual({ ok: true, kind: 'image', mimeType: 'image/jpeg' })
    const big = checkAttachment(file('a.png', 'image/png', MB + 1), 'media')
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.reason).toContain('画像は1MBまで')
  })

  it('動画は MP4・200MB まで', () => {
    expect(checkAttachment(file('clip.mp4', 'video/mp4', 200 * MB), 'media')).toMatchObject({ ok: true, kind: 'video' })
    const big = checkAttachment(file('clip.mp4', 'video/mp4', 200 * MB + 1), 'media')
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.reason).toContain('動画は200MBまで')
    expect(checkAttachment(file('clip.mov', 'video/quicktime', MB), 'media').ok).toBe(false)
  })

  it('ファイルは PDF・Word・Excel・PowerPoint・ZIP・10MB まで', () => {
    expect(checkAttachment(file('案内.pdf', 'application/pdf', 10 * MB), 'file')).toMatchObject({ ok: true, kind: 'file' })
    expect(checkAttachment(file('表.xlsx', '', MB), 'file')).toMatchObject({ ok: true, kind: 'file', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    expect(checkAttachment(file('まとめ.zip', 'application/x-zip-compressed', MB), 'file')).toMatchObject({ ok: true, kind: 'file' })
    const big = checkAttachment(file('案内.pdf', 'application/pdf', 10 * MB + 1), 'file')
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.reason).toContain('ファイルは10MBまで')
  })

  it('送れない形式・押した口と合わない形式は、その場で理由を出す', () => {
    const csv = checkAttachment(file('名簿.csv', 'text/csv', 10), 'file')
    expect(csv.ok).toBe(false)
    if (!csv.ok) expect(csv.reason).toContain('送れない形式')
    // 画像・動画の口で PDF を選んだ
    expect(checkAttachment(file('案内.pdf', 'application/pdf', 10), 'media').ok).toBe(false)
    // ファイルの口で画像を選んだ（画像はリンクではなく画像として届けるので画像・動画の口へ）
    expect(checkAttachment(file('a.png', 'image/png', 10), 'file').ok).toBe(false)
    // 空のファイル
    expect(checkAttachment(file('空.pdf', 'application/pdf', 0), 'file').ok).toBe(false)
  })

  it('ドラッグで落としたとき（口なし）は形式から決める', () => {
    expect(checkAttachment(file('a.png', 'image/png', 10))).toMatchObject({ ok: true, kind: 'image' })
    expect(checkAttachment(file('clip.mp4', '', 10))).toMatchObject({ ok: true, kind: 'video' })
    expect(checkAttachment(file('案内.pdf', 'application/pdf', 10))).toMatchObject({ ok: true, kind: 'file' })
  })
})

describe('送る口への形（API-15）', () => {
  const base = { key: 'k', filename: '案内.pdf', mimeType: 'application/pdf', size: 10, expiresAt: null }
  it('動画は video と URL、ファイルは file と添付の ID だけを送る', () => {
    expect(attachmentSendInput({ ...base, id: 'v1', url: 'https://w.example/a/v1', kind: 'video' })).toEqual({
      messageType: 'video', content: JSON.stringify({ originalContentUrl: 'https://w.example/a/v1' }),
    })
    expect(attachmentSendInput({ ...base, id: 'f1', url: 'https://w.example/a/f1', kind: 'file' })).toEqual({
      messageType: 'file', content: JSON.stringify({ attachmentId: 'f1' }),
    })
  })
})

describe('会話の中・予約の一覧の見せ方', () => {
  it('送ったファイルは名前・大きさ・期限、動画は URL を読む。読めない形は null', () => {
    expect(parseSentAttachment('file', JSON.stringify({ attachmentId: 'f1', filename: '案内.pdf', size: 482133, url: 'https://w.example/f1', expiresAt: '2026-11-07T03:00:00.000Z' })))
      .toEqual({ kind: 'file', name: '案内.pdf', size: 482133, url: 'https://w.example/f1', expiresAt: '2026-11-07T03:00:00.000Z' })
    expect(parseSentAttachment('video', JSON.stringify({ originalContentUrl: 'https://w.example/v', previewImageUrl: 'https://w.example/p' })))
      .toEqual({ kind: 'video', url: 'https://w.example/v', previewUrl: 'https://w.example/p' })
    expect(parseSentAttachment('video', 'こわれた')).toBeNull()
  })

  it('予約の一覧は JSON のまま出さない', () => {
    expect(scheduledContentLabel('image', '{"originalContentUrl":"x"}')).toBe('画像 1枚')
    expect(scheduledContentLabel('video', '{"originalContentUrl":"x"}')).toBe('動画')
    expect(scheduledContentLabel('file', JSON.stringify({ attachmentId: 'f1', filename: '案内.pdf' }))).toBe('ファイル「案内.pdf」')
    expect(scheduledContentLabel('file', JSON.stringify({ attachmentId: 'f1' }))).toBe('ファイル')
    expect(scheduledContentLabel('text', 'こんにちは')).toBe('こんにちは')
  })

  it('大きさは KB・MB で読める', () => {
    expect(formatSize(482133)).toBe('471KB')
    expect(formatSize(1.5 * MB)).toBe('1.5MB')
    expect(formatSize(120 * MB)).toBe('120MB')
  })
})

describe('準備（アップロード）の失敗の文', () => {
  it('口の日本語の理由はそのまま、機械の文は言い換える', () => {
    expect(describeUploadFailure(new ApiError(400, 'ファイルは10MB以下にしてください'))).toBe('ファイルは10MB以下にしてください')
    expect(describeUploadFailure(new ApiError(500, 'Internal server error'))).toContain('準備できませんでした')
    expect(describeUploadFailure(new ApiError(500))).not.toContain('API error')
    expect(describeUploadFailure(new TypeError('Failed to fetch'))).toContain('準備できませんでした')
    expect(describeUploadFailure(null)).toContain('準備できませんでした')
  })
})
