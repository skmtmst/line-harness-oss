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

describe('#969-U008 会話ヘッダー: 狭い幅では宛先の名前が1行目を専有する', () => {
  const header = region(PAGE, '{/* Chat Header */}', '{/* Messages')

  it('ヘッダーは折り返せる。狭い幅で名前の行が1行目を専有する', () => {
    // 外側: 折り返し可。sm 以上では従来どおり1行。
    expect(header).toContain('flex-wrap')
    expect(header).toContain('sm:flex-nowrap')
    // 名前側: 狭い幅では行いっぱい（basis-full）、sm 以上では通常の1行配置へ。
    expect(header).toContain('basis-full')
    expect(header).toContain('sm:basis-auto')
    expect(header).toContain('sm:flex-1')
  })

  it('操作（注目・担当・対応・顧客情報）は2行目へ落ちても右端で切れない', () => {
    const ops = region(header, 'ml-auto flex', '注目から外す')
    // 1行に固定したままだと 390px で右に切れ、320px では更に隠れる。
    // sm 以上ではデザイン契約どおり1行に保つ（`sm:flex-nowrap`）。
    expect(ops).toContain('flex-wrap')
    expect(ops).toContain('sm:flex-nowrap')
    expect(ops).not.toContain('flex flex-nowrap')
  })

  it('宛先の名前は truncate で潰れず、誰への返信か読める', () => {
    const name = region(header, '<div className="min-w-0">', 'LINE・最終受信')
    expect(name).toContain('truncate')
    expect(name).toContain('chatDetail.friendName')
  })
})

describe('#969-U009 送信ボタン: どの幅でもラベルは1行', () => {
  const footer = region(PAGE, '{/* 下段 */}', '<TemplatePicker')

  it('送信ボタンは縮まず・折り返さない', () => {
    const send = region(footer, 'onClick={handleSendMessage}', '{sending ?')
    expect(send).toContain('whitespace-nowrap')
    expect(send).toContain('shrink-0')
  })

  it('画像案内が長くても右の操作を圧迫しない', () => {
    // 行自体が折り返せる。収まらなければ案内と操作は別行になる。
    expect(footer).toContain('flex-wrap')
    // 左の案内側は縮められる（min-w-0）、右の操作側は縮まない（shrink-0）。
    expect(footer).toContain('min-w-0')
    expect(footer).toContain('ml-auto')
    expect(footer).toContain('shrink-0')
  })

})

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
