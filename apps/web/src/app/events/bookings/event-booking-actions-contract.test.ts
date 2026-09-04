/*
 * 申込者一覧（`i5SN2j`）で守りたいこと。
 *
 * この面の押し口はどれも**友だちへLINEが飛ぶ**。押す前に、誰に何が
 * 起きるのかを読めないといけない。ブラウザ標準の窓では、それを書く
 * 場所が無いうえ、**画像比較にも写らないので絵を撮れない。**
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/** 説明の文だけで通ってしまわないよう、判定の前にコメントを落とす。 */
const CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('V6 i5SN2j イベント申込者の次行動と安全なキャンセル', () => {
  it('帯を数だけで終わらせず、次にすることへつなぐ', () => {
    expect(CODE).toContain('describeBookingCapacity(applied, capacity)')
    // 0件のときと有るときで、添え字が変わること。
    expect(CODE).toContain('対応が必要：')
    expect(CODE).toContain('件を確認してください')
    expect(CODE).toContain('確認待ちはありません')
    expect(CODE).toContain('空いた枠を確認してください')
    expect(CODE).toContain('キャンセルはありません')
  })

  it('運営キャンセルをブラウザ標準の窓で直に実行しない', () => {
    expect(CODE).not.toContain("confirm('運営側でキャンセルしますか？")
    // 窓を開ける押し口に目印。これが無いと撮影から辿れない。
    expect(CODE).toContain('data-qa-open="i5SN2j-cancel"')
    expect(CODE).toContain('open={cancelTarget !== null}')
    // 何が起きるか・何が残るか・戻せないこと。
    expect(CODE).toContain('友だちにはLINEでキャンセルのお知らせが届きます')
    expect(CODE).toContain('送ったお知らせは取り消せません')
  })

  it('拒否理由をブラウザ標準の窓で聞かず、届く範囲が分かる窓で確認する', () => {
    expect(CODE).not.toContain('window.prompt')
    expect(CODE).toContain('data-qa-open="i5SN2j-reject"')
    expect(CODE).toContain('open={rejectTarget !== null}')
    // 書いた理由がどこへ行くのか。prompt には書く場所が無かった。
    expect(CODE).toContain('この理由は運営の記録にだけ残ります')
    expect(CODE).toContain('友だちには決まったお知らせの文が届きます')
    expect(CODE).toContain('rejectReason.trim() || undefined')
    expect(CODE).toContain('error={rejectError}')
  })

  it('二重実行を止め、失敗しても窓を閉じず画面の言葉を出す', () => {
    expect(CODE).toContain('busy')
    expect(CODE).toContain('error={cancelError}')
    expect(CODE).toContain('予約をキャンセルできませんでした')
    expect(CODE).toContain('予約を拒否できませんでした')
  })

  it('名前を取れない行に内部IDを出さない', () => {
    // `er-1` のような目印は、運用者にとって手がかりにならない。
    expect(CODE).not.toContain('friend_id.slice(0, 8)')
    expect(CODE).not.toContain("(b.line_account_id ?? '').slice(0, 8)")
    expect(CODE).toContain('友だちは未取得')
    expect(CODE).toContain('アカウントは未取得')
  })
})
