import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(join(__dirname, 'restaurant-console.tsx'), 'utf8')

/*
 * R106: 飲食店向けの組織・権限で追加したユーザー設定は、実際の権限判定
 * （ログイン中のスタッフの役割）につながっていない。つながっていないのに
 * 権限が適用される表示にすると、店長・スタッフを設定したつもりでも
 * 表示どおりの運用にならない。名簿であることを明示し、実際の判定元を示す。
 * （ログインと名簿の結び付け自体は migration が要るため未対応。）
 */
describe('R106 飲食店向けユーザー一覧は名簿と明示する', () => {
  it('一覧は権限適用ではなく名簿と説明する', () => {
    expect(SRC).toContain('この一覧は名簿です')
    expect(SRC).toContain('ログイン中のスタッフの役割（オーナー・管理者・スタッフ）')
    expect(SRC).not.toContain('権限は飲食店向け領域の中だけに適用します')
  })

  it('店舗管理者の人数に承認権限があると書かない', () => {
    expect(SRC).not.toContain('承認権限あり')
  })

  it('追加の完了文は権限付与と読めない書き方にする', () => {
    expect(SRC).toContain('飲食店向けの名簿へ追加しました')
    expect(SRC).not.toContain('ログインユーザーを飲食店向け領域へ追加しました')
  })
})
