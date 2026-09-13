import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const ACTION_SCORE = readFileSync(join(HERE, 'action-score-tab.tsx'), 'utf8')
const HISTORY = readFileSync(join(HERE, 'mileage-history-tab.tsx'), 'utf8')
const NEW_RULE = readFileSync(join(HERE, 'earning-rules', 'new', 'page.tsx'), 'utf8')
const REWARD_EDIT = readFileSync(join(HERE, 'rewards', 'edit', 'page.tsx'), 'utf8')

describe('点検 #511(中)の再発防止(#541)', () => {
  it('CSVのボタンは「この頁だけ」と分かる文にする(#511-4)', () => {
    expect(PAGE).toContain('この頁の残高をCSVで書き出す')
    expect(ACTION_SCORE).toContain('この頁の行動スコアをCSVで書き出す')
    expect(HISTORY).toContain('この頁の履歴をCSVで書き出す')
  })

  it('CSVのセルは数式の頭を無害化する(#511-8)', () => {
    for (const source of [PAGE, ACTION_SCORE, HISTORY]) {
      expect(source).toContain('csvCell(value)')
    }
    expect(PAGE).toContain("import { csvCell } from '@/lib/presentation'")
  })

  it('使い道の日時を端末時刻で往復させる(#511-7)', () => {
    expect(REWARD_EDIT).toContain('localDateTime(version?.startsAt)')
    expect(REWARD_EDIT).toContain('utcDateTime(form.startsAt)')
    expect(REWARD_EDIT).not.toContain('slice(0, 16)')
  })

  it('決めごと作成の下書き失敗時は旧口の行を消す(#511-6)', () => {
    expect(NEW_RULE).toContain('deleteRule(res.data.id)')
    expect(NEW_RULE).toContain('作りかけの決めごと')
  })

  it('決めごとが100件の上限に達したら件数表示で注意する(#511-11)', () => {
    expect(PAGE).toContain('rules.length >= 100')
    expect(PAGE).toContain('100件までしか読み込んでいないため')
  })
})
