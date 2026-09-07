import { describe, expect, it } from 'vitest'
import { safeFlexAssetUrl } from './flex-preview'

describe('safeFlexAssetUrl', () => {
  it('公開HTTPS画像だけをプレビューへ渡す', () => {
    expect(safeFlexAssetUrl('https://cdn.example.jp/image.png')).toBe('https://cdn.example.jp/image.png')
  })

  it.each([
    'http://cdn.example.jp/image.png',
    'https://localhost/image.png',
    'https://127.0.0.1/image.png',
    'https://192.168.1.2/image.png',
    'https://user:pass@example.jp/image.png',
    'javascript:alert(1)',
  ])('内部・非HTTPS URLを画像として開かない: %s', (url) => {
    expect(safeFlexAssetUrl(url)).toBeNull()
  })
})
