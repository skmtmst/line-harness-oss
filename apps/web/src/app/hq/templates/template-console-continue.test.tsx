// @vitest-environment happy-dom
/*
 * R561: HQタグひな形の「保存して続けて作る」は、保存後に空の新規入力画面へ
 * 戻らなければならない（保存済みの行は残す）。正規編集部品の連続作成の
 * 選択が統括ラッパーで落とされていたため、一覧へ戻っていた。
 *
 * 差し替えるのは API（サーバーとの境界）・shell のタイトル・next/link だけ。
 * 編集部品と保存の流れは本物を使う。
 */
import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import TemplateConsole from './template-console'

const calls = vi.hoisted(() => ({
  context: vi.fn(),
  list: vi.fn(),
  accounts: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  preflight: vi.fn(),
  distribute: vi.fn(),
  result: vi.fn(),
  uploadImage: vi.fn(),
}))
vi.mock('@/lib/hq-templates-api', () => ({ TEMPLATE_TYPES: ['tag', 'template', 'rich_menu', 'form'], hqTemplatesApi: calls }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}))

let created = 0
beforeEach(() => {
  vi.resetAllMocks()
  created = 0
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/hq/friend-attributes')
  calls.context.mockResolvedValue({ tenantId: 'tenant-a', actorId: 'owner' })
  calls.list.mockResolvedValue([])
  calls.accounts.mockResolvedValue([])
  calls.create.mockImplementation(async (input: { name: string; definition: unknown }) => {
    created += 1
    return {
      template: { id: `t${created}`, name: input.name, description: null, template_type: 'tag', revision: 1, updated_at: '2026-09-29T00:00:00Z' },
      definition: input.definition,
    }
  })
})
afterEach(cleanup)

it('保存して続けて作るで保存済みを残し空の新規入力へ戻る', async () => {
  render(<TemplateConsole type="tag" />)
  fireEvent.click(await screen.findByRole('button', { name: '＋ひな形を作成' }))
  fireEvent.change(screen.getByPlaceholderText('例: 定期購入者'), { target: { value: '一つ目' } })
  fireEvent.click(screen.getByRole('button', { name: '保存して続けて作る' }))
  await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1))
  // 一覧へ戻らず、空の新規入力画面に残る
  await screen.findByText('ひな形を保存しました。')
  expect((screen.getByPlaceholderText('例: 定期購入者') as HTMLInputElement).value).toBe('')
  expect(screen.getByRole('button', { name: '保存して続けて作る' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '＋ひな形を作成' })).toBeNull()
  // 続けて二つ目を作り、通常保存で一覧へ戻ると両方が残る
  fireEvent.change(screen.getByPlaceholderText('例: 定期購入者'), { target: { value: '二つ目' } })
  fireEvent.click(screen.getByRole('button', { name: 'タグを作る' }))
  await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(2))
  await screen.findByText('一つ目')
  expect(screen.getByText('二つ目')).toBeTruthy()
  expect(screen.getByRole('button', { name: '＋ひな形を作成' })).toBeTruthy()
})
