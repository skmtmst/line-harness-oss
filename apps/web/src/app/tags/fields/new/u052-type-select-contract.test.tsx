// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock() }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
import FieldEditor from '@/v8/tags/field-editor'
afterEach(cleanup)
it('14種類から選んだ状態を読み上げ、差し込み名は飾りを混ぜず保存する', () => {
  const submit = vi.fn()
  render(<FieldEditor mode="create" folders={[]} foldersState="ready" siblings={[]} siblingsReady saving={false} backHref="/tags?tab=fields" onCancel={vi.fn()} onSubmit={submit} />)
  expect(screen.getAllByRole('radio')).toHaveLength(14)
  expect(screen.getAllByText('{{field.')).toHaveLength(1)
  fireEvent.change(screen.getByLabelText('項目名'), { target: { value: '受付日時' } })
  fireEvent.change(screen.getByLabelText('差し込みの名前（英字）'), { target: { value: 'appointment_time' } })
  const datetime = screen.getByRole('radio', { name: '日時' }) as HTMLInputElement
  fireEvent.click(datetime)
  expect(datetime.checked).toBe(true)
  expect((screen.getByRole('radio', { name: '1行テキスト' }) as HTMLInputElement).checked).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '項目を作る' }))
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ type: 'datetime', fieldKey: 'appointment_time', name: '受付日時' }), expect.any(String))
})
