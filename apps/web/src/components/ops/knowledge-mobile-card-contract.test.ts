// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import OpsKnowledgeV8 from '@/v8/ops/knowledge'

const title = '名前を省略しても同じ場所で全文を読める記事'
vi.mock('next/navigation', async () => ({ ...(await import('@/test-utils/navigation-mock')).navigationMock(), usePathname: () => '/ops/knowledge' }))
vi.mock('@/lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  api: { ops: { knowledge: { list: async () => ({ success: true, total: 1, data: [{
    id: 'article', title, kind: 'usage', articleKind: 'verified', reviewState: 'pending', status: 'disabled',
    usedCount: 0, helpfulCount: 0, updatedAt: '2026-10-01T00:00:00Z',
  }] }) } } },
}))
afterEach(cleanup)

it('記事の項目を見出しで区別し、既知の0回を不明に変えない', async () => {
  render(React.createElement(OpsKnowledgeV8))
  const name = await screen.findByRole('button', { name: `「${title}」を開く` })
  const row = name.closest('tr')!
  expect(screen.getAllByRole('columnheader')).toHaveLength(7)
  for (const label of ['種類', '状態', '使われた回数', '役に立った', '更新日']) expect(screen.getByRole('columnheader', { name: label })).toBeTruthy()
  expect([...row.querySelectorAll('[data-list-number]')].map(cell => cell.textContent)).toEqual(['0', '0'])
})

it('記事の全文と開く操作を省略の外側へ残す', async () => {
  render(React.createElement(OpsKnowledgeV8))
  const name = await screen.findByRole('button', { name: `「${title}」を開く` })
  expect(name.title).toBe(title)
  expect(name.closest('td')?.getAttribute('data-list-name-cell')).not.toBeNull()
  expect(screen.getByRole('button', { name: `${title}のその他操作` })).toBeTruthy()
})
