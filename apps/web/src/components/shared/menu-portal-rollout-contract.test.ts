import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const mileage = read('../../app/mileage/page.tsx')

/*
 * m17j: 表・ダイアログ・固定の帯の中のメニューは、親の `overflow` や
 * 重なり順に切られないよう、共通の器（MenuPortal）で最上層に出す。
 * 見た目の固定ではなく「切られない仕組み」の見張り。直しを戻す
 * （details＋absolute に戻す）と赤くなる。
 */
describe('m17j 表の中のメニューは最上層に出す', () => {
  // ひな形一覧（app/hq/templates/template-console.tsx）は 2026-10-09 の V7 削除で V8（v8/hq-templates/console.tsx）を出すだけになった。
  // V8 の行の「…」は共通の RowMenu（最上層に出す器を持つ）を使うので、v7 の MenuPortal の見張りは外した。

  it('マイルの「公開版の中身を見る」は表の枠に切られない開き方にする', () => {
    expect(mileage).toContain('公開版の中身を見る')
    expect(mileage).not.toContain('absolute left-0 top-full')
  })
})
