import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { broadcastSaveProblem, broadcastStepPassed, broadcastStepProblems } from './broadcast-step-gate'
import { TITLE_MAX } from './broadcast-form-model'

/**
 * 作成画面の5段（設計 `LMiL2`）の判定と、段の禁止の見張り。
 *
 * 帯を描くこと・いまいる段・段の飛び先の節・「n / 60文字」・予約の注意書きは
 * broadcast-form-steps-react.test.tsx が、帯の済みと保存の検査が同じ結果を読むことは
 * broadcast-form-step-gate-react.test.tsx が、段の定義の順と呼び名は broadcast-steps.test.ts が見る。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const FORM = readUiSource(join(HERE, 'broadcast-form.tsx'), 'utf8')

/**
 * JSX のコメントを落とす。
 *
 * 「この語を出さない」を見るときにコメントごと数えると、**なぜ出さないかを
 * 書いた注記そのものに引っかかる**。画面に出る文だけを見る。
 */
function withoutComments(source: string): string {
  return source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('作成画面の5段の帯（設計 LMiL2）', () => {
  it('送信設定は「今すぐ」か、日付と時刻がそろって初めて済みになる', () => {
    const base = { title: '配信', titleMax: TITLE_MAX, audienceProblem: '', bubbleProblem: '', buttonProblem: '', lengthProblem: null, scheduledTime: '10:00', now: 0, quotaInsufficient: false, stepped: true }
    expect(broadcastStepPassed(broadcastStepProblems({ ...base, sendMode: 'now', scheduledDate: '', scheduledAt: null }), 'schedule')).toBe(true)
    expect(broadcastStepPassed(broadcastStepProblems({ ...base, sendMode: 'scheduled', scheduledDate: '', scheduledAt: null }), 'schedule')).toBe(false)
    expect(broadcastStepPassed(broadcastStepProblems({ ...base, sendMode: 'scheduled', scheduledDate: '2026-11-01', scheduledAt: '2026-11-01T01:00:00.000Z' }), 'schedule')).toBe(true)
  })
})

describe('配信名の字数（設計 zZ9fA）', () => {
  /** 数えるだけで止めないと、上限を超えたまま保存できてしまう。 */
  it('上限を超えたら保存の検査で止める', () => {
    const base = { titleMax: TITLE_MAX, audienceProblem: '', bubbleProblem: '', buttonProblem: '', lengthProblem: null, sendMode: 'now' as const, scheduledDate: '', scheduledTime: '10:00', scheduledAt: null, now: 0, quotaInsufficient: false, stepped: true }
    expect(broadcastSaveProblem(broadcastStepProblems({ ...base, title: 'あ'.repeat(TITLE_MAX + 1) }))).toBe(`配信名は${TITLE_MAX}文字までにしてください`)
    expect(broadcastSaveProblem(broadcastStepProblems({ ...base, title: 'あ'.repeat(TITLE_MAX) }))).toBe('')
  })
})

describe('予約の注意書き（設計 Bw0zt）', () => {
  it('予約の注意書きで、この画面で読めない送信枠を約束しない', () => {
    const start = FORM.indexOf("{sendMode === 'scheduled' && (")
    expect(start).toBeGreaterThan(-1)
    const scheduled = withoutComments(FORM.slice(start, FORM.indexOf('htmlFor="bc-spread"', start)))
    // 送信枠を読む口がこの画面には無い。出せない数を約束しない。
    expect(scheduled).not.toContain('送信枠')
  })
})
