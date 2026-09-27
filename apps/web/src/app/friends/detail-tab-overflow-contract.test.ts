import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'detail', 'page.tsx'), 'utf8')

/*
 * ★V7差し戻し: 折らないタブ帯がグリッド右列の min-content を押し広げ、
 * 右列が画面右端からはみ出して切れていた。幅の決定はグリッドに任せ、
 * タブ帯だけ中で横に流す。3点がそろっていないと静かに戻る。
 */
describe('友だち詳細のタブ帯は右列を押し広げない', () => {
  it('グリッドの右列（data-design="Right"）は min-w-0 を持つ', () => {
    // タブ帯とパネルの縦間隔は親の gap-4 にそろえる（m13h。min-w-0 の意図は変えない）。
    expect(PAGE).toContain('data-design="Right" className="flex min-w-0 flex-col gap-4"')
  })

  it('タブ帯は折り返さず横スクロールする', () => {
    expect(PAGE).toContain('flex gap-1 overflow-x-auto border-b')
    expect(PAGE).not.toContain('flex flex-wrap gap-1 border-b')
  })

  it('タブは1行に保ち、開いているタブの印を持つ', () => {
    expect(PAGE).toContain('whitespace-nowrap')
    expect(PAGE).toContain('aria-current={tab === t.key')
  })
})
