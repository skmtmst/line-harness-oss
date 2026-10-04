// @vitest-environment happy-dom

import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

type ApiResult = { success: boolean; data?: unknown }

const fixture = vi.hoisted(() => ({
  fields: [] as unknown[],
  stats: (): Promise<ApiResult> => Promise.resolve({ success: true, data: null }),
  folders: (): Promise<ApiResult> => Promise.resolve({ success: true, data: [] }),
}))

const fieldItem = (id: string, name: string, isInherited: boolean) => ({
  id,
  accountId: 'account-a',
  name,
  fieldKey: `field_${id}`,
  type: 'text',
  isInherited,
  usageCount: 0,
  formUsageCount: 0,
  displayTargets: [],
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {} }),
}))

vi.mock('@/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status = 500
  },
  api: {
    friendFields: {
      stats: () => fixture.stats(),
      list: () => Promise.resolve({ success: true, data: fixture.fields }),
      reorder: () => Promise.resolve({ success: true }),
      delete: () => Promise.resolve({ success: true }),
    },
    folders: {
      list: () => fixture.folders(),
      swapOrder: () => Promise.resolve({ success: true }),
      delete: () => Promise.resolve({ success: true }),
    },
  },
}))

afterEach(cleanup)

describe('友だち情報欄V8一覧', () => {
  test('共通項目の行に錠の印を出す（v7と同じ区別）', async () => {
    fixture.fields = [fieldItem('f1', '会員番号', true), fieldItem('f2', '好きな色', false)]
    const { default: FieldsTabV8 } = await import('./fields-tab-v8')
    const rendered = render(<FieldsTabV8 accountId="account-a" canEdit />)
    const lock = await rendered.findByLabelText('共通項目のため削除できません')
    expect(lock).toBeTruthy()
  })

  test('表示件数に30件・40件がある（v7と同じ刻み）', async () => {
    fixture.fields = [fieldItem('f1', '会員番号', false)]
    const { default: FieldsTabV8 } = await import('./fields-tab-v8')
    const rendered = render(<FieldsTabV8 accountId="account-a" canEdit />)
    await rendered.findByText('会員番号')
    const box = rendered.container.querySelector('[aria-label="表示件数"]')
    if (!box) throw new Error('page size select is missing')
    fireEvent.click(box)
    const opened = await rendered.findByRole('listbox')
    expect(opened.textContent).toContain('30件表示')
    expect(opened.textContent).toContain('40件表示')
  })
})
