import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CommonVarDeleteImpact, CommonVarDeleteImpactItem } from '@line-crm/shared'
import { ApiError } from '@/lib/api'
import {
  CHANGE_PREVIEW_SOURCE,
  changeCounts,
  changePreviewNotConnected,
  changeSummaryText,
  hiddenText,
  historicalText,
  immediateItems,
  impactStateFromError,
  impactStateText,
  saveErrorText,
} from './change-impact'

const EDIT = readFileSync(new URL('./edit/page.tsx', import.meta.url), 'utf8')

/**
 * **ファイル全体を `toContain` で見ない。** 画面のどこかに同じ字が
 * あるだけで通ってしまう。保存の関数と影響確認の節を切り出して見る。
 */
function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  expect(from, `${start} が見つからない`).toBeGreaterThan(-1)
  const to = source.indexOf(end, from + start.length)
  expect(to, `${end} が見つからない`).toBeGreaterThan(from)
  return source.slice(from, to)
}

const SAVE_FN = sliceBetween(EDIT, '  const save = async () => {', '  const remove = async () => {')
const IMPACT_SECTION = sliceBetween(EDIT, '<section data-design-node="uNBlA">', '</section>')

function usage(over: Partial<CommonVarDeleteImpactItem> = {}): CommonVarDeleteImpactItem {
  return {
    kind: 'template',
    kindLabel: 'テンプレート',
    name: '来店お礼',
    status: '使われています',
    href: '/templates/edit?id=t1',
    blocksDeletion: true,
    currentPreview: '営業時間は 10:00-19:00 です',
    ...over,
  }
}

function impact(over: Partial<CommonVarDeleteImpact> = {}): CommonVarDeleteImpact {
  return {
    variable: { id: 'cv-1', name: '営業時間', varKey: 'shop_hours' },
    total: 0,
    blockingTotal: 0,
    historicalTotal: 0,
    unscopedFormTotal: 0,
    canDelete: true,
    byKind: {
      template: 0, broadcast: 0, scenario: 0, reminder: 0, auto_reply: 0,
      form: 0, automation: 0, friend_add: 0, common_action: 0,
    },
    items: [],
    unavailableReferences: [],
    checkedAt: '2026-09-02T12:00:00.000+09:00',
    recommendedAction: 'delete',
    ...over,
  }
}

describe('保存が落ちた理由を、運用者の言葉で出す', () => {
  it('権限が足りないときは「操作する権限がありません」と言う', () => {
    const text = saveErrorText(new ApiError(403, 'API error: 403'))
    expect(text).toContain('操作する権限がありません')
    expect(text).toContain('管理者')
  })

  it('対象が見つからないときは、開き直す先を言う', () => {
    const text = saveErrorText(new ApiError(404, 'API error: 404'))
    expect(text).toContain('見つかりませんでした')
    expect(text).toContain('LINEアカウント')
  })

  it('先に別の人が保存していたら、読み直してからと言う', () => {
    expect(saveErrorText(new ApiError(409, 'API error: 409'))).toContain('ほかの人が先に保存しました')
  })

  it('サーバー側の失敗は、待って試すことと連絡先を言う', () => {
    expect(saveErrorText(new ApiError(500, 'API error: 500'))).toContain('時間をおいて')
  })

  it('400はWorkerが書いた日本語をそのまま出す', () => {
    expect(saveErrorText(new ApiError(400, '名前を入力してください'))).toBe('名前を入力してください')
  })

  it('内部の英文（API error: NNN）を画面へ出さない', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 502, 503]) {
      expect(saveErrorText(new ApiError(status, `API error: ${status}`))).not.toContain('API error')
    }
  })

  it('通信そのものが落ちたときは、接続を確かめると言う', () => {
    expect(saveErrorText(new TypeError('Failed to fetch'))).toContain('接続を確かめて')
  })

  it('どの理由でも「保存に失敗しました」だけでは終わらせない', () => {
    const texts = [403, 404, 409, 500].map((s) => saveErrorText(new ApiError(s)))
    for (const text of texts) {
      expect(text).not.toBe('保存に失敗しました')
      expect(text.length).toBeGreaterThan(12)
    }
  })
})

