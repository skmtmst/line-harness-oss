/*
 * SPEC-7 更新履歴の画面：1回の更新＝1枚の区切り・「最新」・3行のまとめ。
 */
import { describe, expect, it } from 'vitest'
import { buildUpdateCards, missingLineCount, pickHighlights, toJstIso, toTime, type Deployment } from './history-updates'

const staging = (deploymentId: string, occurredAt: string, phase: Deployment['phase'] = 'succeeded', version: string | null = '0.26.0'): Deployment => ({
  deploymentId, phase, environment: 'staging', version, pullRequest: null, actor: 'github-actions', occurredAt,
})
const line = (kind: string, text: string, at: string) => ({ kind, text, by: 'kenta', pr: 1, at })

describe('1回の区切り（検証への配備1回ごと・記録の無い所は日本時間の日ごと）', () => {
  const summary = {
    releases: [{
      version: '0.26.0', released: '2026-10-25 18:00', entries: [
        line('fixed', '前の配備より前の行', '2026-10-20T10:00'),
        line('added', '1回目と2回目の間の行', '2026-10-22T10:00'),
        line('changed', '2回目の直前の行', '2026-10-23T08:00'),
        line('fixed', '最後の配備より後の行', '2026-10-25T09:00'),
      ],
    }],
  }
  // 1回目 10-21 12:00 JST、2回目 10-23 12:00 JST（記録は UTC）。
  const deployments = [staging('dep-2', '2026-10-23T03:00:00Z'), staging('dep-1', '2026-10-21T03:00:00Z')]
  const cards = buildUpdateCards({ summary, deployments, runningVersion: '0.26.0' })

  it('配備と配備の間の行は、後の配備の1枚に入る', () => {
    const second = cards.find((card) => card.key === 'deployment|dep-2')
    expect(second?.entries.map((entry) => entry.text)).toEqual(['2回目の直前の行', '1回目と2回目の間の行'])
    expect(second?.at).toBe('2026-10-23T12:00+09:00')
    expect(cards.find((card) => card.key === 'deployment|dep-1')?.entries).toEqual([])
  })

  it('最初の配備より前・最後の配備より後の行は日本時間の日ごとの1枚にする', () => {
    expect(cards.find((card) => card.key === 'day|2026-10-20|0.26.0')?.entries.map((entry) => entry.text)).toEqual(['前の配備より前の行'])
    expect(cards.find((card) => card.key === 'day|2026-10-25|0.26.0')?.entries.map((entry) => entry.text)).toEqual(['最後の配備より後の行'])
  })

  it('新しい順に並び、日付は日本時間の正しい値', () => {
    expect(cards.map((card) => card.at)).toEqual(['2026-10-25T09:00+09:00', '2026-10-23T12:00+09:00', '2026-10-21T12:00+09:00', '2026-10-20T10:00+09:00'])
  })

  it('配備の記録が無いときは日ごとに区切り、版の並びは出る', () => {
    const byDay = buildUpdateCards({ summary, deployments: [] })
    expect(byDay.map((card) => card.key)).toEqual(['day|2026-10-25|0.26.0', 'day|2026-10-23|0.26.0', 'day|2026-10-22|0.26.0', 'day|2026-10-20|0.26.0'])
  })

  it('失敗した配備・本番の配備は区切りにせず、結果の1枚として残す', () => {
    const withFailed = buildUpdateCards({ summary, deployments: [staging('bad', '2026-10-22T23:00:00Z', 'failed'), ...deployments] })
    expect(withFailed.find((card) => card.key === 'deployment|bad')?.entries).toEqual([])
    expect(withFailed.find((card) => card.key === 'deployment|dep-2')?.entries).toHaveLength(2)
  })

  it('本番の配備は区切りにせず、検証の配備の回の行を取らない', () => {
    const production = { ...staging('prod', '2026-10-22T23:00:00Z'), environment: 'production' }
    const withProduction = buildUpdateCards({ summary, deployments: [production, ...deployments] })
    expect(withProduction.find((card) => card.key === 'deployment|prod')?.entries).toEqual([])
    expect(withProduction.find((card) => card.key === 'deployment|dep-2')?.entries).toHaveLength(2)
  })
})

describe('「最新」の印', () => {
  const summary = { releases: [
    { version: '0.26.0', released: '2026-10-25 18:00', entries: [line('fixed', '新', '2026-10-25T09:00')] },
    { version: '0.25.0', released: '2026-10-14 02:05', entries: [line('fixed', '旧', '2026-10-13T09:00')] },
  ] }

  it('今動いている版と同じ版のいちばん新しい1枚だけに付く', () => {
    const cards = buildUpdateCards({ summary, deployments: [], runningVersion: 'v0.26.0' })
    expect(cards.filter((card) => card.latest).map((card) => card.version)).toEqual(['0.26.0'])
    expect(cards[0].latest).toBe(true)
  })

  it('今の版が古い版なら、その版の1枚に付き、上の新しい回には付かない', () => {
    const cards = buildUpdateCards({ summary, deployments: [], runningVersion: '0.25.0' })
    expect(cards.map((card) => card.latest)).toEqual([false, true])
  })

  it('今の版が分からなければ、どの1枚にも付けない', () => {
    expect(buildUpdateCards({ summary, deployments: [], runningVersion: null }).some((card) => card.latest)).toBe(false)
  })

  it('失敗した配備の1枚には付けない', () => {
    const cards = buildUpdateCards({ summary, deployments: [staging('bad', '2026-10-26T00:00:00Z', 'failed')], runningVersion: '0.26.0' })
    expect(cards[0].key).toBe('deployment|bad')
    expect(cards[0].latest).toBe(false)
    expect(cards.filter((card) => card.latest)).toHaveLength(1)
  })

  it('次回反映予定の1枚はいちばん上に出し、「最新」は付けない', () => {
    const cards = buildUpdateCards({ summary: { ...summary, releases: [{ version: 'unreleased', released: null, entryCount: 188, entries: [] }, ...summary.releases], pending: { entryCount: 188, counts: { added: 100, changed: 50, fixed: 38 } } }, deployments: [], runningVersion: '0.26.0' })
    expect(cards[0]).toMatchObject({ source: 'pending', latest: false, entryCount: 188, counts: { added: 100, changed: 50, fixed: 38 } })
    expect(cards[1].latest).toBe(true)
  })
})

