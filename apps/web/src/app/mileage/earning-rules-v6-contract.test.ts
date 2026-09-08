import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ruleEventLabel } from './earning-rule-view'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const NEW_PAGE = readFileSync(new URL('./earning-rules/new/page.tsx', import.meta.url), 'utf8')

describe('V6 たまる決めごと（N46cQ）の見せ方', () => {
  it('未知の行動は内部語を出さず、運用者の言葉にする', () => {
    expect(ruleEventLabel('message_received', { message_received: 'メッセージ' })).toBe('メッセージ')
    expect(ruleEventLabel('internal_new_event', {})).toBe('その他の行動')
  })
})

describe('V6 たまる決めごと（N46cQ）の画面', () => {
  it('タブ名と重なる本文見出しを持たない', () => {
    expect(PAGE).not.toContain('マイル付与ルール')
  })

  it('各タブに案内バーを1本ずつ置く', () => {
    expect(PAGE).toContain("import NoteBar from '@/components/shared/note-bar'")
    expect(PAGE.match(/<NoteBar/g) ?? []).toHaveLength(2)
  })

  it('絞り込み札と並び順を共通部品でつなぐ', () => {
    expect(PAGE).toContain("import FilterChip from '@/components/shared/filter-chip'")
    expect(PAGE).toContain("import Select from '@/components/shared/select'")
    expect(PAGE).toContain('aria-label="並び順"')
  })

  it('V6下書きの口へ並び順を保存する', () => {
    expect(PAGE).toContain('api.mileage.saveEarningRuleDraft')
    expect(PAGE).toContain("{savingRuleOrder ? '保存しています' : '並び順を保存'}")
    expect(PAGE).toContain('draft: { ...rule.draft, sortOrder }')
    expect(PAGE).toContain('expectedVersion: rule.draftVersion')
  })

  it('利用対象条件と公開版の中身を一覧から確認できる', () => {
    expect(PAGE).toContain('公開版の中身を見る')
    expect(PAGE).toContain('rule.draft.targetConditions')
    expect(PAGE).toContain('利用対象：すべての友だち')
  })

  it('一覧を設計の表で出す', () => {
    expect(PAGE).toContain("import { TableHeadRow, Th } from '@/components/shared/table'")
    expect(PAGE).toContain('>何をしてくれたら</Th>')
    expect(PAGE).toContain('>対象の行動</Th>')
    expect(PAGE).toContain('align="right">たまるマイル</Th>')
    expect(PAGE).toContain('>有効期間・失効</Th>')
    expect(PAGE).toContain('>この30日</Th>')
    expect(PAGE).toContain('align="center">状態</Th>')
    expect(PAGE).toContain('align="center">操作</Th>')
    // カード格子に戻していない。
    expect(PAGE).not.toContain('grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4')
  })

  it('V6の30日集計・版・失効条件を表示する', () => {
    expect(PAGE).toContain('api.mileage.earningRulesV6')
    expect(PAGE).toContain('api.mileage.history')
    expect(PAGE).toContain('api.mileage.friendsV6')
    expect(PAGE).toContain('title="この30日で付いたマイル"')
    expect(PAGE).toContain('title="1人あたりの平均"')
    expect(PAGE).toContain('ruleSummary?.grantedMiles')
    expect(PAGE).toContain('ruleSummary?.averageBalance')
    expect(PAGE).toContain('grantedMiles30d(rule)')
    expect(PAGE).toContain('rule.metrics30d.granted')
    expect(PAGE).toContain('rule.metrics30d.excluded')
    expect(PAGE).toContain('rule.draftVersion')
    expect(PAGE).toContain('rule.draft.expiresAfterDays')
  })

  it('たまる決めごとの節に素のTailwind色を残さない', () => {
    const section = PAGE.slice(
      PAGE.indexOf("{tab === 'earning-rules'"),
      PAGE.indexOf("{tab === 'history'"),
    )
    expect(section.length).toBeGreaterThan(500)
    expect(section).not.toMatch(/(?:text|bg|border|divide)-(?:gray|slate|indigo|green|rose|orange|amber|emerald)-\d{2,3}/)
  })

  it('停止・再開の失敗は一覧を消さず行内の帯で出す', () => {
    expect(PAGE).toContain('ruleActionError')
    expect(PAGE).toContain('role="alert"')
    expect(PAGE).not.toContain("setLoadError('たまる決めごとを更新できませんでした")
  })

  it('読込中・取得失敗・空を言い分ける', () => {
    expect(PAGE).toContain('title="たまる決めごとを読み込んでいます"')
    expect(PAGE).toContain('title="たまる決めごとを読み込めませんでした"')
    expect(PAGE).toContain('title="まだ決めごとがありません"')
    expect(PAGE).toContain('title="絞り込みに合う決めごとがありません"')
  })
})

describe('V6 たまる決めごとをつくる（BmoGY）の対象条件', () => {
  it('共通の条件部品で15軸を組み合わせ、V6下書きへ保存する', () => {
    expect(NEW_PAGE).toContain("import ConditionBuilder, {")
    expect(NEW_PAGE).toContain('<ConditionBuilder')
    expect(NEW_PAGE).toContain('value={targetConditions}')
    expect(NEW_PAGE).toContain('targetConditions: pruneCondition(targetConditions)')
    expect(NEW_PAGE).toContain('15の軸から組み合わせられます')
  })
})
