// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import Notice from '@/components/shared/notice'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { CreatePage } from './create-page'

afterEach(() => { cleanup(); verifiedStaffRole(null) })

it('帯の追加と取り外しで入力・プレビュー開閉・保存を失わず、帯は左右の列の前に1つだけ置く', () => {
  const save = vi.fn()
  const page = (notice?: ReactNode) => <CreatePage title="作成" dirty={false} notice={notice} preview={<p>設定の見本</p>} previewLabel="設定内容を見る" footerActions={<button onClick={save}>保存する</button>}><input aria-label="名前" defaultValue="入力前" /></CreatePage>
  const view = render(page())
  const input = screen.getByRole('textbox', { name: '名前' }) as HTMLInputElement
  fireEvent.change(input, { target: { value: '編集中の名前' } })
  view.rerender(page(<Notice>閲覧の案内</Notice>))
  expect(screen.getByRole('textbox', { name: '名前' })).toBe(input)
  expect(input.value).toBe('編集中の名前')
  const flow = view.container.querySelector('[data-template-region="create-flow"]')!
  const notice = flow.querySelector('[data-template-region="notice"]')!
  const body = flow.querySelector('[data-template-region="body"]')!
  expect(notice.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(flow.querySelector('[data-template-region="preview"]')).toBeTruthy()
  expect(flow.querySelector('[data-template-region="footer"]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '設定内容を見る' }))
  expect(within(screen.getByRole('dialog')).getByText('設定の見本')).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  view.rerender(page())
  expect(view.container.querySelector('[data-template-region="notice"]')).toBeNull()
  expect(input.value).toBe('編集中の名前')
  fireEvent.click(screen.getByRole('button', { name: '保存する' }))
  expect(save).toHaveBeenCalledTimes(1)
})

it('本人未知の空帯からviewer確定へ変わっても、本文と操作を保持し帯だけを出す', () => {
  verifiedStaffRole(null)
  const { container } = render(<CreatePage title="作成" dirty={false} notice={<ReadOnlyNotice />} previewToggle={<button>設定内容を見る</button>} footerActions={<button>戻る</button>}><input aria-label="同じ欄" defaultValue="保存した値" /></CreatePage>)
  const slot = container.querySelector('[data-template-region="notice"]')!
  const input = screen.getByRole('textbox', { name: '同じ欄' }) as HTMLInputElement
  expect(slot.childElementCount).toBe(0)
  expect(screen.queryByText('閲覧のみで見ています。', { exact: false })).toBeNull()
  verifiedStaffRole('viewer')
  expect(container.querySelectorAll('[data-read-only-notice]')).toHaveLength(1)
  expect(screen.getByRole('textbox', { name: '同じ欄' })).toBe(input)
  expect(input.value).toBe('保存した値')
  expect(screen.getAllByRole('button', { name: '設定内容を見る' })).toHaveLength(1)
})

it.each(['flush-top', 'notice-after-preview', 'notice-after-read-only'] as const)('明示した%sの既存の組合せへ既定の流れを混ぜない', contentSpacing => {
  const { container } = render(<CreatePage title="作成" dirty={false} contentSpacing={contentSpacing} notice={<Notice>案内</Notice>} preview={<p>見本</p>} footerActions={<button>保存</button>}>本文</CreatePage>)
  expect(container.querySelector('[data-template-region="create-flow"]')).toBeNull()
  expect(container.querySelector('[data-template-region="content"]')!.getAttribute('data-content-spacing')).toBe(contentSpacing)
  expect(container.querySelector('[data-template-region="preview"]')!.getAttribute('data-content-spacing')).toBe(contentSpacing)
  expect(screen.getByText('本文')).toBeTruthy()
  expect(screen.getByRole('button', { name: '保存' })).toBeTruthy()
})
