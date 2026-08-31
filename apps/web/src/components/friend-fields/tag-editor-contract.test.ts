import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const EDITOR = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'tag-editor-v4.tsx'),
  'utf8',
)

/** タグを作る・編集する（設計 `l25rlp` 4-1-A ／ `ee0sk` 4-1-D）。 */
describe('タグの編集', () => {
  it('★の切り替え方が2通りあることを言う', () => {
    // 「★を付けると…出ます」だけだと、一覧の星からも切り替えられることが伝わらない。
    expect(EDITOR).toContain('このスイッチ、またはタグ一覧の星をクリックして')
  })

  it('連動がOFFのとき、ONにすると何ができるかを中身つきで出す', () => {
    /*
     * 名前だけを並べていた。倍率が何倍なのか、連動で何を送れるのかが
     * 読めず、ONにして初めて分かる形だった。
     */
    expect(EDITOR).toContain('LINKED_PREVIEW')
    expect(EDITOR).toContain('このタグが初めて付いた本人に +N mile')
    expect(EDITOR).toContain('獲得マイルを 1.2／1.5／2.0／3.0倍')
    expect(EDITOR).toContain('テキスト送信・テンプレート送信・タグ操作・シナリオ開始など')
  })

  it('OFFに戻しても、積んだマイルが戻らないことを言う', () => {
    // OFFにすれば元通りだと読めてしまう。
    expect(EDITOR).toContain('すでに積んだマイルは取り消されません')
    // 新規作成にはまだ積んだものが無いので、編集のときだけ出す。
    expect(EDITOR).toContain("mode === 'edit' && linked ?")
  })

  it('この設定で起きることの3つ目を、使い道が分かる言い方にする', () => {
    expect(EDITOR).toContain('配信の絞り込み・シナリオの開始条件・自動応答の付与先として選べます。')
  })

  it('編集からタグを複製できる', () => {
    expect(EDITOR).toContain('複製して新規作成')
  })
})
