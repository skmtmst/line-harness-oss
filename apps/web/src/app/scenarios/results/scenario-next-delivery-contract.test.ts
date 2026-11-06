import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 「次の配信」が ISO のまま出ていたことがある。
 * 日本時間で出す動きは v8/scenarios/results-loading-and-plan.test.tsx が描いて守る。
 * ここは ISO の値をそのまま出す書き方へ戻さない禁止の見張りだけを残す。
 */
const PAGE = readFileSync(new URL('../../../v8/scenarios/results.tsx', import.meta.url), 'utf8')

describe('シナリオ結果の次の配信の日時表示', () => {
  it('一覧の「次の配信」は既存の整形関数で日本時間にする', () => {
    expect(PAGE).not.toContain(': sub.nextDeliveryAt ?? ')
  })
})
