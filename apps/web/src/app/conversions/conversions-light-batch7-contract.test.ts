import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readUiSource(join(import.meta.dirname, 'page.tsx'), 'utf8')

/**
 * コンバージョン一覧の禁止の見張り。表示件数の切り替え・CSVの書き出し・作成前の確かめ・
 * 同名警告の範囲・空の案内は v8/conversions/list.test.tsx・create.test.tsx と
 * conversion-points-rowmenu-react.test.tsx が描画して確かめる。
 */
describe('点検・軽 コンバージョン', () => {
  it('飾りの表示件数切り替えを置かない', () => {
    expect(PAGE).not.toContain('onChange={() => undefined}')
  })

  it('空状態の案内に古いボタン名を書かない', () => {
    expect(PAGE).not.toContain('右上の「成果地点を追加」')
    expect(PAGE).not.toContain('右上の「成果地点をつくる」')
  })

  it('読まれない深掘り受け渡しを付けない', () => {
    expect(PAGE).not.toContain('tab=points&point=')
  })
})
