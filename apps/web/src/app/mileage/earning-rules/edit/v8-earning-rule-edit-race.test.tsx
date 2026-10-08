// @vitest-environment happy-dom
/*
 * 監査 W156：たまる決めごとの編集で、前のルールの遅い応答が今のルールの欄に入らない。
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, settle, stubFetchNotFound, type Mounted } from '@/test-utils/race'

const fixture = vi.hoisted(() => ({ id: 'rule-a', pending: [] as Array<{ resolve: (v: unknown) => void }> }))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`id=${fixture.id}`),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/mileage/earning-rules/edit',
}))
vi.mock('@/contexts/account-context', () => ({
  useAccount: () => ({ selectedAccountId: 'account-1', loading: false }),
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      mileage: {
        ...actual.api.mileage,
        earningRulesV6: () => new Promise((resolve) => { fixture.pending.push({ resolve }) }),
      },
    },
  }
})

const { default: V8EarningRuleEdit } = await import('./v8-earning-rule-edit')

function rule(id: string, name: string) {
  return {
    id,
    draftVersion: 1,
    draft: {
      name, eventType: 'manual', source: null, amount: 10, initialStatus: 'available',
      validFrom: null, validUntil: null, expiresAfterDays: null, cancellationEventTypes: [],
      targetConditions: null, sortOrder: 0, notification: { enabled: true, messageTemplate: '' },
    },
  }
}
const listOf = (...items: unknown[]) => ({ success: true, data: { items, pagination: { total: items.length } } })

let view: Mounted
beforeEach(() => {
  fixture.id = 'rule-a'
  fixture.pending = []
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubFetchNotFound()
  view = mount()
})
afterEach(async () => {
  await view.unmount()
  vi.unstubAllGlobals()
})

describe('たまる決めごとの編集（W156）', () => {
  it('A の読み込み中に B へ移り、B の後に A が届いても欄は B のまま', async () => {
    await view.render(<V8EarningRuleEdit />)
    await settle()
    const first = fixture.pending[0]
    fixture.id = 'rule-b'
    await view.render(<V8EarningRuleEdit />)
    await settle()
    const second = fixture.pending[fixture.pending.length - 1]
    expect(second).not.toBe(first)
    second.resolve(listOf(rule('rule-a', 'Aのルール'), rule('rule-b', 'Bのルール')))
    await settle()
    first.resolve(listOf(rule('rule-a', 'Aのルール'), rule('rule-b', 'Bのルール')))
    await settle()
    const input = view.host.querySelector<HTMLInputElement>('input[aria-label="ルール名"]')
    expect(input?.value).toBe('Bのルール')
  })
})
