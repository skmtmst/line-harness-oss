// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AccountWithStats } from '@/contexts/account-context'
import type { BannerImage } from '@/lib/hq-banners'
import ImageDetailModal from './image-detail-modal'

afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })
it('V8でタグから配布先を選び、渡し済みを新しい選択に数えない', async () => {
  document.documentElement.dataset.theme = 'v8'
  const accounts = [
    { id: 'a', name: '本店', tags: [{ id: 'area', name: '北エリア', color: null }] },
    { id: 'b', name: '支店', tags: [{ id: 'area', name: '北エリア', color: null }] },
    { id: 'c', name: '別店', tags: [] },
  ] as AccountWithStats[]
  const image = { id: 'img', projectId: 'p', isFavorite: false, generation: null, deliveredAccountIds: ['a'], createdAt: '2026-10-04', media: { filename: 'x.png', mimeType: 'image/png', sizeBytes: 1, url: 'https://example.test/x.png' } } as BannerImage
  const deliver = vi.fn(async () => undefined)
  render(<ImageDetailModal image={image} presets={[]} accounts={accounts} projectName="試験" onClose={() => {}} onToggleFavorite={() => {}} onDeliver={deliver} onRemove={async () => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '北エリア' }))
  expect(screen.queryByLabelText('別店へ配布')).toBeNull()
  const already = screen.getByLabelText('本店へ配布') as HTMLInputElement
  expect(already.disabled).toBe(true)
  expect(already.checked).toBe(false)
  fireEvent.click(screen.getByLabelText('支店へ配布'))
  fireEvent.click(screen.getByRole('button', { name: '1アカウントへ渡す' }))
  expect(deliver).toHaveBeenCalledWith(['b'])
})
