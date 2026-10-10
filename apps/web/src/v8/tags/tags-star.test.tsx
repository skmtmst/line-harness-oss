// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const update = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, tags: { ...actual.api.tags, update } } }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
import TagsTab from './tags-tab'
import { FRIEND_ATTRIBUTES_QA_TAGS } from '@/components/friend-fields/tags-page-v4'
import { flushListUrlState } from '@/components/shared/list-url-state'
afterEach(() => { cleanup(); update.mockReset() })

// オーナー 2026-10-09：星の切り替え・取り消しを廃止し、星が出ないことを守る。
for (const canEdit of [true, false]) {
  for (const narrow of [true, false]) {
    it(`星の値によらず列・印・操作を出さない（編集=${canEdit}・狭い幅=${narrow}）`, () => {
      const items = [
        { ...FRIEND_ATTRIBUTES_QA_TAGS[0], isStarred: true },
        { ...FRIEND_ATTRIBUTES_QA_TAGS[1], isStarred: false },
      ]
      const { container } = render(<TagsTab accountId="account-1" fixture={{ items, groups: [] }} canEdit={canEdit} narrow={narrow} csvOpen={false} onCsvClose={() => {}} />)
      expect(container.querySelector('thead th')?.textContent).toBe('タグ')
      expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
      expect(container.querySelectorAll('tbody tr')[0].querySelector('td')?.textContent).toContain(items[0].name)
      expect(container.querySelector('svg.lucide-star')).toBeNull()
      expect(screen.queryByText('一覧に出す')).toBeNull()
      expect(screen.queryAllByLabelText(/友だち一覧に表示/)).toHaveLength(0)
      for (const row of container.querySelectorAll('tbody tr')) fireEvent.click(row)
      expect(update).not.toHaveBeenCalled()
    })
  }
}

it('古い星だけの絞り込みURLでも星の値によらず全行を出す', () => {
  flushListUrlState()
  const originalUrl = window.location.href
  window.history.replaceState(null, '', '/tags?quick=starred')
  try {
    const items = [
      { ...FRIEND_ATTRIBUTES_QA_TAGS[0], isStarred: true },
      { ...FRIEND_ATTRIBUTES_QA_TAGS[1], isStarred: false },
    ]
    const { container } = render(<TagsTab accountId="account-1" fixture={{ items, groups: [] }} canEdit narrow={false} csvOpen={false} onCsvClose={() => {}} />)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'よく使う絞り込み' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /件選択中/ })).toBeNull()
    expect(update).not.toHaveBeenCalled()
  } finally {
    cleanup()
    window.history.replaceState(null, '', originalUrl)
  }
})
