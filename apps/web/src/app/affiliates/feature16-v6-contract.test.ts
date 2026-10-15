import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const read = (name: string) => readFileSync(new URL(`../../v8/affiliates/${name}`, import.meta.url), 'utf8')
const AFFILIATORS = read('affiliators.tsx')
const APPROVALS = read('approvals.tsx')
const DRAWER = read('drawer.tsx')
const DISPLAY = read('display.ts')
const NEW_AFFILIATE = read('create.tsx')
const ACTION_DIALOGS = read('dialogs.tsx')
const FLOW = read('monthly-flow.tsx')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')

describe('機能16 現役V8の一覧', () => {
  it('紹介者一覧は検索・絞り込み・CSV・ページ送りと今月の流れを持つ', () => {
    for (const word of ['名前・紹介コード', 'CSV', '<FilterChip', '<Pagination', '<MonthlyFlow']) expect(AFFILIATORS).toContain(word)
    expect(FLOW).toContain('今月の成果の流れ')
    expect(FLOW).toContain('api.affiliates.paymentSummaries(accountId)')
    expect(FLOW).toContain('api.affiliates.settlementPreview(accountId, period)')
    expect(FLOW).toContain("row.value === null ? '—'")
  })

  it('成果承認は全状態を読み、確認不要だけをまとめて承認する', () => {
    expect(APPROVALS).toContain("['pending', 'approved', 'rejected'] as const")
    expect(APPROVALS).toContain('approvalReviewReasons(item).length === 0')
    expect(APPROVALS).toContain('<BulkOpWizard')
    expect(APPROVALS).toContain('<ConfirmDialog')
    expect(APPROVALS).toContain('確認が必要な成果はまとめて認められません')
  })
})

describe('機能16 現役V8の確認画面', () => {
  it('紹介者の停止・アーカイブは影響を読んで記録を残す', () => {
    expect(AFFILIATORS).toContain('<AffiliateArchiveDialog')
    expect(ACTION_DIALOGS).toContain('api.affiliates.archiveImpact')
    expect(ACTION_DIALOGS).toContain('api.affiliates.archive')
    expect(ACTION_DIALOGS).toContain('過去の成果・報酬・支払いの記録は消えません')
    expect(ACTION_DIALOGS).toContain("label={`確認のため「${target?.name ?? ''}」と打ってください`}")
  })

  it('影響確認は読込・通常・空・失敗を分ける', () => {
    for (const word of ['使われている場所を確認しています', '使われている場所を確認できませんでした', '確認できる情報がありません', "phase === 'loading'", "phase === 'error'"]) expect(ACTION_DIALOGS).toContain(word)
  })
})

describe('機能16 現役V8の内訳と報酬率', () => {
  it('内訳の読込失敗は空と区別し、再試行を出す', () => {
    expect(DRAWER).toContain("setJourneyState('error')")
    expect(DRAWER).toContain('紹介で増えた友だちを読み込めませんでした')
    expect(DRAWER).toContain('この期間の集計を読み込めませんでした')
    expect(DRAWER).toContain('onRetry={reloadAll}')
  })

  it('登録と変更の両方で報酬率を0から100に制限する', () => {
    expect(DRAWER).toContain('報酬率は0から100の間で入力してください')
    expect(DRAWER).toContain('Number(rate) < 0 || Number(rate) > 100')
    expect(NEW_AFFILIATE).toContain('rate < 0 || rate > 100')
  })

  it('CSV書出しは共通のセル関数に寄せる', () => {
    expect(AFFILIATORS).toContain('downloadCsv(')
    expect(DISPLAY).toContain('line.map(csvCell)')
    expect(AFFILIATORS).not.toContain('const escape = (value: string | number)')
  })

  it('旧い成績口の包みは消し、v2だけ使う', () => {
    expect(DRAWER).toContain('api.affiliates.reportV2(id,')
    expect(DRAWER).not.toContain('api.affiliates.report(')
    expect(API).toContain('reportV2: (id: string')
    expect(API).not.toContain('totalConversions: number; totalRevenue: number')
  })
})
