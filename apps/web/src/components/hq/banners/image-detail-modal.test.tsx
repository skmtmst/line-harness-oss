// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { URL as NodeURL } from 'node:url'
import { BannerImageDetailV8 } from '@/v8/hq-banners/image-detail'
import dialogStyles from '@/components/shared/dialog.module.css'

vi.mock('@/lib/api', () => ({ api: { lineAccounts: { list: async () => ({ success: true, data: [] }) }, lineAccountFolders: { list: async () => ({ success: true, data: { folders: [] } }) } } }))
const dialogCss = readFileSync(new NodeURL('../../shared/dialog.module.css', import.meta.url), 'utf8')
import type { BannerImage } from '@/lib/hq-banners'

/* R121: 背の高い画像詳細でも見出し・閉じる操作に届くことを、現役の共通Dialogで守る。 */
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

function open(onClose = vi.fn()) {
  render(
    <BannerImageDetailV8
      image={image}
      presets={[]}
      accounts={[]}
      canManage
      onClose={onClose}
      onToggleFavorite={() => undefined}
      onDeliver={async () => true}
      onRemove={async () => true}
    />,
  )
}

describe('R121 画像詳細モーダルの小画面対応', () => {
  it('窓は画面内に収まり、長い本文だけ縦にスクロールする', () => {
    open()
    const dialog = screen.getByRole('dialog', { name: /画像の詳細/ })
    expect(dialog.classList.contains(dialogStyles.panel)).toBe(true)
    expect(dialogCss).toMatch(/max-height:\s*calc\(100dvh - 32px\)/)
    const contentRule = dialogCss.match(/\.content\s*\{([^}]+)\}/)![1]
    expect(contentRule).toMatch(/min-height:\s*0/)
    expect(contentRule).toMatch(/overflow-y:\s*auto/)
  })

  it('見出しと閉じるボタンはスクロールする本文の外に残る', () => {
    const onClose = vi.fn()
    open(onClose)
    const dialog = screen.getByRole('dialog', { name: /画像の詳細/ })
    const close = screen.getByRole('button', { name: '閉じる' })
    const header = dialog.querySelector('.' + dialogStyles.headerRow)!
    const content = dialog.querySelector('.' + dialogStyles.content)!
    expect(header.contains(close)).toBe(true)
    expect(content.contains(close)).toBe(false)
    expect(dialogCss.match(/\.headerRow\s*\{([^}]+)\}/)![1]).toMatch(/flex:\s*0 0 auto/)
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('閉じる・画像・操作がすべて描画される', () => {
    open()
    expect(screen.getByRole('button', { name: '閉じる' })).toBeTruthy()
    expect(screen.getByText('手持ちの画像を取り込んだもの')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'ダウンロード' }).getAttribute('href')).toBe(image.media.url)
    expect((screen.getByRole('button', { name: '0アカウントへ配る' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
