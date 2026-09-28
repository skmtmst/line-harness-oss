import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./tags-page-v4.tsx', import.meta.url), 'utf8')

/**
 * タグ一覧の総数は「1–20 / N件」の1か所だけに出す。
 *
 * #966 で件数を絞り込み行へ移したあと、同じ総数が「フォルダ帯の
 * すべて・フォルダ絞り込みの選択肢・KPI のタグ数」の計3か所にも残り、
 * 1画面に3回出ていた。#946 の「絞り込み後の件数は一覧の側に出る」に
 * そろえ、フォルダの見出しはフォルダの数か何も出さない（各フォルダと
 * 未分類の内訳はフォルダの数なので出す）。
 *
 * 保管済み（archived）のタグは一覧に「保管済み」の印付きで残る設計のため、
 * 件数の母集団にも含める。その旨はフォルダ帯に書く（#981 A04-02）。
 */
describe('タグ一覧の件数は一覧の上だけに出す', () => {
  it('総数は「1–20 / N件」だけに出し、KPI に繰り返さない', () => {
    // KPI の「タグ数」は総数と同じ数だったため廃止。空いた枠は
    // 絞り込みと同じ数え方の「未使用」へ。テナント全体の tags.total は使わない。
    expect(PAGE).not.toContain('value: ready ? items.length : null')
    expect(PAGE).not.toContain('value: stats.tags.total')
    expect(PAGE).toContain("title: '未使用',")
  })

  it('KPIは一覧と同じアカウント範囲で数える（accountId を渡す）', () => {
    expect(PAGE).toContain('accountId={accountId ?? undefined}')
  })

  it('フォルダ帯の「すべて」には総数を出さない（内訳はフォルダの数のまま）', () => {
    expect(PAGE).not.toContain("name: 'すべて', count: items.length")
    // 各フォルダ・未分類の行にはフォルダの数を出す（出すのは内訳で総数ではない）。
    expect(PAGE).toContain('count: items.filter((tag) => tag.groupId === group.id).length')
    expect(PAGE).toContain('count: items.filter((tag) => !tag.groupId).length')
    expect(PAGE).not.toContain('`${items.length}件`')
  })

  it('狭い幅のフォルダ絞り込みの選択肢にも総数を重ねない', () => {
    expect(PAGE).toContain("label: 'フォルダ：すべて'")
    expect(PAGE).not.toMatch(/フォルダ：すべて（\$\{.*\}件）/)
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
