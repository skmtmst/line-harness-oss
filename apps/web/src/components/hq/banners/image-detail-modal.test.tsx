// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import ImageDetailModal from './image-detail-modal'
import type { BannerImage } from '@/lib/hq-banners'

/*
 * R121: バナー画像詳細がスマートフォンで上にはみ出し、閉じるボタンが見えない。
 * 背の高い窓を `items-center` のまま `overflow` と重ねると、上が画面外へ切れて
 * 指では先頭へ戻れない。外は縦スクロール、窓は `my-auto` の安全な中央寄せにし、
 * 見出し（閉じるボタン）を上に固定する。
 */
afterEach(cleanup)

const image: BannerImage = {
  id: 'img-1',
  projectId: 'p-1',
  generationId: null,
  sequence: 1,
  source: 'upload',
  parentImageId: null,
  isFavorite: false,
  createdBy: null,
  createdAt: '2026-09-27T00:00:00Z',
  media: { id: 'm-1', filename: 'banner.jpg', mimeType: 'image/jpeg', sizeBytes: 12345, width: 1024, height: 1536, url: 'https://example.com/banner.jpg' },
  generation: null,
  deliveredAccountIds: [],
}

function open() {
  render(
    <ImageDetailModal
      image={image}
      presets={[]}
      accounts={[]}
      projectName="秋の案内"
      onClose={() => undefined}
      onToggleFavorite={() => undefined}
      onDeliver={async () => undefined}
      onRemove={async () => undefined}
    />,
  )
}

describe('R121 画像詳細モーダルの小画面対応', () => {
  it('外枠は縦スクロール専用で、中央寄せを重ねない', () => {
    open()
    const dialog = screen.getByRole('dialog', { name: /画像の詳細/ })
    const overlay = dialog.parentElement?.parentElement as HTMLElement
    expect(overlay.className).toContain('overflow-y-auto')
    expect(overlay.className).not.toContain('items-center')
    // 窓は余白があれば中央、無ければ上から読める。
    expect(dialog.className).toContain('my-auto')
    expect(dialog.parentElement?.className).toContain('min-h-full')
  })

  it('見出しと閉じるボタンは上に固定される', () => {
    open()
    const close = screen.getByRole('button', { name: '閉じる' })
    const header = close.closest('div') as HTMLElement
    expect(header.className).toContain('sticky')
    expect(header.className).toContain('top-0')
  })

  it('閉じる・画像・操作がすべて描画される', () => {
    open()
    expect(screen.getByRole('button', { name: '閉じる' })).toBeTruthy()
    expect(screen.getByText('秋の案内')).toBeTruthy()
    expect(screen.getByRole('button', { name: /アカウントへ渡す/ })).toBeTruthy()
  })
})
