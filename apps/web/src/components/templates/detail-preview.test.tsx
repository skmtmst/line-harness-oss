// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DetailPage } from './detail-page'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
afterEach(cleanup)
it('畳む右欄は同じ内容と操作を共通の入口から開ける', async () => {
  const action = vi.fn()
  render(<DetailPage title="予約" layout="record-detail" summary={<button onClick={action}>テストを送る</button>} summaryPreview={{ label: '次の操作を見る', title: '予約後の操作' }}><p>保存された予約</p></DetailPage>)
  expect(document.querySelector('[data-template-region="preview"]')?.getAttribute('data-preview-narrow')).toBe('hidden')
  await act(async () => { screen.getByRole('button', { name: '次の操作を見る' }).click() })
  const dialog = screen.getByRole('dialog', { name: '予約後の操作' })
  const button = [...dialog.querySelectorAll('button')].find(node => node.textContent === 'テストを送る')!
  await act(async () => { button.click() })
  expect(action).toHaveBeenCalledOnce()
  expect(screen.getByText('保存された予約')).toBeTruthy()
})
it('畳む指定のない詳細は従来の右欄を保つ', () => {
  render(<DetailPage title="友だち" summary={<p>属性</p>}><p>履歴</p></DetailPage>)
  expect(document.querySelector('[data-template-region="summary"]')).not.toBeNull()
  expect(document.querySelector('[data-preview-narrow]')).toBeNull()
  expect(screen.queryByRole('button')).toBeNull()
})
