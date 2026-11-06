// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { EntryRoute } from '@line-crm/shared'
import BulkRoutesDialog from './bulk-dialog'

afterEach(cleanup)

it('一括操作の受付先アカウントは推測せず環境とともに示す', () => {
  render(<BulkRoutesDialog targets={[{ id: 'route-1', name: '人工経路', isActive: true } as EntryRoute]} genreOptions={[]} initialAction="pause" onApplied={vi.fn()} onClose={vi.fn()} />)
  const dialog = screen.getByRole('dialog', { name: '流入経路をまとめて操作' })
  expect(within(dialog).getByText('受付先アカウント')).toBeTruthy()
  expect(within(dialog).getByText('受付先の全アカウントは確認できません。')).toBeTruthy()
  expect(within(dialog).getByText('名前を確認できません')).toBeTruthy()
  expect(within(dialog).getByText('環境')).toBeTruthy()
  expect(within(dialog).getByText('人工経路')).toBeTruthy()
})
