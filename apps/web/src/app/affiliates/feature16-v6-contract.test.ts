import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const TABS = readFileSync(new URL('./tabs.tsx', import.meta.url), 'utf8')
const NEW_AFFILIATE = readFileSync(new URL('./new/page.tsx', import.meta.url), 'utf8')
const NEW_OFFER = readFileSync(new URL('../affiliate-offers/new/page.tsx', import.meta.url), 'utf8')

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  expect(from, `${start} が見つからない`).toBeGreaterThan(-1)
  expect(to, `${end} が見つからない`).toBeGreaterThan(from)
  return source.slice(from, to)
}

describe('機能16 V6の一覧', () => {
  const affiliates = section(TABS, 'export function AffiliatorsTab(', '\nfunction formatDateTime')
  const approvals = section(TABS, 'export function ApprovalQueue() {', '\n// ── Offers list')

  it('紹介者一覧は実Node・帯・検索・絞り込み・CSV・ページ送りを持つ', () => {
    expect(affiliates).toContain('data-design-node="PouPn"')
    for (const word of [
      '今月の成果',
      '承認待ち',
      '確定した報酬',
      '未払い残高',
      '今月の成果の流れ',
      '名前・紹介コードで検索',
      'CSVで書き出す',
      '<FilterChip',
      '<Pagination',
    ]) {
      expect(affiliates).toContain(word)
    }
    expect(affiliates).toContain('api.affiliates.paymentSummaries(accountId)')
  })

  it('成果承認は全状態を読み、確認不要だけをまとめて承認する', () => {
    expect(approvals).toContain('data-design-node="n5VVTb"')
    expect(approvals).toContain("(['pending', 'approved', 'rejected'] as const)")
    expect(approvals).toContain('!item.duplicateFlag')
    expect(approvals).toContain('選んだ{selected.size}件をまとめて認める')
    expect(approvals).toContain('まとめて却下する')
    expect(approvals).toContain('確認が必要な成果はまとめて承認できません')
  })

  it('成果承認は検索・並び順・CSV・状態・ページ送りを持つ', () => {
    for (const word of [
      '友だち・紹介者・案件・成果地点で検索',
      '金額が高い順',
      'CSVで書き出す',
      '確認したほうがよい',
      '<Pagination',
    ]) {
      expect(approvals).toContain(word)
    }
  })
})

describe('機能16 V6の作成画面', () => {
  it('紹介者登録は支払い条件と未接続の振込先を正直に示す', () => {
    expect(NEW_AFFILIATE).toContain('designNode="xqT1Z"')
    for (const word of [
      '支払いサイクル',
      '確定までの保留期間',
      '振込先の登録',
      'api.friends.list',
      'つながる先',
    ]) {
      expect(NEW_AFFILIATE).toContain(word)
    }
  })

  it('案件作成は成果地点の未接続を入力欄に見せない', () => {
    expect(NEW_OFFER).toContain('designNode="GPWzq"')
    expect(NEW_OFFER).toContain('label="何をもって成果とするか"')
    for (const label of ['成果地点', '紹介とみなす期間', '同じ友だちを数える回数', '成果の自動承認']) {
      expect(NEW_OFFER).toContain(`label="${label}"`)
    }
    expect(NEW_OFFER).toContain('案件と成果地点の紐づけAPIが接続されると選べます')
  })
})
