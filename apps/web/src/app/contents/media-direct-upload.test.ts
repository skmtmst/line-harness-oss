import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractMediaMetadata,
  fileMatchesMediaKind,
  mediaAcceptForKind,
  mediaFileLimitBytes,
  validateMediaFile,
} from './media-direct-upload'

const MB = 1024 * 1024

describe('登録メディアの直接アップロード', () => {
  it.each([
    ['photo.jpg', 'image/jpeg', 10],
    ['voice.mp3', 'audio/mpeg', 200],
    ['voice.m4a', 'audio/mp4', 200],
    ['movie.mp4', 'video/mp4', 200],
    ['doc.pdf', 'application/pdf', 20],
  ])('%s（%s）の上限を %iMB として扱う', (name, type, limitMb) => {
    expect(mediaFileLimitBytes({ type })).toBe(limitMb * MB)
    expect(validateMediaFile({ name, type, size: limitMb * MB })).toBe('')
    expect(validateMediaFile({ name, type, size: limitMb * MB + 1 })).toBe(`${limitMb}MBを超えています`)
  })

  it('空ファイルと許可していない形式を登録させない', () => {
    expect(validateMediaFile({ name: 'empty.png', type: 'image/png', size: 0 })).toBe('中身が空のファイルは登録できません')
    expect(validateMediaFile({ name: 'sheet.xlsx', type: 'application/vnd.ms-excel', size: 100 })).toBe('この形式は登録できません')
  })

  it('口に無い形式は `image/`・`audio/` の頭が合っても選択時点で弾く', () => {
    // SVG・WAVは前方一致では画像・音声に見えるが、口（DIRECT_ALLOWED）には無い。
    // 選んだ時点でエラーにしないと、まとめて送った口の400で有効な分まで落ちる。
    expect(validateMediaFile({ name: 'icon.svg', type: 'image/svg+xml', size: 100 })).toBe('この形式は登録できません')
    expect(validateMediaFile({ name: 'voice.wav', type: 'audio/wav', size: 100 })).toBe('この形式は登録できません')
    expect(mediaFileLimitBytes({ type: 'image/svg+xml' })).toBeNull()
  })

  it('拡張子が中身の形式と食い違うものは選択時点で弾く', () => {
    // 口は拡張子も照合する（`spec.ext.includes(ext)`）。画面側でも同じ判定をし、
    // 食い違いだけをエラーにして残りの登録を妨げない。
    expect(validateMediaFile({ name: 'photo.jpg', type: 'image/png', size: 100 })).toBe('拡張子が中身の形式と合っていません')
    expect(validateMediaFile({ name: 'photo', type: 'image/png', size: 100 })).toBe('拡張子が中身の形式と合っていません')
    expect(validateMediaFile({ name: 'photo.PNG', type: 'image/png', size: 100 })).toBe('')
  })

  it('新版は現在のメディアと同じ種類だけを選べる', () => {
    expect(fileMatchesMediaKind({ type: 'image/webp' }, 'image')).toBe(true)
    expect(fileMatchesMediaKind({ type: 'video/mp4' }, 'image')).toBe(false)
    expect(fileMatchesMediaKind({ type: 'audio/mp4' }, 'audio')).toBe(true)
    expect(fileMatchesMediaKind({ type: 'application/pdf' }, 'file')).toBe(true)
    // 口（DIRECT_ALLOWED）に無い形式は選んだ時点で弾く。SVGは口で400になる。
    expect(fileMatchesMediaKind({ type: 'image/svg+xml' }, 'image')).toBe(false)
    expect(fileMatchesMediaKind({ type: 'audio/ogg' }, 'audio')).toBe(false)
    expect(mediaAcceptForKind('video')).toBe('video/mp4')
  })
})

describe('登録メディアの内容情報の読み取り', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('PDFのページ数を本文から数える（Pagesは数えない）', async () => {
    const file = new File(
      ['%PDF-1.4\n<</Type/Pages>>\n<</Type/Page>>\n<</Type /Page>>\n<</Type/Page>>'],
      'doc.pdf',
      { type: 'application/pdf' },
    )
    await expect(extractMediaMetadata(file)).resolves.toEqual({ pageCount: 3 })
  })

  it('MIMEのcodecs句を内容情報として拾う', async () => {
    const file = new File(['x'], 'a.mp4', { type: 'video/mp4; codecs="avc1.42"' })
    const metadata = await extractMediaMetadata(file)
    expect(metadata.codec).toBe('avc1.42')
  })

  it('画像はブラウザの実測値を返し、読めなければ推測で埋めない', async () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    vi.stubGlobal('createImageBitmap', () => Promise.resolve({
      width: 320, height: 240, close: () => undefined,
    }))
    await expect(extractMediaMetadata(file)).resolves.toEqual({ width: 320, height: 240 })

    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('decode failed')))
    await expect(extractMediaMetadata(file)).resolves.toEqual({})
  })
})
