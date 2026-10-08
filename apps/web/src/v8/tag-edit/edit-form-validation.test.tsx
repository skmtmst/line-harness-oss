// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Tag } from '@line-crm/shared'

vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, tags: { ...actual.api.tags, list: async () => ({ success: true, data: [] }) } } }
})
import { TagEditForm } from './edit-form'
afterEach(() => { cleanup(); vi.restoreAllMocks() })

test('タグ編集の未入力は名前欄へ移動し、保存も上の重複通知も出さない', () => {
  const save = vi.fn()
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined)
  render(<TagEditForm tag={{ id: 't1', name: '', status: 'active' } as Tag} groups={[]} dependencies={null} accountId="a1" readOnly={false} conflict={false} compareBusy={false} onCompare={vi.fn()} onReloadLatest={vi.fn()} retroactiveReference={false} initialActions={[]} saving={false} error="" onCancel={vi.fn()} onSave={save} onDelete={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'タグを保存する' }))
  const name = screen.getByLabelText('タグ名')
  expect(name.getAttribute('aria-invalid')).toBe('true')
  expect(document.activeElement).toBe(name)
  expect(scroll).toHaveBeenCalledWith({ block: 'center' })
  expect(screen.getAllByText('タグ名を入力してください')).toHaveLength(1)
  expect(save).not.toHaveBeenCalled()
})