describe('3行のまとめ', () => {
  const entries = [
    line('changed', '変更・新', '2026-10-25T10:00'),
    line('added', '追加・旧', '2026-10-24T10:00'),
    line('fixed', '修正・旧', '2026-10-23T10:00'),
    line('added', '追加・新', '2026-10-25T09:00'),
    line('fixed', '修正・新', '2026-10-25T08:00'),
  ]

  it('人が書いた highlights が無い版は「修正→追加→変更」の新しい順の3行', () => {
    expect(pickHighlights(entries)).toEqual(['修正・新', '修正・旧', '追加・新'])
  })

  it('行が2行しか無い回は2行のまま（作り物で埋めない）', () => {
    expect(pickHighlights(entries.slice(0, 2))).toEqual(['追加・旧', '変更・新'])
  })

  it('人が書いた highlights がある版は、その3行をその版のいちばん新しい1枚にだけ出す', () => {
    const cards = buildUpdateCards({
      summary: {
        releases: [{ version: '0.26.0', released: '2026-10-25 18:00', entries }],
        updates: [{ version: '0.26.0', source: 'day', highlights: ['まとめ1', 'まとめ2', 'まとめ3', 'まとめ4'] }],
      },
      deployments: [],
    })
    expect(cards[0]).toMatchObject({ highlights: ['まとめ1', 'まとめ2', 'まとめ3'], highlightSource: 'written' })
    expect(cards.slice(1).every((card) => card.highlightSource !== 'written')).toBe(true)
  })

  it('壊れた highlights（並びでない・空の行）は無視して行から選ぶ', () => {
    const cards = buildUpdateCards({
      summary: {
        releases: [{ version: '0.26.0', released: '2026-10-25 18:00', entries: entries.slice(0, 1) }],
        updates: [{ version: '0.26.0', highlights: '1行で書いた' }, { version: '0.26.0', highlights: ['', 3] }],
      },
      deployments: [],
    })
    expect(cards[0]).toMatchObject({ highlights: ['変更・新'], highlightSource: 'entries' })
  })

  it('種類ごとの数は、その回の行から数える', () => {
    const [card] = buildUpdateCards({ summary: { releases: [{ version: '0.26.0', released: '2026-10-25 18:00', entries: entries.filter((entry) => entry.at.startsWith('2026-10-25')) }] }, deployments: [] })
    expect(card.counts).toEqual({ added: 1, changed: 1, fixed: 1 })
    expect(card.entryCount).toBe(3)
  })
})

describe('保管用の版（summary: false）', () => {
  const archive = { version: '0.25.0', released: '2026-10-14 02:05', entryCount: 5707, entries: [] }

  it('要約に行が無くても「保管用の版」の1枚として行の数を出す', () => {
    const cards = buildUpdateCards({ summary: { releases: [archive] }, deployments: [] })
    expect(cards).toEqual([expect.objectContaining({ source: 'archive', version: '0.25.0', entryCount: 5707, highlights: [], at: '2026-10-14T02:05+09:00' })])
  })

  it('台本が保管用と印を付けた版は、その種類の数を使い、要約に残る行で日を割らない', () => {
    const cards = buildUpdateCards({
      summary: { releases: [{ ...archive, entries: [line('fixed', '残った行', '2026-10-13T10:00')] }], updates: [{ version: '0.25.0', source: 'archive', counts: { added: 1, changed: 2, fixed: 3 } }] },
      deployments: [],
    })
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ source: 'archive', counts: { added: 1, changed: 2, fixed: 3 }, highlights: [] })
  })

  it('画面に持っていない古い行の数を数える（保管用の版と次回反映予定は数えない）', () => {
    expect(missingLineCount({ releases: [
      { version: 'unreleased', released: null, entryCount: 99, entries: [] },
      archive,
      { version: '0.24.0', released: '2026-08-19 15:00', entryCount: 36, entries: [line('fixed', 'a', '2026-08-19T10:00')] },
    ] })).toBe(35)
  })
})

describe('日時の読み方', () => {
  it('反映履歴のオフセット無しの日時は日本時間、配備の記録は UTC として読む', () => {
    expect(toJstIso(toTime('2026-10-25 17:51'))).toBe('2026-10-25T17:51+09:00')
    expect(toJstIso(toTime('2026-10-25T08:51:00Z'))).toBe('2026-10-25T17:51+09:00')
    expect(toJstIso(toTime('2026-10-25'))).toBe('2026-10-25T00:00+09:00')
    expect(toJstIso(toTime('壊れた日時'))).toBeNull()
  })
})
