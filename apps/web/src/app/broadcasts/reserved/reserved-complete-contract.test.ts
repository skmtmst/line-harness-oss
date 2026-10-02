import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')

/**
 * Issue #1015 CHK-03（#985 の対応を固定）:
 * 一斉配信の予約完了画面を狭い幅でも読める形にする。
 *
 * - 右の390px「次にできること」列は広い幅だけ。狭い幅は1列に畳む。
 * - 人数を数え直せないときは「0人への配信成功」に見せない。
 * - 完了後にその予約へ戻れる。
 */
describe('CHK-03 一斉配信の予約完了画面', () => {
  it('右の補助列は広い幅だけ390pxで、狭い幅は1列に畳む', () => {
    expect(PAGE).toContain('flex flex-col gap-4 lg:flex-row lg:items-start')
    expect(PAGE).toContain('lg:w-97.5')
    // 常時の固定右列へは戻さない。狭い幅で本文が潰れる。
    expect(PAGE).not.toContain('w-[390px]')
    expect(PAGE).not.toContain('width: 390')
  })

  it('人数を数えられないときは「0人の成功」とせず確認できないと伝える', () => {
    expect(PAGE).toContain('audienceCount === null')
    expect(PAGE).toContain('対象人数は現在確認できません')
  })

  it('完了後に予約内容へ戻れる', () => {
    expect(PAGE).toContain('予約内容を確認')
    // 旧詳細（`/broadcasts?id=`）ではなく新しい詳細へ連れていく。
    expect(PAGE).toContain('/broadcasts/detail?id=${encodeURIComponent(broadcast.id)}')
    expect(PAGE).not.toContain('`/broadcasts?id=${encodeURIComponent(broadcast.id)}`')
  })
})
