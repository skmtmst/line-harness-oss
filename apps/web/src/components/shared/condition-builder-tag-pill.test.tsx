// @vitest-environment happy-dom
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SegmentCondition } from '@/lib/segment-condition'

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a' }) }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => true }) }))
import ConditionBuilder from './condition-builder'

afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

it('V8 の条件づくりは選択・未選択どちらも札で、付け外しの条件を保つ', async () => {
  document.documentElement.dataset.theme = 'v8'
  const seen = vi.fn()
  const options = { tags: [{ id: 'vip', name: 'VIP', color: '#228855' }, { id: 'member', name: '会員' }], scenarios: [] }
  function Harness() {
    const [value, setValue] = useState<SegmentCondition>({ operator: 'AND', rules: [{ type: 'tag_all', value: ['vip'] }], groups: [] })
    return <ConditionBuilder value={value} showCount={false} options={options} onChange={(next) => { seen(next); setValue(next!) }} />
  }
  render(<Harness />)
  const vip = await screen.findByRole('button', { name: 'VIP', pressed: true })
  expect(vip.querySelector<HTMLElement>('[aria-hidden="true"]')?.style.backgroundColor).toBe('#228855')
  fireEvent.click(screen.getByRole('button', { name: '会員', pressed: false }))
  expect(seen.mock.lastCall?.[0].rules[0]).toEqual({ type: 'tag_all', value: ['vip', 'member'] })
  fireEvent.click(vip)
  expect(seen.mock.lastCall?.[0].rules[0]).toEqual({ type: 'tag_all', value: ['member'] })
  expect(screen.getByRole('button', { name: 'VIP', pressed: false })).toBeTruthy()
})
