/*
 * 共通部品を通らない直書きを、**これ以上増やさない**ための試験。
 *
 * `raw-colors.test.ts` は生の色だけを見る。こちらはその隣で、
 * 任意値記法・直書きの表見出し・直書きのボタン・静的に読めない `className` を見る。
 *
 * どれも「規格から外れているのに、普通のコードに見える」ものばかりで、
 * 目で見ても間違いに気づけない。数で止める。
 *
 * 直し方:
 *
 *     node apps/web/scripts/design-debt.mjs --update
 *
 * `display-class-on-part` だけは基準値ではなく **0 固定**。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  countDebt,
  compare,
  totals,
  analyzeSource,
  isDisplayClass,
  ZERO_TOLERANCE,
  BASELINE,
  SRC,
} from '../../scripts/design-debt.mjs'

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, Record<string, number>>
const { counts } = countDebt()
const { worse, better } = compare(counts, baseline)

describe('共通部品を通らない直書き', () => {
  it('design-parts.jsonに登録した正本部品自身は負債へ数えない', () => {
    for (const file of [
      'components/app-shell.tsx',
      'components/shared/button.tsx',
      'components/shared/pagination.tsx',
      'components/shared/summary-card.tsx',
      'components/shared/table.tsx',
    ]) {
      expect(counts).not.toHaveProperty(file)
    }
  })

  it('増えていない', () => {
    // 落ちたら: 共通部品を使うか、意図があるなら
    // node apps/web/scripts/design-debt.mjs --update で基準を更新してください。
    expect(worse).toEqual({})
  })

  it('減ったら基準も締め直されている', () => {
    // 締め直さないと、また増える余地が残る。
    expect(better).toEqual({})
  })

  it('共通部品へ表示制御のクラスを渡していない', () => {
    // 部品のCSSはカスケードレイヤーに属さないので Tailwind につねに勝つ。
    // `className="hidden"` は**エラーも出さずに無視される**。
    // 表示の切り替えは HTML の hidden 属性で行う
    // （Tailwind base の `[hidden]{display:none!important}` が効く）。
    const sum = totals(counts) as Record<string, number>
    for (const key of ZERO_TOLERANCE as string[]) {
      expect(sum[key] ?? 0, `${key} は0でなければなりません`).toBe(0)
    }
  })
})

describe('表示制御クラスの見分け方', () => {
  it('前置きが何段あっても、重要度の印が前でも後ろでも基底で判断する', () => {
    // 前置きを列挙すると、重ねがけや新しい前置きを見逃す。
    // 重要度の印は Tailwind v3 が先頭、v4 が末尾。
    for (const name of [
      'hidden',
      'md:hidden',
      'md:max-lg:hidden',
      'peer-checked:hidden',
      'data-[open]:hidden',
      'group-has-[:checked]:flex',
      '!hidden',
      'hidden!',
      'md:flex!',
      'dark:lg:inline-flex',
    ]) {
      expect(isDisplayClass(name), `${name} を見逃しています`).toBe(true)
    }
  })

  it('似ているだけのものは拾わない', () => {
    for (const name of ['overflow-hidden', 'hidden-thing', 'flex-1', 'table-fixed', 'blocked']) {
      expect(isDisplayClass(name), `${name} を誤って拾っています`).toBe(false)
    }
  })
})

describe('共通部品の見分け方', () => {
  // 実在するファイルを共通部品に見立てて、import の行き先で判断できるか見る。
  const partFile = join(SRC, 'components', 'shared', 'confirm-dialog.tsx')
  const parts = new Set([partFile])
  const probe = join(SRC, 'app', '__probe.tsx')
  const countOf = (text: string) =>
    (analyzeSource(probe, text, parts) as Record<string, number>)['display-class-on-part'] ?? 0

  it('既定のimport名で検知する', () => {
    expect(
      countOf(`import ConfirmDialog from '@/components/shared/confirm-dialog'
export default () => <ConfirmDialog className="hidden" />`),
    ).toBe(1)
  })

  it('default importに別名を付けても検知する', () => {
    // 名前を決め打ちにすると、ここで検査をすり抜けられる。
    expect(
      countOf(`import SharedDialog from '@/components/shared/confirm-dialog'
export default () => <SharedDialog className="md:hidden" />`),
    ).toBe(1)
  })

  it('名前付きimportの as でも検知する', () => {
    expect(
      countOf(`import { default as Renamed } from '@/components/shared/confirm-dialog'
export default () => <Renamed className="lg:block" />`),
    ).toBe(1)
  })

  it('名前空間importでも検知する', () => {
    expect(
      countOf(`import * as Parts from '@/components/shared/confirm-dialog'
export default () => <Parts.Thing className="hidden" />`),
    ).toBe(1)
  })

  it('相対パスのimportでも検知する', () => {
    expect(
      countOf(`import D from '../components/shared/confirm-dialog'
export default () => <D className="hidden" />`),
    ).toBe(1)
  })

  it('同じ名前でも別のファイルからのimportなら拾わない', () => {
    expect(
      countOf(`import ConfirmDialog from '@/components/shared/folder-panel'
export default () => <ConfirmDialog className="hidden" />`),
    ).toBe(0)
  })

  it('表示制御でないクラスは拾わない', () => {
    expect(
      countOf(`import D from '@/components/shared/confirm-dialog'
export default () => <D className="w-full overflow-hidden" />`),
    ).toBe(0)
  })
})
