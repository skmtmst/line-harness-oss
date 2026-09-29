import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCORE_TAB = readFileSync(join(HERE, 'action-score-tab.tsx'), 'utf8')
const HISTORY_DIALOG = readFileSync(join(HERE, 'action-score-history-dialog.tsx'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')
const SCORING_ROUTE = readFileSync(
  join(HERE, '..', '..', '..', '..', 'worker', 'src', 'routes', 'scoring.ts'),
  'utf8',
)
const DB_SCORING = readFileSync(
  join(HERE, '..', '..', '..', '..', '..', 'packages', 'db', 'src', 'scoring.ts'),
  'utf8',
)
const EVENT_BUS = readFileSync(
  join(HERE, '..', '..', '..', '..', 'worker', 'src', 'services', 'event-bus.ts'),
  'utf8',
)

/*
 * IDEA-17（A 優先実施）の画面・口の約束だけを見る。
 * 台帳の冪等性そのものは worker/db の直接試験が見ている。
 */

describe('IDEA-17：スコアの計算理由を明細からたどれる', () => {
  it('一覧の各行から点数の変化の明細を開ける', () => {
    expect(SCORE_TAB).toContain('点数の変化を見る')
    expect(SCORE_TAB).toContain('ActionScoreHistoryDialog')
    expect(SCORE_TAB).toContain('setHistoryTarget(item)')
  })

  it('明細はいつ・何で・どれだけ・だれが動かしたかを出す', () => {
    expect(HISTORY_DIALOG).toContain('api.scoring.friendScore')
    expect(HISTORY_DIALOG).toContain('点数が変わった理由は未取得')
    expect(HISTORY_DIALOG).toContain('点 →')
    expect(HISTORY_DIALOG).toContain('手で変更')
    expect(HISTORY_DIALOG).toContain('自動で加算')
  })

  it('スコアはマイルと別物として、単位は点・残高は動かさないと断る', () => {
    expect(HISTORY_DIALOG).toContain('マイル残高は増えも減りもしません')
    expect(SCORE_TAB).toContain('スコアはマイルではありません')
  })

  it('口は前後の点数・発生日時・動かした方法まで返す', () => {
    expect(API).toContain('currentScore: number')
    expect(API).toContain('scoreBefore: number | null')
    expect(API).toContain('scoreAfter: number | null')
    expect(API).toContain("mode: 'manual' | 'automatic'")
    expect(SCORING_ROUTE).toContain('occurredAt: h.occurred_at ?? h.created_at')
    expect(SCORING_ROUTE).toContain('scoreBefore: h.score_before')
    expect(SCORING_ROUTE).toContain('executedByStaffName: h.executed_by_staff_name')
    expect(DB_SCORING).toContain('score_before')
    expect(DB_SCORING).toContain('executed_by_staff_name')
  })
})

describe('IDEA-17：同じイベントを再実行してもスコアが二重にならない', () => {
  it('旧ルールの適用にも発生元の不変IDを渡す', () => {
    expect(EVENT_BUS).toContain('execution?.sourceEventId ?? payload.sourceEventId')
    expect(EVENT_BUS).toContain('applyScoring(db, payload.friendId, eventType, scoreSourceEventId)')
  })
})
