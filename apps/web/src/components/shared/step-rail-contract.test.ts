import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SHARED = path.join(__dirname, 'step-rail.tsx')
const BROADCAST = path.join(__dirname, '..', 'broadcasts', 'broadcast-step-rail.tsx')

/** 注釈を落とす。「なぜ出したか」を書いた文が、自分の見張りに当たらないように。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 設計 `LMiL2` の段の帯は、**15枚の作成画面に同じものが置いてある**
 * ——リマインダ・自動応答・友だち追加時・ウェビナー・リッチメニュー・シナリオ。
 *
 * 部品は `components/broadcasts/` にあり、配信でしか使えなかった。
 * `shared/` へ出したので、ほかの機能からも同じ帯を出せる。
 */
describe('段の進み表示は共通部品', () => {
  it('shared に在る', () => {
    expect(fs.existsSync(SHARED), 'shared/step-rail.tsx が無い').toBe(true)
  })

  it('配信の部品は、共通部品へ渡すだけにする', () => {
    const broadcast = code(fs.readFileSync(BROADCAST, 'utf8'))
    expect(broadcast).toContain("import StepRail from '@/components/shared/step-rail'")
    expect(broadcast, '描き方を配信側に残さない').not.toContain('STEP {step.order}')
  })

  it('段を押すと、その節へ飛ぶ', () => {
    /*
      **段だけ描いて飛べないと、上に帯があるのに何もできない飾りになる。**
    */
    const shared = code(fs.readFileSync(SHARED, 'utf8'))
    expect(shared).toContain("document.getElementById(step.anchor)?.scrollIntoView")
  })

  it('何の進みかを言う', () => {
    const shared = code(fs.readFileSync(SHARED, 'utf8'))
    expect(shared, 'aria-label を固定しない').toContain('aria-label={ariaLabel}')
    const broadcast = code(fs.readFileSync(BROADCAST, 'utf8'))
    expect(broadcast).toContain('ariaLabel="配信作成の進み"')
  })

  it('設計の言い方で「STEP 1」と出す', () => {
    const shared = code(fs.readFileSync(SHARED, 'utf8'))
    expect(shared).toContain('STEP {step.order}')
  })
})
