import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const WEB = join(__dirname, '..', '..', '..')
const PAGE = readFileSync(join(WEB, 'src', 'app', 'templates', 'page.tsx'), 'utf8')
const PANEL = readFileSync(join(WEB, 'src', 'components', 'shared', 'folder-panel.tsx'), 'utf8')

describe('V6 テンプレートのフォルダ削除（CzndJ）', () => {
  it('フォルダを消しても中身が残ることを、押す前に言う', () => {
    /*
      中身ごと消えると読ませない。窓の中では既に言っていたが、
      **押す前のメニューでは言っていなかった。**
      属性フォルダ・共通情報と同じ言い方にそろえる。
    */
    expect(PAGE).toContain('削除しても、中のテンプレートは未分類に残ります。')
  })

  it('部品が但し書きを実際に描く', () => {
    /*
      **型に生えているだけでは描かれない。** 実際に描く行を見る
      （宣言だけを見ていたら、描画を消しても試験が通ってしまった）。
    */
    expect(PANEL).toContain('{row.deleteNote}')
  })

  it('但し書きの言葉は呼ぶ側が決める', () => {
    /*
      この部品はテンプレートにも属性にも使う。ここで「テンプレート」と
      書くと、ほかの画面で嘘になる。
    */
    expect(PANEL).not.toContain('中のテンプレートは')
  })

  it('使用中のテンプレートには削除の押し口を出さない', () => {
    /*
      #433 が入れた作り。**押せない押し口を残さない**ので、窓で断るより
      前に、そもそも押せない。ここを崩さないよう見張る。
    */
    expect(PAGE).toContain('t.usageCount > 0 ? (')
    expect(PAGE).toContain('使用先を見る')
  })
})
