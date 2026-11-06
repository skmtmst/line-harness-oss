// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TagEditForm } from './edit'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: vi.fn(), usePageCrumbs: vi.fn() }))
afterEach(cleanup)
function mount() {
  const onSave = vi.fn()
  render(<TagEditForm tag={{ id: 't', name: '購入', friendCount: 5, mileageReward: 10 } as never} groups={[]} dependencies={null} accountId="a" readOnly={false} conflict={false} compareBusy={false} onCompare={vi.fn()} onReloadLatest={vi.fn()} retroactiveReference initialActions={[]} saving={false} error="" onCancel={vi.fn()} onSave={onSave} onDelete={vi.fn()} />)
  return onSave
}
it.each(['×', 'Esc'])('WEB277：%sは保存せず閉じ、編集内容を残す', how => {
  const onSave = mount()
  if (how === '×') fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '閉じる' }))
  else fireEvent.keyDown(document, { key: 'Escape' })
  expect(onSave).not.toHaveBeenCalled()
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect((screen.getByPlaceholderText('例：定期購入者') as HTMLInputElement).value).toBe('購入')
})
it('WEB277：明示した「反映しないで保存する」だけ通常保存する', () => {
  const onSave = mount()
  fireEvent.click(screen.getByRole('button', { name: '反映しないで保存する' }))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ applyToExisting: false }), false)
})
