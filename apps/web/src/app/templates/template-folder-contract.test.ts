import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')
const PAGE = readUiSource(join(HERE, '../../v8/templates/list.tsx'), 'utf8')
/** 注釈を落とす。「テンプレートと書かない」の説明が自分の見張りに当たらないように。 */
const withoutComments = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const PANEL = read('../../components/shared/folder-panel.tsx')
const PANEL_CODE = withoutComments(PANEL)

/**
 * テンプレートのフォルダ操作（設計 `CzndJ` ★管理画面 11-1-H）。
 *
 * 本物のフォルダ（`folders.kind = 'template'`）で絞る・名前と色・並べ替え（端の行は出さない）・
 * 消す前の但し書きと件数は templates-list-behavior.test.tsx、置き場の移動・失敗の読み直し・
 * 二度押しは template-folder-count-refresh.test.tsx で、画面を開いて押して確かめる。
 * ここに残すのは、戻してはいけない作りの見張りだけ。
 */
describe("管理画面 テンプレートのフォルダ操作（CzndJ）", () => {
  it('文字列ではなく、本物のフォルダを読む', () => {
    // `category` から帯を組み立てる作りへ戻さない。
    expect(PAGE).not.toContain('categoryCounts')
  })

  it('但し書きの言葉は呼ぶ側が決める', () => {
    /*
      この部品はテンプレートにも属性にも使う。ここで「テンプレート」と
      書くと、ほかの画面で嘘になる。
    */
    expect(PANEL_CODE, '部品が画面の言葉を持っている').not.toContain('中のテンプレートは')
  })

  it('部品が操作を実際に描く', () => {
    // V8（nH0fZ）は吹き出しを出さず確認の窓で読ませる。
    expect(PANEL_CODE).not.toContain('note={row.deleteNote}')
  })

  // 名前・色・所属の作成/更新は folder-editor-dialog.react.test.tsx で実操作する。

  /*
    2026-09-04（台帳 #124）: 置き場を書く口ができたので、断りを消して
    実際に移せるようにした。**断り文言を残したまま操作を足さない。**
    残すと、動くのに「動きません」と書いてある画面になる。
  */
  it('詳細から置き場を移せる', () => {
    expect(PAGE).not.toContain('テンプレートをフォルダへ移す操作は、まだ繋がっていません。')
    expect(PAGE).not.toContain('<Th>置き場</Th>')
  })
})
