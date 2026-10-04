// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  push: vi.fn(),
  create: vi.fn(),
  saveDraft: vi.fn(),
  deleteRule: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fixture.push }) }))
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-a' }),
}))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  api: {
    tags: { list: async () => ({ success: true, data: [] }) },
    mileage: {
      createRule: fixture.create,
      saveEarningRuleDraft: fixture.saveDraft,
      deleteRule: fixture.deleteRule,
    },
  },
}))

import V8EarningRuleNew from './v8-earning-rule-new'

let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  vi.resetAllMocks()
  fixture.create.mockImplementation(async () => ({
    success: true, data: { id: `rule-${fixture.create.mock.calls.length}` },
  }))
  fixture.saveDraft.mockResolvedValue({ success: true, data: {} })
  fixture.deleteRule.mockResolvedValue({ success: true })
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.history.replaceState(null, '', '/mileage/earning-rules/new')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<V8EarningRuleNew />) })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
})

async function fill(name: string, miles: string) {
  await act(async () => {
    fireEvent.change(host.querySelector('#sc-name')!, { target: { value: name } })
    fireEvent.change(host.querySelector('input[type="number"]')!, { target: { value: miles } })
  })
}

async function saveAndContinue() {
  const button = Array.from(host.querySelectorAll('button'))
    .find((item) => item.textContent === '保存して続けて作る')!
  await act(async () => { fireEvent.click(button) })
}

test('続けて作ると空の入力へ戻り、同じ内容でも別の決めごととして保存できる', async () => {
  await fill('予約してくれたら', '100')
  await saveAndContinue()

  expect((host.querySelector('#sc-name') as HTMLInputElement).value).toBe('')
  expect((host.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('')
  expect(document.activeElement).toBe(host.querySelector('#sc-name'))
  expect(fixture.push).not.toHaveBeenCalled()

  await saveAndContinue()
  expect(fixture.create).toHaveBeenCalledTimes(1)
  expect(host.textContent).toContain('ルール名を入力してください')

  await fill('予約してくれたら', '100')
  await saveAndContinue()
  expect(fixture.create).toHaveBeenCalledTimes(2)
  expect(fixture.create.mock.calls[0][1].idempotencyKey)
    .not.toBe(fixture.create.mock.calls[1][1].idempotencyKey)
  expect(fixture.saveDraft.mock.calls.map(([id]) => id)).toEqual(['rule-1', 'rule-2'])
})

test('保存に失敗したときは入力を残し、成功した再試行で空に戻す', async () => {
  fixture.create.mockRejectedValueOnce(new Error('保存できませんでした'))
  await fill('予約してくれたら', '100')
  await saveAndContinue()
  expect((host.querySelector('#sc-name') as HTMLInputElement).value).toBe('予約してくれたら')
  expect(host.textContent).toContain('保存できませんでした')
  await saveAndContinue()
  expect(fixture.create.mock.calls[0][1].idempotencyKey)
    .toBe(fixture.create.mock.calls[1][1].idempotencyKey)
  expect((host.querySelector('#sc-name') as HTMLInputElement).value).toBe('')
})

test('下書きの保存に失敗したときも入力を残す', async () => {
  fixture.saveDraft.mockResolvedValueOnce({ success: false, error: '詳しい設定を保存できませんでした' })
  await fill('予約してくれたら', '100')
  await saveAndContinue()
  expect(fixture.deleteRule).toHaveBeenCalledWith('rule-1')
  expect((host.querySelector('#sc-name') as HTMLInputElement).value).toBe('予約してくれたら')
  expect(host.textContent).toContain('詳しい設定を保存できませんでした')
})
