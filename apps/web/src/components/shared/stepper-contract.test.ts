import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const SHARED = path.join(__dirname, 'stepper.tsx')
const BROADCAST = path.join(__dirname, '..', 'broadcasts', 'broadcast-step-rail.tsx')

/** 注釈を落とす。「なぜ出したか」を書いた文が、自分の見張りに当たらないように。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 手順は共通の Stepper 1本（★V7 共通部品その2 §4）。
 * 旧 StepRail / StepTrail の入口は消し、呼ぶ側は Stepper を直接使う。
 *
 * 設計 `LMiL2` の段の帯は、**15枚の作成画面に同じものが置いてある**
 * ——リマインダ・自動応答・友だち追加時・ウェビナー・リッチメニュー・シナリオ。
 */
describe('手順の進み表示は共通の Stepper', () => {
  it('shared に在る', () => {
    expect(fs.existsSync(SHARED), 'shared/stepper.tsx が無い').toBe(true)
  })

  it('旧 StepRail / StepTrail の入口が残っていない', () => {
    expect(fs.existsSync(path.join(__dirname, 'step-rail.tsx')), 'step-rail.tsx が残っている').toBe(false)
    expect(fs.existsSync(path.join(__dirname, 'step-trail.tsx')), 'step-trail.tsx が残っている').toBe(false)
  })

  it('配信の部品は、共通部品へ渡すだけにする', () => {
    const broadcast = code(fs.readFileSync(BROADCAST, 'utf8'))
    expect(broadcast).toContain("import Stepper from '@/components/shared/stepper'")
    expect(broadcast).toContain('<Stepper label="配信作成の進み" steps={steps} />')
    expect(broadcast, '描き方を配信側に残さない').not.toContain('STEP {step.order}')
  })

  it('済みの段を押すと、その節へ飛ぶ', () => {
    /*
      **段だけ描いて飛べないと、上に帯があるのに何もできない飾りになる。**
      押して戻れるのは済みの段だけ（★V7 その2 §4）。
    */
    const shared = code(fs.readFileSync(SHARED, 'utf8'))
    expect(shared).toContain("document.getElementById(step.anchor)?.scrollIntoView")
    expect(shared).toContain("step.state === 'done'")
  })

  it('何の進みかを言う', () => {
    /* aria-label を固定しない。呼ぶ側が何の進みかを渡す。 */
    const shared = code(fs.readFileSync(SHARED, 'utf8'))
    expect(shared, 'aria-label を固定しない').toContain('aria-label={label}')
    const broadcast = code(fs.readFileSync(BROADCAST, 'utf8'))
    expect(broadcast).toContain('label="配信作成の進み"')
  })

  it('番号と名前で段を出す（★V7 その2 §4）', () => {
    /*
     * 旧V6の「STEP 1」接頭辞は付けない。★V7 の手順は丸の中の番号＋名前だけ。
     */
    const stepper = code(fs.readFileSync(SHARED, 'utf8'))
    expect(stepper).toContain('step.order')
    expect(stepper).not.toContain('STEP ')
  })
})
