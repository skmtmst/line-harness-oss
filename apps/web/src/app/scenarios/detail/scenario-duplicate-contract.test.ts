import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * 機能5（シナリオ配信）の複製2操作の再発防止。
 *
 * 通の複製：後ろの通をずらさず同じ番号で足すと、口が 409 を返すのに
 * 例外にならず、読み直すだけで何も起きない。
 * シナリオの複製：時刻・絞り込み・質問を落とすと、400 で全体が失敗するか
 * 別物の流れになる。
 */

const DETAIL = fs.readFileSync(path.join(__dirname, 'scenario-detail-client.tsx'), 'utf8')

/** `start` から `end` までの範囲だけを切り出す。見つからなければ失敗する。 */
function slice(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  if (from < 0) throw new Error(`切り出しの始まりが見つかりません: ${start}`)
  const to = source.indexOf(end, from + start.length)
  if (to < 0) throw new Error(`切り出しの終わりが見つかりません: ${end}`)
  return source.slice(from, to + end.length)
}

function duplicateStep(): string {
  return slice(DETAIL, 'const handleDuplicateStep', '\n  }\n')
}

function duplicateScenario(): string {
  return slice(DETAIL, 'const handleDuplicate =', '\n  }\n')
}

describe('通の複製は後ろをずらしてから足す', () => {
  it('後ろの通を reorderSteps で +1 ずらす', () => {
    const body = duplicateStep()
    expect(body).toContain('api.scenarios.reorderSteps(')
    expect(body).toContain('st.stepOrder + 1')
  })

  it('addStep の成否を見て、失敗時は通のエラーに出す', () => {
    const body = duplicateStep()
    expect(body).toContain('const res = await api.scenarios.addStep(id, {')
    expect(body).toContain('if (!res.success)')
    expect(body).toContain('setStepError(res.error)')
  })

  it('時刻・絞り込み・質問・下書きの別まで写す', () => {
    const body = duplicateStep()
    for (const field of [
      'delayMinutes: step.delayMinutes',
      'offsetDays: step.offsetDays',
      'deliveryTime: step.deliveryTime',
      'targetCondition:',
      'question:',
      'isDraft: step.isDraft',
    ]) {
      expect(body, `${field} が複製に含まれていません`).toContain(field)
    }
  })
})

describe('シナリオの複製は通の中身を落とさない', () => {
  it('時刻・絞り込み・質問・下書きの別まで写す', () => {
    const body = duplicateScenario()
    for (const field of [
      'delayMinutes: step.delayMinutes',
      'offsetDays: step.offsetDays',
      'deliveryTime: step.deliveryTime',
      'targetCondition:',
      'question:',
      'isDraft: step.isDraft',
    ]) {
      expect(body, `${field} が複製に含まれていません`).toContain(field)
    }
  })

  it('1通でも失敗したら中断し、理由を出す', () => {
    const body = duplicateScenario()
    expect(body).toContain('if (!copied.success) throw new Error(copied.error)')
    expect(body).toContain('e instanceof Error')
  })
})
