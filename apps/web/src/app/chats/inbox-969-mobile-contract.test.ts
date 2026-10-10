/*
 * #969（外部UI監査 2026-09-19/20 ab9d80b の U008〜U010）の再発防止の契約テスト。
 *
 * U008: 会話上部の操作が幅を取り、390px で宛先の名前が読めなかった。
 *       → 狭い幅では名前＋戻るを1行目いっぱいに取り、操作は2行目へ折り返す。
 * U009: 画像案内・予約・送信が同じ行に詰まり、390px で「送信」が送／信に割れた。
 *       → 送信を縮まない主操作にし、行自体を折り返せるようにする。
 * U010: テンプレート・送信設定・内部メモの横並びで右の操作が切れた。
 *       → 収まらない分は次の行へ折り返す。
 *
 * これは**書き方の見張り**で、実際の幅の挙動は目視で確かめる。
 * 後から手を入れたときに、折り返しと縮まない約束が黙って消えないかだけを見る。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

/**
 * `start` から `end` までを切り出す。**印が無ければ落とす。**
 * 印を消したまま試験が通ると、何も見ていない試験になる。
 */
function region(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  if (from < 0) throw new Error(`区間の始まりが見つかりません: ${start}`)
  const to = source.indexOf(end, from + start.length)
  if (to < 0) throw new Error(`区間の終わりが見つかりません: ${end}`)
  return source.slice(from, to)
}

describe('#969-U010 補助操作: テンプレート・送信設定・内部メモが右に切れない', () => {
  const toolbar = region(PAGE, '{/* 上段 */}', '{/* 送信の設定は送信キーだけ')

  it('補助操作の列は折り返せる。flex-nowrap で右端へ押し出さない', () => {
    expect(toolbar).toContain('flex-wrap')
    expect(toolbar).not.toContain('flex-nowrap')
  })

  it('3つの補助操作がすべて列に居る（メニュー化で消えていない）', () => {
    expect(toolbar).toContain('テンプレートを選択')
    expect(toolbar).toContain('送信の設定')
    expect(toolbar).toContain('内部メモ')
  })
})
