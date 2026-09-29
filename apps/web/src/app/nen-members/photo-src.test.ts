import { describe, expect, it } from 'vitest'
import { safePhotoSrc } from './photo-src'

describe('写真の表示URL検査', () => {
  it('保管先のhttpsを通す', () => {
    expect(safePhotoSrc('https://example.com/photos/1.jpg')).toBe('https://example.com/photos/1.jpg')
  })

  it('画面確認用の作り物SVG(data:image)を通す', () => {
    const svg = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    expect(safePhotoSrc(svg)).toBe(svg)
  })

  it('同一サーバの相対パスを通す', () => {
    expect(safePhotoSrc('/api/nen-members/photos/ph-1/image')).toBe('/api/nen-members/photos/ph-1/image')
  })

  it('危険なURLを通さない', () => {
    expect(safePhotoSrc('javascript:alert(1)')).toBeNull()
    expect(safePhotoSrc('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(safePhotoSrc('//evil.example.com/x.jpg')).toBeNull()
    expect(safePhotoSrc('https:evil.example.com/x.jpg')).toBeNull()
  })

  it('外部のhttpと空・非文字列を通さない', () => {
    expect(safePhotoSrc('http://evil.example.com/x.jpg')).toBeNull()
    expect(safePhotoSrc('')).toBeNull()
    expect(safePhotoSrc(null)).toBeNull()
    expect(safePhotoSrc(undefined)).toBeNull()
  })

  it('手元の確認用サーバ(localhost)のhttpは通す', () => {
    expect(safePhotoSrc('http://localhost:8788/x.jpg')).toBe('http://localhost:8788/x.jpg')
    expect(safePhotoSrc('http://127.0.0.1:8788/x.jpg')).toBe('http://127.0.0.1:8788/x.jpg')
  })
})
