// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import Notice from '@/components/shared/notice'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { SettingsPage } from './settings-page'

afterEach(() => { cleanup(); verifiedStaffRole(null) })

it('帯の追加と取り外しで入力を失わず、帯は本文の前に1つだけ置く', () => {
  const page = (notice?: ReactNode) => <SettingsPage title="設定" navigation={<span>目次</span>} notice={notice}><input aria-label="名前" defaultValue="入力前" /></SettingsPage>
  const view = render(page())
  const input = screen.getByRole('textbox', { name: '名前' }) as HTMLInputElement
  fireEvent.change(input, { target: { value: '編集中の名前' } })
  view.rerender(page(<Notice>閲覧の案内</Notice>))
  expect(screen.getByRole('textbox', { name: '名前' })).toBe(input)
  expect(input.value).toBe('編集中の名前')
  const flow = view.container.querySelector('[data-template-region="settings-flow"]')!
  const notice = flow.querySelector('[data-template-region="notice"]')!
  const body = flow.querySelector('[data-template-region="body"]')!
  expect(notice.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  view.rerender(page())
  expect(view.container.querySelector('[data-template-region="notice"]')).toBeNull()
  expect(input.value).toBe('編集中の名前')
})

it('本人未知の空帯からviewer確定へ変わっても、本文を保持し帯だけを出す', () => {
  verifiedStaffRole(null)
  const { container } = render(<SettingsPage title="設定" navigation={<span>目次</span>} notice={<ReadOnlyNotice />}><input aria-label="同じ欄" defaultValue="保存した値" /></SettingsPage>)
  const slot = container.querySelector('[data-template-region="notice"]')!
  const input = screen.getByRole('textbox', { name: '同じ欄' }) as HTMLInputElement
  expect(slot.childElementCount).toBe(0)
  expect(screen.queryByText('閲覧のみで見ています。', { exact: false })).toBeNull()
  verifiedStaffRole('viewer')
  expect(container.querySelectorAll('[data-read-only-notice]')).toHaveLength(1)
  expect(screen.getByRole('textbox', { name: '同じ欄' })).toBe(input)
  expect(input.value).toBe('保存した値')
  const flow = container.querySelector('[data-template-region="settings-flow"]')!
  expect(flow.querySelector('[data-template-region="body"]')).toBeTruthy()
})

it('保存口があっても流れは帯と本文だけを持ち、保存口は外に置く', () => {
  const save = vi.fn()
  const { container } = render(<SettingsPage title="設定" navigation={<span>目次</span>} notice={<Notice>案内</Notice>} saveActions={<button onClick={save}>保存する</button>}><input aria-label="欄" defaultValue="" /></SettingsPage>)
  const flow = container.querySelector('[data-template-region="settings-flow"]')!
  expect(flow.querySelector('[data-template-region="footer"]')).toBeNull()
  expect(container.querySelector('[data-template-region="footer"]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '保存する' }))
  expect(save).toHaveBeenCalledTimes(1)
})

it('保存口を本文幅に置くときは本文の中に入れ、保存操作ができる', () => {
  const save = vi.fn()
  const { container } = render(<SettingsPage title="設定" navigation={<span>目次</span>} notice={<Notice>案内</Notice>} savePlacement="content" saveActions={<button onClick={save}>保存する</button>}><input aria-label="欄" defaultValue="" /></SettingsPage>)
  const body = container.querySelector('[data-template-region="body"]')!
  expect(body.querySelector('[data-template-region="footer"]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '保存する' }))
  expect(save).toHaveBeenCalledTimes(1)
})
