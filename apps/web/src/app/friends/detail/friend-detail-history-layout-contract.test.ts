import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(__dirname, 'page.tsx'), 'utf8')

/**
 * Issue #1015 CHK-04（#985 の対応を固定）:
 * 友だち詳細「最近の履歴」を 390px でも読める形にする。
 *
 * - 140+160+140px の固定4列は md 以上だけ。狭い幅は見出しを畳み、
 *   各行は折り返すカードにする（日時・種別・内容・アカウントが読める）。
 * - 「すべてを見る」は実際の履歴タブへつなげる。
 */
describe('CHK-04 友だち詳細「最近の履歴」の狭幅表示', () => {
  it('固定4列は md 以上だけ。狭い幅は見出しを畳み各行カードにする', () => {
    // 見出し行は md 未満で消す（hidden ... md:grid）。
    expect(PAGE).toContain('hidden border-y px-4 py-3 text-xs font-semibold text-ink-faint md:grid')
    expect(PAGE).toContain('hidden border-b px-4 py-3 text-xs font-semibold text-ink-faint md:grid')
    // 各行は flex-wrap のカード。本文は行いっぱいに折り返す。
    expect(PAGE).toContain('flex flex-wrap items-baseline gap-x-3 gap-y-1')
    expect(PAGE).toContain('min-w-0 flex-1 basis-full md:basis-auto')
  })

  it('「すべてを見る」は実際の履歴タブへつながる', () => {
    expect(PAGE).toContain('&tab=history')
    // 履歴タブは追加の履歴をカーソルで読む。
    expect(PAGE).toContain('historyNextCursor')
  })
})
