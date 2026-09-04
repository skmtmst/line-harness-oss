import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..')
const read = (path: string) => readFileSync(join(SRC, path), 'utf8')

/** 注記まで探すと、消したはずの言葉がコメントで引っかかる。本文だけを見る。 */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const FRIENDS = read('app/friends/page.tsx')
const FRIENDS_BODY = withoutComments(FRIENDS)
const ROW = read('components/friends/friend-list-row.tsx')
const ROW_BODY = withoutComments(ROW)
const SUMMARY = read('components/users/summary-bar.tsx')
const SUMMARY_BODY = withoutComments(SUMMARY)
const DUPLICATES_BODY = withoutComments(read('app/duplicates/page.tsx'))
const TOKENS = read('app/globals.css')

describe('友だち一覧(PhxG6)を共通部品へ載せ替える契約', () => {
  it('検索欄・プルダウン・保存条件の札を手書きしない', () => {
    expect(FRIENDS).toContain("import SearchField from '@/components/shared/search-field'")
    expect(FRIENDS).toContain("import Select from '@/components/shared/select'")
    expect(FRIENDS).toContain("import Chip from '@/components/shared/chip'")

    expect(FRIENDS_BODY, '手書きの検索入力が残っている').not.toMatch(/<input\s+type="search"/)
    expect(FRIENDS_BODY, '手書きのプルダウンが残っている').not.toContain('<select')
    expect(FRIENDS_BODY, '手書きのプルダウン装飾が残っている').not.toContain('v6-select')
    expect(FRIENDS_BODY, '保存条件の札が手書きのまま').not.toContain('rounded-full bg-canvas px-2.5')
    expect(FRIENDS_BODY).toContain('<Chip key={summary} tone="neutral">')
  })

  it('絞り込み4つを設計の幅（156/156/176/184）で置く', () => {
    /* 共通Selectの standard は176px固定。幅は外枠で持ち、size="full" を渡す。 */
    for (const [filter, width] of [
      ['tag', 'w-39'],
      ['response', 'w-39'],
      ['operator', 'w-44'],
      ['scenario', 'w-46'],
    ] as const) {
      expect(FRIENDS_BODY, `${filter} の幅が設計と違う`).toContain(
        `<div className="${width} shrink-0" data-filter="${filter}">`,
      )
    }
    expect(FRIENDS_BODY, '痩せた実装幅が残っている').not.toContain('w-37.5 shrink-0')
    expect((FRIENDS_BODY.match(/size="full"/g) ?? []).length).toBeGreaterThanOrEqual(5)
  })

  it('検索行の副操作を設計の高さ38pxと幅で置く', () => {
    /* 共通Buttonは36px・角丸8pxで設計と一致済み。ここへ当てない。 */
    expect(FRIENDS).toContain("const SEARCH_ROW_SECONDARY = 'inline-flex h-9.5")
    expect(FRIENDS_BODY, '詳細条件が110pxでない').toContain('w-27.5')
    expect(FRIENDS_BODY, '保存した検索が130pxでない').toContain('w-32.5')
    expect(FRIENDS_BODY, '検索実行が70pxでない').toContain('w-17.5')
    expect(FRIENDS_BODY).not.toContain('h-10 whitespace-nowrap rounded-control')
  })

  it('行のアバターは真円ではなく設計の40x40 r=18', () => {
    expect(TOKENS).toContain('--radius-large: 18px;')
    expect(ROW_BODY).toContain('h-10 w-10 shrink-0 rounded-large bg-avatar-bg object-cover')
    expect(ROW_BODY, 'アバターが真円のまま').not.toContain('h-10 w-10 shrink-0 rounded-full')
  })

  it('行の担当者に丸アイコンを出し、未割り当ては全角ハイフンで埋める', () => {
    expect(ROW_BODY).toContain('data-operator-avatar={friend.operator ? \'assigned\' : \'unassigned\'}')
    expect(ROW_BODY, '担当者アイコンが16pxでない').toContain('h-4 w-4 shrink-0 items-center justify-center rounded-full')
    expect(ROW_BODY, '頭文字が10px/800でない').toContain('text-nano font-extrabold')
    expect(ROW_BODY, '未割り当てが全角ハイフンでない').toContain("'－'")
    expect(ROW_BODY).toContain("担当：{friend.operator?.name ?? '未割り当て'}")
  })
})

describe('統合ユーザー(r7eSi)の指標カードを共通部品へ載せ替える契約', () => {
  it('共通SummaryCardだけを描き、手書きの面と24pxの値を残さない', () => {
    expect(SUMMARY).toContain("import SummaryCard from '@/components/shared/summary-card'")
    expect(SUMMARY_BODY, '値が24pxのまま').not.toContain('text-2xl')
    expect(SUMMARY_BODY, '手書きの角丸が残っている').not.toContain('rounded-[')
    expect(SUMMARY_BODY, '手書きの影が残っている').not.toContain('shadow-[')
    expect(SUMMARY_BODY, '生の色が残っている').not.toMatch(/#[0-9A-Fa-f]{6}/)
  })

  it('読込中・取得失敗・実値を同じ言葉にしない', () => {
    expect(SUMMARY_BODY).toContain('読み込んでいます')
    expect(SUMMARY_BODY).toContain('読み込めませんでした')
    expect(SUMMARY_BODY).toContain('再読み込み')
    expect(SUMMARY_BODY, '失敗しても前の数字を残している').toContain('setStats(null)')
    expect(SUMMARY_BODY, '遅れて返った古い集計を照合していない').toContain(
      'requestGuard.isCurrent(requestGeneration)',
    )
  })
})

describe('重複検出で取れない数を作らない契約', () => {
  it('登録行数を通数・金額として言い切らない', () => {
    for (const invented of ['余分な配信回数', '1配信あたり浪費', '重複ぶんの送信', '月10本']) {
      expect(DUPLICATES_BODY, `${invented} が本文に残っている`).not.toContain(invented)
    }
    expect(DUPLICATES_BODY, '見積り金額を描いている').not.toContain('wastedPerBroadcastYen}')
    expect(DUPLICATES_BODY, '単価を描いている').not.toContain('msgUnitYen}')
  })

  it('取れない数は「—」と未接続の説明にする', () => {
    expect(DUPLICATES_BODY).toContain('label="重複による配信コスト"')
    expect(DUPLICATES_BODY).toContain('value="—"')
    expect(DUPLICATES_BODY).toContain('まだ繋がっていません。配信実績が接続されると表示されます。')
  })

  it('読込中と取得失敗を状態の言葉でそろえる', () => {
    expect(DUPLICATES_BODY).toContain('読み込んでいます')
    expect(DUPLICATES_BODY).toContain('読み込めませんでした')
    expect(DUPLICATES_BODY, '取得失敗にやり直す口が無い').toContain('再読み込み')
    expect(DUPLICATES_BODY).not.toContain('読み込み中…')
    expect(DUPLICATES_BODY).not.toContain('集計の取得に失敗しました')
  })
})
