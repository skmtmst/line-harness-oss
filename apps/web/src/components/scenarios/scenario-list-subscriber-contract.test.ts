import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const LIST = readFileSync(new URL('./scenario-list.tsx', import.meta.url), 'utf8')

describe('シナリオ一覧の購読中人数', () => {
  it('未取得を0人とせず、実測0人だけに開始案内を出す', () => {
    expect(LIST).toContain("s.subscriberCount === undefined ? '—'")
    expect(LIST).toContain('s.subscriberCount === 0 &&')
    expect(LIST).not.toContain('(s.subscriberCount ?? 0) === 0')
  })
})
