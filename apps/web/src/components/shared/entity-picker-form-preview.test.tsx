// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { emptyLayout } from '@line-crm/shared'

const getForm = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL ||= 'http://worker.test'
  return vi.fn()
})

vi.mock('@/lib/api', async original => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, forms: { ...actual.api.forms, get: getForm } } }
})
vi.mock('next/dynamic', () => ({
  default: () => ({ formName }: { formName?: string }) => React.createElement('div', { 'data-testid': 'phone-name' }, formName ?? '名前なし'),
}))

import { FormPreviewPhone } from './entity-picker-sources'

const result = (name: string) => ({ success: true, data: { name, layout: emptyLayout() } })
beforeEach(() => getForm.mockReset())
afterEach(cleanup)

test('選択したフォームの名前を既存の取得応答から電話の見本へ渡す', async () => {
  getForm.mockResolvedValue(result('来店アンケート'))
  render(<FormPreviewPhone formId="form-a" accountId="account-a" />)
  expect((await screen.findByTestId('phone-name')).textContent).toBe('来店アンケート')
  expect(getForm).toHaveBeenCalledWith('form-a', 'account-a')
})

test.each(['form', 'account'] as const)('選択先の%sを替えた後の遅い応答で、前のフォーム名へ戻らない', async scope => {
  let finish!: (value: ReturnType<typeof result>) => void
  getForm.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValue(result('現在のフォーム'))
  const view = render(<FormPreviewPhone formId="form-a" accountId="account-a" />)
  await waitFor(() => expect(getForm).toHaveBeenCalledOnce())
  view.rerender(<FormPreviewPhone formId={scope === 'form' ? 'form-b' : 'form-a'} accountId={scope === 'account' ? 'account-b' : 'account-a'} />)
  expect((await screen.findByTestId('phone-name')).textContent).toBe('現在のフォーム')
  await act(async () => finish(result('前のフォーム')))
  expect(screen.getByTestId('phone-name').textContent).toBe('現在のフォーム')
})

test('取得失敗では前の名前を隠し、再試行で選択中のフォーム名を表示する', async () => {
  getForm.mockResolvedValueOnce(result('前のフォーム'))
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(result('次のフォーム'))
  const view = render(<FormPreviewPhone formId="form-a" accountId="account-a" />)
  expect((await screen.findByTestId('phone-name')).textContent).toBe('前のフォーム')
  view.rerender(<FormPreviewPhone formId="form-b" accountId="account-a" />)
  await waitFor(() => expect(view.container.querySelector('[data-list-state="error"][role="alert"]')).toBeTruthy())
  expect(screen.queryByTestId('phone-name')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
  expect((await screen.findByTestId('phone-name')).textContent).toBe('次のフォーム')
  expect(getForm).toHaveBeenLastCalledWith('form-b', 'account-a')
})
