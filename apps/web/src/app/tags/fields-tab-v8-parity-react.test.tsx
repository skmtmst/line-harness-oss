// @vitest-environment happy-dom

import React from 'react'
import { PageExplanationProvider } from '@/components/shared/page-explanation'
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

vi.mock('@/lib/staff-role', async original => ({ ...await original<typeof import('@/lib/staff-role')>(), useStaffIdentity: () => null }))
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
  test('共通項目は並び替えと削除を許さず、独自の項目と区別する', async () => {
    fixture.fields = [fieldItem('f1', '会員番号', true), fieldItem('f2', '好きな色', false)]
    const { default: FieldsTabV8 } = await import('@/v8/tags/fields-tab')
    const rendered = render(<PageExplanationProvider pageKey="tags:fields"><FieldsTabV8 accountId="account-a" canEdit /></PageExplanationProvider>)
    await rendered.findByText('会員番号')
    expect(rendered.getAllByTitle('共通項目は移行後に並び替えできます').length).toBeGreaterThan(0)
    fireEvent.click(rendered.getByRole('button', { name: '項目「会員番号」の操作' }))
    const menu = await rendered.findByRole('menu')
    expect(menu.textContent).not.toContain('削除する')
    fireEvent.keyDown(menu, { key: 'Escape' })
    fireEvent.click(rendered.getByRole('button', { name: '項目「好きな色」の操作' }))
    expect(await rendered.findByRole('menuitem', { name: '削除する' })).toBeTruthy()
  })

  test('表示件数に30件・40件を選べる', async () => {
    fixture.fields = [fieldItem('f1', '会員番号', false)]
    const { default: FieldsTabV8 } = await import('@/v8/tags/fields-tab')
    const rendered = render(<PageExplanationProvider pageKey="tags:fields"><FieldsTabV8 accountId="account-a" canEdit /></PageExplanationProvider>)
    await rendered.findByText('会員番号')
    const box = rendered.container.querySelector('[aria-label="表示件数"]')
    if (!box) throw new Error('page size select is missing')
    fireEvent.click(box)
    const opened = await rendered.findByRole('listbox')
    expect(opened.textContent).toContain('30件表示')
    expect(opened.textContent).toContain('40件表示')
  })
})