describe('影響確認は、変わる場所と変わらない場所を分ける', () => {
  it('送信済みの分を「すぐ変わる」に混ぜない', () => {
    const counts = changeCounts(impact({ total: 5, blockingTotal: 2, historicalTotal: 3 }))
    expect(counts).toEqual({ immediate: 2, historical: 3, hidden: 0 })
  })

  it('保存すると何か所が変わるかを、差し込み名つきで言う', () => {
    const text = changeSummaryText(impact({ total: 15, blockingTotal: 15 }))
    expect(text).toContain('{{var.shop_hours}}')
    expect(text).toContain('15か所')
    expect(text).toContain('すぐ変わります')
  })

  it('0か所は「どこにも差し込まれていません」。未取得と混ぜない', () => {
    const text = changeSummaryText(impact())
    expect(text).toContain('どこにも差し込まれていません')
    expect(text).not.toContain('—')
  })

  it('送信済みは「変わりません」と必ず書く', () => {
    expect(historicalText(impact({ total: 4, blockingTotal: 1, historicalTotal: 3 })))
      .toContain('3か所は変わりません')
    expect(historicalText(impact())).toBeNull()
  })

  it('名前を出せない使用先も、件数と理由を隠さない', () => {
    const text = hiddenText(impact({
      unscopedFormTotal: 2,
      unavailableReferences: [{
        kind: 'form', kindLabel: '回答フォーム', count: 2,
        reason: '所属するLINEアカウントを確認できないため、名前と内容は表示しません',
      }],
    }))
    expect(text).toContain('回答フォーム2件')
    expect(text).toContain('所属するLINEアカウント')
  })

  it('一覧に出すのは、すぐ変わる使用先だけ', () => {
    const shown = immediateItems(impact({
      items: [usage({ name: '来店お礼' }), usage({ name: '送信済み配信', blocksDeletion: false })],
    }))
    expect(shown.map((i) => i.name)).toEqual(['来店お礼'])
  })
})

describe('取れないものは、取れないと書く', () => {
  it('変更後の文と文字数の検査は、口が無いので未接続と言う', () => {
    expect(changePreviewNotConnected())
      .toBe(`まだ繋がっていません。${CHANGE_PREVIEW_SOURCE}が接続されると表示されます。`)
  })

  it('403は「見る権限がありません」。読み込み失敗と分ける', () => {
    expect(impactStateFromError(new ApiError(403))).toBe('forbidden')
    expect(impactStateFromError(new ApiError(503))).toBe('error')
    expect(impactStateFromError(new TypeError('Failed to fetch'))).toBe('error')
  })

  it('状態ごとの言葉を混ぜない', () => {
    expect(impactStateText('loading')).toBe('読み込んでいます')
    expect(impactStateText('error')).toBe('読み込めませんでした')
    expect(impactStateText('forbidden')).toBe('見る権限がありません')
    expect(impactStateText('ready')).toBeNull()
  })
})

describe('共通情報編集（uNBlA）の画面', () => {
  it('保存の catch は一言で片付けず、理由を作る関数を通す', () => {
    expect(SAVE_FN).toContain('setError(saveErrorText(e))')
    expect(SAVE_FN).not.toContain("setError('保存に失敗しました')")
  })

  it('影響確認の節を必ず出す。読めないときも節ごと消さない', () => {
    expect(IMPACT_SECTION).toContain('影響確認')
    expect(IMPACT_SECTION).toContain('{NOT_AVAILABLE}')
    expect(IMPACT_SECTION).toContain('impactStateText(impactState)')
  })

  it('節の中で、変わる場所・送信済み・変更後の文を書き分ける', () => {
    expect(IMPACT_SECTION).toContain('changeSummaryText(impact)')
    expect(IMPACT_SECTION).toContain('historicalText(impact)')
    expect(IMPACT_SECTION).toContain('changePreviewNotConnected()')
  })

  it('読み込めなかったときだけ再読み込みを出す', () => {
    expect(IMPACT_SECTION).toContain("impactState === 'error'")
    expect(IMPACT_SECTION).toContain('{STATE_TEXT.retry}')
  })

  it('未取得を0か所として描かない', () => {
    expect(IMPACT_SECTION).toContain("impactState !== 'ready' || !impact")
  })
})
