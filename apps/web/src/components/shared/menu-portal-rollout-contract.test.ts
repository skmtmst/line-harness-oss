import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const consolePage = read('../../app/hq/templates/template-console.tsx')
const consoleCss = read('../../app/hq/templates/template-console.module.css')
const mileage = read('../../app/mileage/page.tsx')

/*
 * m17j: 表・ダイアログ・固定の帯の中のメニューは、親の `overflow` や
 * 重なり順に切られないよう、共通の器（MenuPortal）で最上層に出す。
 * 見た目の固定ではなく「切られない仕組み」の見張り。直しを戻す
 * （details＋absolute に戻す）と赤くなる。
 */
describe('m17j 表の中のメニューは最上層に出す', () => {
  it('ひな形一覧の「…」は details ではなく MenuPortal に出す', () => {
    expect(consolePage).toContain('<MenuPortal')
    expect(consolePage).toContain("import MenuPortal from '@/components/shared/menu-portal'")
    expect(consolePage).toContain('role="menu"')
    // できること（編集・配布・削除）は変えない。
    expect(consolePage).toContain('を編集')
    expect(consolePage).toContain('を配布')
    expect(consolePage).toContain('を削除')
    // 自前の absolute メニューを戻したら赤くなる。
    expect(consolePage).not.toContain('styles.menuItems')
    expect(consolePage).not.toContain('<details')
    expect(consoleCss).not.toContain('position: absolute')
  })

  it('マイルの「公開版の中身を見る」は表の枠に切られない開き方にする', () => {
    expect(mileage).toContain('公開版の中身を見る')
    expect(mileage).not.toContain('absolute left-0 top-full')
  })
})
