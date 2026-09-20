import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./tags-page-v4.tsx', import.meta.url), 'utf8')

/**
 * #981 A04-02: タグ総数とフォルダ内訳の母集団の照合。
 *
 * タグ画面の件数は「KPI・フォルダ帯の見出し・すべて・各フォルダ・未分類」
 * の5か所に出る。一覧そのもの（items）から数えるものと /api/list-stats
 * から来るものが混在すると、選択中アカウントの範囲で数字が食い違う
 * （tags.total はテナント全体の件数でアカウント範囲を見ない）。
 *
 * 保管済み（archived）のタグは一覧に「保管済み」の印付きで残る設計のため、
 * 件数の母集団にも含める。その旨はフォルダ帯に書く。
 */
describe('タグ一覧の件数定義（#981 A04-02）', () => {
  it('KPIの「タグ数」はフォルダ内訳と同じ母集団（一覧そのもの）で数える', () => {
    expect(PAGE).toContain('value: ready ? items.length : null')
    // テナント全体の件数を KPI に使ってはいけない。
    expect(PAGE).not.toContain('value: stats.tags.total')
  })

  it('KPIは一覧と同じアカウント範囲で数える（accountId を渡す）', () => {
    expect(PAGE).toContain('accountId={accountId ?? undefined}')
  })

  it('フォルダ帯の「すべて」と見出しは一覧の件数そのもの', () => {
    expect(PAGE).toContain("name: 'すべて', count: items.length")
    expect(PAGE).toContain('`${items.length}件`')
  })

  it('保管済みタグも件数の母集団に入ることを画面で説明する', () => {
    expect(PAGE).toContain('件数には保管済みのタグも含みます')
  })

  it('アカウント切替でフォルダ選択と前アカウントの行・件数を残さない', () => {
    // 切替後に前のアカウントのフォルダ選択が残ると、存在しないフォルダIDで
    // 新しい一覧が絞られてしまう。
    expect(PAGE).toContain("setFolder('')")
    expect(PAGE).toContain('setItems([])')
    expect(PAGE).toContain('setGroups([])')
    // load の effect が走る前の1フレームに前のアカウントの件数を出さない。
    expect(PAGE).toContain('loadRequestRef.current.accountId !== accountId')
  })
})
