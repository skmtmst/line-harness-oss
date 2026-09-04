import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')
const PAGE = read('page.tsx')
/** 注釈を落とす。「テンプレートと書かない」の説明が自分の見張りに当たらないように。 */
const withoutComments = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const PANEL = read('../../components/shared/folder-panel.tsx')
const PANEL_CODE = withoutComments(PANEL)
const DIALOG = read('../../components/shared/folder-add-dialog.tsx')

/**
 * テンプレートのフォルダ操作（設計 `CzndJ` ★V6 11-1-H）。
 *
 * 設計は行の操作を 5 つ持つ——**名前を変更 / 色を変える / 並び順を上へ /
 * 並び順を下へ / フォルダを削除**——と、削除の下に
 * 「削除しても、中のテンプレートは未分類に残ります。」。
 *
 * 実装は `category`（テンプレートが持つ文字列）から帯を組み立てていて、
 * **空のフォルダを作れず、名前を直すと中身が散らばった。**
 * 本物のフォルダ（`folders.kind = 'template'`）へ寄せる。
 */
describe('V6 テンプレートのフォルダ操作（CzndJ）', () => {
  it('文字列ではなく、本物のフォルダを読む', () => {
    expect(PAGE).toContain("api.folders.list('template')")
    // `category` から帯を組み立てる作りへ戻さない。
    expect(PAGE).not.toContain('categoryCounts')
  })

  it('絞り込みは folderId で見る', () => {
    // `category` の文字列で比べると、名前を直した瞬間に中身が外れる。
    expect(PAGE).toContain("t.folderId !== selectedCategory")
    expect(PAGE).toContain("selectedCategory === 'unfiled'")
  })

  it('設計の 5 つの操作がある', () => {
    expect(PAGE).toContain('onEdit:')      // 名前を変更・色を変える
    expect(PAGE).toContain('onMoveUp:')    // 並び順を上へ
    expect(PAGE).toContain('onMoveDown:')  // 並び順を下へ
    expect(PAGE).toContain('onDelete:')    // フォルダを削除
    expect(PAGE).toContain('setFolderDialogOpen(true)') // フォルダを追加
  })

  it('端の行には並び替えの口を出さない', () => {
    /*
      押せない矢印を置くと、押せないのか壊れているのか分からない。
      **呼ぶ側で `undefined` にする**（部品は渡されたぶんだけ描く）。
    */
    expect(PAGE).toContain('index > 0 ?')
    expect(PAGE).toContain('index < folders.length - 1 ?')
  })

  it('消しても中身が残ることを、押す前に言う', () => {
    // 設計 `CzndJ` の文言。吹き出しと確認窓の両方に出す。
    expect(PAGE).toContain('削除しても、中のテンプレートは未分類に残ります。')
    // 何件入っているかも出す。0 と「取れていない」を混ぜない。
    expect(PAGE).toContain('いまこのフォルダに入っているのは')
  })

  it('但し書きの言葉は呼ぶ側が決める', () => {
    /*
      この部品はテンプレートにも属性にも使う。ここで「テンプレート」と
      書くと、ほかの画面で嘘になる。
    */
    expect(PANEL).toContain('deleteNote')
    expect(PANEL_CODE, '部品が画面の言葉を持っている').not.toContain('中のテンプレートは')
  })

  it('部品が操作を実際に描く', () => {
    // **型に生えているだけでは描かれない。** 描く行を見る。
    expect(PANEL).toContain('{row.onMoveUp && (')
    expect(PANEL).toContain('{row.onDelete && (')
    expect(PANEL).toContain('row.deleteNote ??')
  })

  it('名前と色を直す窓は、追加と同じ窓を使う', () => {
    // 窓を2つ作ると、文言や色の並びがまたずれる。
    expect(DIALOG).toContain('folder?: Folder')
    expect(DIALOG).toContain('api.folders.update(folder.id')
    expect(DIALOG).toContain("{folder ? 'フォルダを直す' : 'フォルダを追加'}")
  })

  it('移せないことを、その場で断る', () => {
    /*
      フォルダは作れるが、テンプレートを入れる口がまだ無い
      （`POST`/`PUT /api/templates` が `folderId` を受けない）。
      **作れるのに移せないと「入れたのに反映されない」と読まれる。**
      口ができたら、この断りを消して「移す」操作を足す（台帳 #124）。
    */
    expect(PAGE).toContain('テンプレートをフォルダへ移す操作は、まだ繋がっていません。')
  })
})
