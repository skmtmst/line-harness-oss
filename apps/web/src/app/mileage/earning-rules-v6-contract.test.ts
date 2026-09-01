import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { MileageRule } from '@/lib/api'
import {
  RULE_CSV_HEADER,
  RULE_FILTERS,
  RULE_SORTS,
  earningRulesCsv,
  hasRuleLimit,
  ruleLimitLabel,
  selectRules,
} from './earning-rule-view'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

function rule(over: Partial<MileageRule> & { id: string }): MileageRule {
  return {
    name: over.id,
    eventType: 'message_received',
    source: null,
    amount: 1,
    initialStatus: 'available',
    conditions: {},
    isActive: true,
    validFrom: null,
    validUntil: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

const RULES: MileageRule[] = [
  rule({ id: 'a', name: 'メッセージ', amount: 3, conditions: { dailyCapActions: 5 }, createdAt: '2026-03-01T00:00:00.000Z' }),
  rule({ id: 'b', name: 'フォーム', eventType: 'form_submitted', amount: 30, isActive: false, createdAt: '2026-02-01T00:00:00.000Z' }),
  rule({ id: 'c', name: '予約', eventType: 'booking_created', amount: 10, conditions: { uniquePerSubject: true }, createdAt: '2026-01-15T00:00:00.000Z' }),
]

describe('V6 たまる決めごと（N46cQ）の見せ方', () => {
  it('絞り込みの札は読み込んだ行から数えられるものだけ持つ', () => {
    expect(RULE_FILTERS.map((f) => f.key)).toEqual(['active', 'stopped', 'capped', 'uncapped'])
  })

  it('上限は、回数の上限と「1回だけ」の両方を上限として数える', () => {
    expect(hasRuleLimit(rule({ id: 'x', conditions: { dailyCapActions: 3 } }))).toBe(true)
    expect(hasRuleLimit(rule({ id: 'y', conditions: { uniquePerReferredFriend: true } }))).toBe(true)
    // 倍率を無視するのは上限ではない。
    expect(hasRuleLimit(rule({ id: 'z', conditions: { ignoreMultiplier: true } }))).toBe(false)
    expect(hasRuleLimit(rule({ id: 'w', conditions: {} }))).toBe(false)
  })

  it('札を押すと、その札に合う決めごとだけ残る', () => {
    expect(selectRules(RULES, { filters: ['stopped'], sort: 'newest' }).map((r) => r.id))
      .toEqual(['b'])
    expect(selectRules(RULES, { filters: ['uncapped'], sort: 'newest' }).map((r) => r.id))
      .toEqual(['b'])
  })

  it('札を2つ押すと足し合わせる。どちらかに合えば残る', () => {
    expect(selectRules(RULES, { filters: ['active', 'stopped'], sort: 'newest' })).toHaveLength(3)
  })

  it('並び順は新しい順・名前順・マイルが多い順の3つが動く', () => {
    expect(RULE_SORTS.map((s) => s.value)).toEqual(['newest', 'name', 'amount'])
    expect(selectRules(RULES, { filters: [], sort: 'newest' }).map((r) => r.id))
      .toEqual(['a', 'b', 'c'])
    expect(selectRules(RULES, { filters: [], sort: 'amount' }).map((r) => r.id))
      .toEqual(['b', 'c', 'a'])
  })

  it('並び替えても元の配列は動かさない', () => {
    const before = RULES.map((r) => r.id)
    selectRules(RULES, { filters: [], sort: 'amount' })
    expect(RULES.map((r) => r.id)).toEqual(before)
  })

  it('上限は運用者の言葉で書く', () => {
    expect(ruleLimitLabel(rule({ id: 'x', conditions: { dailyCapActions: 5 } }))).toBe('1日5回まで')
    expect(ruleLimitLabel(rule({ id: 'y', conditions: {} }))).toBe('行動ごとに付与')
    expect(
      ruleLimitLabel(rule({ id: 'z', conditions: { uniquePerSubjectPerDay: true, dailyCapActions: 3 } })),
    ).toBe('同じリンクは1日1回・1日3件まで')
  })

  it('CSVは画面に出ている決めごとだけを、設計の見出しで書き出す', () => {
    const shown = selectRules(RULES, { filters: ['stopped'], sort: 'newest' })
    const csv = earningRulesCsv(shown, {
      event: (eventType) => eventType,
      date: (iso) => iso.slice(0, 10),
    })
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(RULE_CSV_HEADER.join(','))
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('止めています')
    expect(csv).not.toContain('メッセージ')
  })
})

describe('V6 たまる決めごと（N46cQ）の画面', () => {
  it('タブ名と重なる本文見出しを持たない', () => {
    expect(PAGE).not.toContain('マイル付与ルール')
  })

  it('案内バーを1本置く', () => {
    expect(PAGE).toContain("import NoteBar from '@/components/shared/note-bar'")
    expect(PAGE.match(/<NoteBar/g) ?? []).toHaveLength(1)
  })

  it('絞り込み札と並び順を共通部品でつなぐ', () => {
    expect(PAGE).toContain("import FilterChip from '@/components/shared/filter-chip'")
    expect(PAGE).toContain("import Select from '@/components/shared/select'")
    expect(PAGE).toContain('aria-label="並び順"')
  })

  it('口の無い「並び順を保存」を操作として置かない', () => {
    expect(PAGE).not.toMatch(/>\s*並び順を保存\s*</)
  })

  it('一覧を設計の表で出す', () => {
    expect(PAGE).toContain("import { TableHeadRow, Th } from '@/components/shared/table'")
    expect(PAGE).toContain('<Th>決めごと</Th>')
    expect(PAGE).toContain('<Th>対象の行動</Th>')
    expect(PAGE).toContain('<Th align="right">付与マイル</Th>')
    expect(PAGE).toContain('<Th>上限</Th>')
    expect(PAGE).toContain('<Th align="center">状態</Th>')
    expect(PAGE).toContain('<Th align="center">操作</Th>')
    // カード格子に戻していない。
    expect(PAGE).not.toContain('grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4')
  })

  it('たまる決めごとの節に素のTailwind色を残さない', () => {
    const section = PAGE.slice(
      PAGE.indexOf("{tab === 'earning-rules'"),
      PAGE.indexOf("{tab === 'history'"),
    )
    expect(section.length).toBeGreaterThan(500)
    expect(section).not.toMatch(/(?:text|bg|border|divide)-(?:gray|slate|indigo|green|rose|orange|amber|emerald)-\d{2,3}/)
  })

  it('読込中・取得失敗・空を言い分ける', () => {
    expect(PAGE).toContain('title="たまる決めごとを読み込んでいます"')
    expect(PAGE).toContain('title="たまる決めごとを読み込めませんでした"')
    expect(PAGE).toContain('title="まだ決めごとがありません"')
    expect(PAGE).toContain('title="絞り込みに合う決めごとがありません"')
  })
})
