// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SegmentCondition } from '@/lib/segment-condition'

vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: 'account-a' }) }))
vi.mock('@/lib/use-feature-visibility', () => ({ useFeatureVisibility: () => ({ enabled: () => true }) }))
import ConditionBuilder from './condition-builder'
import { pickEntities } from './entity-picker-test-helpers'

afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

it('条件のタグは窓で選び、選んだ札の×で外しても条件を保つ', async () => {
  document.documentElement.dataset.theme = 'v8'
  const seen = vi.fn()
  const options = { tags: [{ id: 'vip', name: 'VIP', color: '#228855' }, { id: 'member', name: '会員' }], scenarios: [] }
  function Harness() {
    const [value, setValue] = useState<SegmentCondition>({ operator: 'AND', rules: [{ type: 'tag_all', value: ['vip'] }], groups: [] })
    return <ConditionBuilder value={value} showCount={false} options={options} onChange={(next) => { seen(next); setValue(next!) }} />
  }
  render(<Harness />)
  expect(screen.getByText('VIP')).toBeTruthy()
  await pickEntities('条件のタグ', ['会員'])
  expect(seen.mock.lastCall?.[0].rules[0]).toEqual({ type: 'tag_all', value: ['vip', 'member'] })
  fireEvent.click(screen.getByRole('button', { name: 'VIPを外す' }))
  expect(seen.mock.lastCall?.[0].rules[0]).toEqual({ type: 'tag_all', value: ['member'] })
  expect(screen.queryByText('VIP')).toBeNull()
})
